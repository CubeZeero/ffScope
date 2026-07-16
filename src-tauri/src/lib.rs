// ffScope — ffprobe GUI frontend
// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Runtime};
use tauri_plugin_opener::OpenerExt;

const REPO_URL: &str = "https://github.com/CubeZeero/ffScope";

/// FFmpeg 系ツール（ffprobe / ffmpeg）の実行ファイルを探す汎用関数。
/// GUI アプリ起動時はシェルの PATH を継承しないことが多いため、
/// よくあるインストール場所も明示的に探索する。
///
/// - `base`: "ffprobe" / "ffmpeg"（拡張子なし）
/// - `env_var`: 明示指定用の環境変数名（"FFPROBE_PATH" など）
fn find_tool(base: &str, env_var: &str) -> Option<PathBuf> {
    let exe_name = if cfg!(windows) {
        format!("{base}.exe")
    } else {
        base.to_string()
    };

    // 1. 環境変数での明示指定を最優先
    if let Ok(p) = std::env::var(env_var) {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }

    // 2. アプリ実行ファイルの隣（Tauri sidecar として同梱されたバイナリ）
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let bundled = dir.join(&exe_name);
            if bundled.is_file() {
                return Some(bundled);
            }
            // macOS の .app/Contents/MacOS 配下も同じ dir だが念のため Resources も見る
            let resources = dir.join("../Resources").join(&exe_name);
            if resources.is_file() {
                return Some(resources);
            }
        }
    }

    // 3. よくあるインストール場所
    let candidates = [
        "/opt/homebrew/bin",       // macOS Apple Silicon (Homebrew)
        "/usr/local/bin",          // macOS Intel / Linux
        "/usr/bin",                // Linux
        "/snap/bin",               // Linux (snap)
        "C:\\ffmpeg\\bin",         // Windows よくある手動配置
    ];
    for dir in candidates {
        let p = Path::new(dir).join(&exe_name);
        if p.is_file() {
            return Some(p);
        }
    }

    // 4. PATH 上を探索（`which`/`where` 相当を自前で）
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path_var) {
            let p = dir.join(&exe_name);
            if p.is_file() {
                return Some(p);
            }
        }
    }

    None
}

fn find_ffprobe() -> Option<PathBuf> {
    find_tool("ffprobe", "FFPROBE_PATH")
}

fn find_ffmpeg() -> Option<PathBuf> {
    find_tool("ffmpeg", "FFMPEG_PATH")
}

#[derive(Serialize)]
struct ProbeResult {
    /// ffprobe が出力した JSON をそのまま構造化したもの
    data: serde_json::Value,
    /// 実際に使用した ffprobe のパス
    ffprobe_path: String,
}

/// 起動時チェック用：見つかった ffprobe のパスを返す（なければ null）。
#[tauri::command]
fn check_ffprobe() -> Option<String> {
    find_ffprobe().map(|p| p.to_string_lossy().into_owned())
}

/// 指定ファイルを ffprobe で解析し、JSON を返す。
#[tauri::command]
fn probe(path: String) -> Result<ProbeResult, String> {
    let ffprobe = find_ffprobe()
        .ok_or_else(|| "ffprobe が見つかりません。FFmpeg をインストールするか、環境変数 FFPROBE_PATH で実行ファイルを指定してください。".to_string())?;

    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let output = Command::new(&ffprobe)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-show_chapters",
            "-show_programs",
        ])
        .arg(&path)
        .output()
        .map_err(|e| format!("ffprobe の実行に失敗しました: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffprobe がエラーを返しました (code {}):\n{}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        ));
    }

    let data: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("ffprobe の出力(JSON)を解釈できませんでした: {e}"))?;

    Ok(ProbeResult {
        data,
        ffprobe_path: ffprobe.to_string_lossy().into_owned(),
    })
}

/// 1パケットの情報。
struct Pkt {
    t: f64,
    size: i64,
    keyframe: bool,
}

/// 指定ストリームのパケット（時刻・サイズ・キーフレーム）を収集する内部ヘルパー。
fn collect_packets(path: &str, stream_index: u32) -> Result<Vec<Pkt>, String> {
    let ffprobe = find_ffprobe().ok_or_else(|| "ffprobe が見つかりません。".to_string())?;

    if !Path::new(path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let output = Command::new(&ffprobe)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-select_streams",
            &stream_index.to_string(),
            "-show_entries",
            "packet=pts_time,dts_time,size,flags",
            "-of",
            "json",
        ])
        .arg(path)
        .output()
        .map_err(|e| format!("ffprobe の実行に失敗しました: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "ffprobe がエラーを返しました (code {}):\n{}",
            output.status.code().unwrap_or(-1),
            stderr.trim()
        ));
    }

    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("ffprobe の出力(JSON)を解釈できませんでした: {e}"))?;

    let mut packets = Vec::new();
    if let Some(arr) = parsed.get("packets").and_then(|v| v.as_array()) {
        for p in arr {
            let t = p
                .get("pts_time")
                .and_then(|v| v.as_str())
                .or_else(|| p.get("dts_time").and_then(|v| v.as_str()))
                .and_then(|s| s.parse::<f64>().ok());
            let size = p
                .get("size")
                .and_then(|v| v.as_str())
                .and_then(|s| s.parse::<i64>().ok());
            let keyframe = p
                .get("flags")
                .and_then(|v| v.as_str())
                .map(|s| s.contains('K'))
                .unwrap_or(false);
            if let (Some(t), Some(size)) = (t, size) {
                packets.push(Pkt { t, size, keyframe });
            }
        }
    }
    Ok(packets)
}

/// uPlot 向けに整列したビットレート時系列。
#[derive(Serialize)]
struct BitrateSeries {
    /// 各ビンの開始時刻（秒）
    t: Vec<f64>,
    /// 各ビンのビットレート（bits/sec）
    bps: Vec<f64>,
    /// 平均ビットレート（bits/sec）
    avg: f64,
    /// ピークビットレート（bits/sec）
    peak: f64,
    /// 1ビンの長さ（秒）
    bin_dur: f64,
    /// 集計に使ったパケット数
    packet_count: usize,
    /// キーフレームの時刻（秒）。GOP境界の可視化用（最大2000点に間引き）
    keyframes: Vec<f64>,
    /// キーフレーム総数
    keyframe_count: usize,
    /// 平均 GOP 長（秒）。キーフレーム間隔の平均
    avg_gop_sec: f64,
    /// 最短 GOP 長（秒）
    gop_min_sec: f64,
    /// 最長 GOP 長（秒）
    gop_max_sec: f64,
    /// GOP 長のヒストグラム（等間隔ビンの度数）
    gop_hist: Vec<usize>,
    /// ヒストグラムの各ビン幅（秒）
    gop_hist_bin_sec: f64,
}

/// パケットをサーバ側でビン集計してビットレート時系列を返す。
/// 巨大配列を IPC に流さないことで UI のハングを防ぐ。
#[tauri::command]
fn bitrate_series(path: String, stream_index: u32) -> Result<BitrateSeries, String> {
    let packets = collect_packets(&path, stream_index)?;
    if packets.is_empty() {
        return Err("パケットが取得できませんでした（このストリームには時系列情報がない可能性があります）。".to_string());
    }

    let t_min = packets.iter().map(|p| p.t).fold(f64::INFINITY, f64::min);
    let t_max = packets.iter().map(|p| p.t).fold(f64::NEG_INFINITY, f64::max);
    let range = (t_max - t_min).max(0.001);

    // 1秒あたり1ビンを基本に、最大 4000 ビンへクランプ（ズームにも十分な解像度）。
    let bin_count = (range.ceil() as usize).clamp(20, 4000);
    let bin_dur = range / bin_count as f64;

    let mut sums = vec![0i64; bin_count];
    let mut total: i64 = 0;
    let mut kf_times: Vec<f64> = Vec::new();
    for p in &packets {
        let idx = (((p.t - t_min) / bin_dur) as usize).min(bin_count - 1);
        sums[idx] += p.size;
        total += p.size;
        if p.keyframe {
            kf_times.push(p.t);
        }
    }

    let t: Vec<f64> = (0..bin_count).map(|i| t_min + i as f64 * bin_dur).collect();
    let bps: Vec<f64> = sums.iter().map(|s| (*s as f64 * 8.0) / bin_dur).collect();
    let peak = bps.iter().cloned().fold(0.0_f64, f64::max);
    let avg = (total as f64 * 8.0) / range;

    // GOP 長（キーフレーム間隔）の統計とヒストグラム
    let keyframe_count = kf_times.len();
    let gop_lengths: Vec<f64> = kf_times.windows(2).map(|w| w[1] - w[0]).collect();
    let avg_gop_sec = if !gop_lengths.is_empty() {
        gop_lengths.iter().sum::<f64>() / gop_lengths.len() as f64
    } else {
        0.0
    };
    let gop_min_sec = gop_lengths.iter().cloned().fold(f64::INFINITY, f64::min);
    let gop_max_sec = gop_lengths.iter().cloned().fold(0.0_f64, f64::max);
    let gop_min_sec = if gop_min_sec.is_finite() { gop_min_sec } else { 0.0 };

    // ヒストグラム（0..max を 20 ビン）
    const HIST_BINS: usize = 20;
    let gop_hist_bin_sec = if gop_max_sec > 0.0 {
        gop_max_sec / HIST_BINS as f64
    } else {
        0.0
    };
    let mut gop_hist = vec![0usize; HIST_BINS];
    if gop_hist_bin_sec > 0.0 {
        for g in &gop_lengths {
            let idx = ((g / gop_hist_bin_sec) as usize).min(HIST_BINS - 1);
            gop_hist[idx] += 1;
        }
    }

    // 描画用にキーフレームを最大2000点へ間引く
    let keyframes: Vec<f64> = if kf_times.len() > 2000 {
        let step = (kf_times.len() as f64 / 2000.0).ceil() as usize;
        kf_times.iter().step_by(step.max(1)).cloned().collect()
    } else {
        kf_times
    };

    Ok(BitrateSeries {
        t,
        bps,
        avg,
        peak,
        bin_dur,
        packet_count: packets.len(),
        keyframes,
        keyframe_count,
        avg_gop_sec,
        gop_min_sec,
        gop_max_sec,
        gop_hist,
        gop_hist_bin_sec,
    })
}

/// I/P/B フレームの分布。
#[derive(Serialize)]
struct FrameStats {
    i: usize,
    p: usize,
    b: usize,
    total: usize,
}

/// 指定映像ストリームのフレーム種別(I/P/B)を集計する。
/// -show_frames は重いので、フロント側で明示的に要求された時のみ呼ぶ想定。
#[tauri::command]
fn frame_stats(path: String, stream_index: u32) -> Result<FrameStats, String> {
    let ffprobe = find_ffprobe().ok_or_else(|| "ffprobe が見つかりません。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let output = Command::new(&ffprobe)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-select_streams",
            &stream_index.to_string(),
            "-show_entries",
            "frame=pict_type",
            "-of",
            "csv=p=0",
        ])
        .arg(&path)
        .output()
        .map_err(|e| format!("ffprobe の実行に失敗しました: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe がエラーを返しました:\n{}", stderr.trim()));
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let (mut i, mut p, mut b) = (0usize, 0usize, 0usize);
    for line in text.lines() {
        match line.trim() {
            "I" => i += 1,
            "P" => p += 1,
            "B" => b += 1,
            _ => {}
        }
    }
    let total = i + p + b;
    if total == 0 {
        return Err("フレーム種別を取得できませんでした。".to_string());
    }
    Ok(FrameStats { i, p, b, total })
}

/// 進捗通知（フロントへ Channel で送る）。
#[derive(Clone, Serialize)]
struct FrameProgress {
    /// 0.0〜1.0。負値は不定（総時間不明）を示す。
    progress: f64,
    i: usize,
    p: usize,
    b: usize,
}

/// 1区間分のフレーム種別を数える。
/// `interval` を指定すると `-read_intervals` で部分読み、`window` で時刻フィルタして境界重複を除く。
/// 処理済み時間（ミリ秒）を `processed` に加算していく。
fn scan_segment(
    ffprobe: &Path,
    path: &str,
    stream_index: u32,
    interval: Option<String>,
    window: Option<(f64, f64)>,
    processed: &AtomicU64,
    counts: &Mutex<(usize, usize, usize)>,
) -> Result<(), String> {
    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-loglevel".into(),
        "error".into(),
        "-select_streams".into(),
        stream_index.to_string(),
    ];
    if let Some(iv) = &interval {
        args.push("-read_intervals".into());
        args.push(iv.clone());
    }
    args.push("-show_entries".into());
    args.push("frame=pict_type,best_effort_timestamp_time".into());
    args.push("-of".into());
    args.push("csv=p=0".into());
    args.push(path.into());

    let mut child = Command::new(ffprobe)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("ffprobe の起動に失敗しました: {e}"))?;

    let stdout = child.stdout.take().ok_or("stdout を取得できませんでした")?;
    let reader = BufReader::new(stdout);
    let (mut ci, mut cp, mut cb) = (0usize, 0usize, 0usize);
    let mut last = window.map(|(s, _)| s).unwrap_or(0.0);

    for line in reader.lines() {
        let line = line.map_err(|e| format!("読み取りエラー: {e}"))?;
        // CSV の列順は -show_entries の指定順とは限らないため、値の内容で判別する。
        let mut pt = "";
        let mut ts: Option<f64> = None;
        for field in line.split(',') {
            let f = field.trim();
            match f {
                "I" | "P" | "B" => pt = f,
                _ => {
                    if ts.is_none() {
                        if let Ok(v) = f.parse::<f64>() {
                            ts = Some(v);
                        }
                    }
                }
            }
        }

        if let (Some(t), Some((s, e))) = (ts, window) {
            if t < s || t >= e {
                continue; // 境界の重複フレームを除外
            }
            let delta = ((t - last).max(0.0) * 1000.0) as u64;
            if delta > 0 {
                processed.fetch_add(delta, Ordering::Relaxed);
                last = t;
            }
        }

        match pt {
            "I" => ci += 1,
            "P" => cp += 1,
            "B" => cb += 1,
            _ => {}
        }
    }
    let _ = child.wait();

    let mut c = counts.lock().unwrap();
    c.0 += ci;
    c.1 += cp;
    c.2 += cb;
    Ok(())
}

/// フレーム種別(I/P/B)を「時間分割 × 並列 ffprobe」で集計し、進捗を Channel で通知する。
/// 重い処理は spawn_blocking に載せ、実行中も進捗メッセージが届くようにする。
#[tauri::command]
async fn frame_stats_parallel(
    path: String,
    stream_index: u32,
    duration: f64,
    threads: Option<usize>,
    on_progress: Channel<FrameProgress>,
) -> Result<FrameStats, String> {
    tauri::async_runtime::spawn_blocking(move || run_frame_stats(path, stream_index, duration, threads, on_progress))
        .await
        .map_err(|e| format!("解析タスクの実行に失敗しました: {e}"))?
}

fn run_frame_stats(
    path: String,
    stream_index: u32,
    duration: f64,
    threads: Option<usize>,
    on_progress: Channel<FrameProgress>,
) -> Result<FrameStats, String> {
    let ffprobe = find_ffprobe().ok_or_else(|| "ffprobe が見つかりません。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);
    let nthreads = threads.unwrap_or(cores).clamp(1, 8);

    let processed = Arc::new(AtomicU64::new(0));
    let counts = Arc::new(Mutex::new((0usize, 0usize, 0usize)));

    // 総時間が不明なら分割せず単一スキャン（進捗は不定）。
    let parallel = duration > 0.5 && nthreads > 1;
    let seg = if parallel { duration / nthreads as f64 } else { duration };

    // 開始時に一度 0% を送って、バーを即表示させる。
    let _ = on_progress.send(FrameProgress {
        progress: if parallel { 0.0 } else { -1.0 },
        i: 0,
        p: 0,
        b: 0,
    });

    let mut handles = Vec::new();
    let seg_count = if parallel { nthreads } else { 1 };
    for k in 0..seg_count {
        let ffprobe = ffprobe.clone();
        let path = path.clone();
        let processed = processed.clone();
        let counts = counts.clone();
        let (interval, window) = if parallel {
            let start = k as f64 * seg;
            let end = if k == seg_count - 1 {
                duration
            } else {
                (k as f64 + 1.0) * seg
            };
            (Some(format!("{start}%+{}", end - start)), Some((start, end)))
        } else {
            (None, None)
        };
        handles.push(std::thread::spawn(move || {
            scan_segment(&ffprobe, &path, stream_index, interval, window, &processed, &counts)
        }));
    }

    // 進捗レポート：全スレッド完了まで一定間隔で通知。
    loop {
        let all_done = handles.iter().all(|h| h.is_finished());
        let pct = if parallel {
            ((processed.load(Ordering::Relaxed) as f64 / 1000.0) / duration).clamp(0.0, 0.99)
        } else {
            -1.0 // 不定
        };
        let _ = on_progress.send(FrameProgress { progress: pct, i: 0, p: 0, b: 0 });
        if all_done {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(80));
    }

    for h in handles {
        h.join().map_err(|_| "解析スレッドが異常終了しました".to_string())??;
    }

    let (i, p, b) = *counts.lock().unwrap();
    let total = i + p + b;
    if total == 0 {
        return Err("フレーム種別を取得できませんでした。".to_string());
    }
    let _ = on_progress.send(FrameProgress { progress: 1.0, i, p, b });
    Ok(FrameStats { i, p, b, total })
}

/// EBU R128 ラウドネス測定結果。
#[derive(Serialize)]
struct Loudness {
    /// Integrated Loudness (LUFS)
    input_i: String,
    /// True Peak (dBTP)
    input_tp: String,
    /// Loudness Range (LU)
    input_lra: String,
    /// Threshold (LUFS)
    input_thresh: String,
}

/// "HH:MM:SS.ffffff" を秒に変換する。
fn parse_hms(s: &str) -> Option<f64> {
    let mut parts = s.trim().split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let sec: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

/// ffmpeg の loudnorm フィルタで EBU R128 ラウドネスを測定し、進捗を通知する。
#[tauri::command]
async fn loudness(
    path: String,
    stream_index: u32,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<Loudness, String> {
    tauri::async_runtime::spawn_blocking(move || run_loudness(path, stream_index, duration, on_progress))
        .await
        .map_err(|e| format!("測定タスクの実行に失敗しました: {e}"))?
}

fn run_loudness(
    path: String,
    stream_index: u32,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<Loudness, String> {
    let ffmpeg = find_ffmpeg()
        .ok_or_else(|| "ffmpeg が見つかりません。ラウドネス測定には ffmpeg が必要です。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let _ = on_progress.send(if duration > 0.0 { 0.0 } else { -1.0 });

    let mut child = Command::new(&ffmpeg)
        .args(["-hide_banner", "-nostats", "-progress", "pipe:1", "-i"])
        .arg(&path)
        .args([
            "-map",
            &format!("0:{stream_index}"),
            "-af",
            "loudnorm=print_format=json",
            "-f",
            "null",
            "-",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg の起動に失敗しました: {e}"))?;

    // stderr（loudnorm の JSON とログ）は別スレッドで全部吸い出す（詰まり防止）。
    let stderr_pipe = child.stderr.take().ok_or("stderr を取得できませんでした")?;
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = String::new();
        let mut reader = BufReader::new(stderr_pipe);
        use std::io::Read;
        let _ = reader.read_to_string(&mut buf);
        buf
    });

    // stdout の -progress 出力から時間を読んで進捗を算出。
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(rest) = line.strip_prefix("out_time=") {
                if duration > 0.0 {
                    if let Some(sec) = parse_hms(rest) {
                        let pct = (sec / duration).clamp(0.0, 0.99);
                        let _ = on_progress.send(pct);
                    }
                }
            }
        }
    }

    let _ = child.wait();
    let stderr = stderr_handle.join().unwrap_or_default();

    let start = stderr
        .rfind('{')
        .ok_or_else(|| format!("ラウドネス測定に失敗しました:\n{}", stderr.trim()))?;
    let end = stderr[start..]
        .find('}')
        .map(|e| start + e + 1)
        .ok_or_else(|| "ラウドネスの JSON を解釈できませんでした。".to_string())?;
    let json: serde_json::Value = serde_json::from_str(&stderr[start..end])
        .map_err(|e| format!("ラウドネスの JSON を解釈できませんでした: {e}"))?;

    let get = |k: &str| json.get(k).and_then(|v| v.as_str()).unwrap_or("—").to_string();
    let _ = on_progress.send(1.0);
    Ok(Loudness {
        input_i: get("input_i"),
        input_tp: get("input_tp"),
        input_lra: get("input_lra"),
        input_thresh: get("input_thresh"),
    })
}

/// 設定画面から ffprobe / ffmpeg のパスを上書きする（プロセス環境変数へ反映）。
#[tauri::command]
fn set_tool_paths(ffprobe: Option<String>, ffmpeg: Option<String>) {
    match ffprobe {
        Some(p) if !p.is_empty() => std::env::set_var("FFPROBE_PATH", p),
        _ => std::env::remove_var("FFPROBE_PATH"),
    }
    match ffmpeg {
        Some(p) if !p.is_empty() => std::env::set_var("FFMPEG_PATH", p),
        _ => std::env::remove_var("FFMPEG_PATH"),
    }
}

/// 指定パスへテキストを書き出す（エクスポート用）。
#[tauri::command]
fn save_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("保存に失敗しました: {e}"))
}

/// ffmpeg が利用可能かを返す（パス or null）。サムネイル機能の可否判定用。
#[tauri::command]
fn check_ffmpeg() -> Option<String> {
    find_ffmpeg().map(|p| p.to_string_lossy().into_owned())
}

/// 指定時刻のフレームを 1 枚抽出し、JPEG の data URL を返す。
#[tauri::command]
fn thumbnail(path: String, time_sec: f64, width: u32) -> Result<String, String> {
    use base64::Engine;

    let ffmpeg = find_ffmpeg()
        .ok_or_else(|| "ffmpeg が見つかりません。サムネイル表示には ffmpeg が必要です。".to_string())?;

    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let t = if time_sec.is_finite() && time_sec > 0.0 {
        time_sec
    } else {
        0.0
    };

    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-ss"])
        .arg(format!("{t}"))
        .arg("-i")
        .arg(&path)
        .args(["-frames:v", "1", "-vf"])
        .arg(format!("scale={width}:-2"))
        .args(["-f", "image2pipe", "-vcodec", "mjpeg", "-"])
        .output()
        .map_err(|e| format!("ffmpeg の実行に失敗しました: {e}"))?;

    if !output.status.success() || output.stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "フレーム抽出に失敗しました:\n{}",
            stderr.trim()
        ));
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/jpeg;base64,{b64}"))
}

/// 指定時刻のフレームを、拡張子に応じた形式(.jpg/.png)でファイル保存する。
#[tauri::command]
fn save_frame(path: String, time_sec: f64, out_path: String) -> Result<(), String> {
    let ffmpeg = find_ffmpeg()
        .ok_or_else(|| "ffmpeg が見つかりません。フレーム保存には ffmpeg が必要です。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }
    let t = if time_sec.is_finite() && time_sec > 0.0 { time_sec } else { 0.0 };

    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss"])
        .arg(format!("{t}"))
        .arg("-i")
        .arg(&path)
        .args(["-frames:v", "1"])
        .arg(&out_path)
        .output()
        .map_err(|e| format!("ffmpeg の実行に失敗しました: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("フレーム保存に失敗しました:\n{}", stderr.trim()));
    }
    Ok(())
}

/// 音声ストリームの波形画像 (showwavespic) を PNG data URL で返す。
#[tauri::command]
fn waveform(path: String, stream_index: u32, width: u32, height: u32) -> Result<String, String> {
    use base64::Engine;

    let ffmpeg = find_ffmpeg()
        .ok_or_else(|| "ffmpeg が見つかりません。波形表示には ffmpeg が必要です。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    // 音声を filter_complex に通し、生成された波形映像だけを出力にマップする。
    let filter = format!(
        "[0:{stream_index}]showwavespic=s={width}x{height}:colors=#5b9dff[wave]"
    );
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&path)
        .args(["-filter_complex", &filter, "-map", "[wave]", "-frames:v", "1"])
        .args(["-f", "image2pipe", "-vcodec", "png", "-"])
        .output()
        .map_err(|e| format!("ffmpeg の実行に失敗しました: {e}"))?;

    if !output.status.success() || output.stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("波形生成に失敗しました:\n{}", stderr.trim()));
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// 音声ストリームのスペクトログラム画像 (showspectrumpic) を PNG data URL で返す。
#[tauri::command]
fn spectrogram(path: String, stream_index: u32, width: u32, height: u32) -> Result<String, String> {
    use base64::Engine;

    let ffmpeg = find_ffmpeg()
        .ok_or_else(|| "ffmpeg が見つかりません。スペクトログラム表示には ffmpeg が必要です。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let filter = format!(
        "[0:{stream_index}]showspectrumpic=s={width}x{height}:legend=1[out]"
    );
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&path)
        .args(["-filter_complex", &filter, "-map", "[out]", "-frames:v", "1"])
        .args(["-f", "image2pipe", "-vcodec", "png", "-"])
        .output()
        .map_err(|e| format!("ffmpeg の実行に失敗しました: {e}"))?;

    if !output.status.success() || output.stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("スペクトログラム生成に失敗しました:\n{}", stderr.trim()));
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// ファイル整合性チェックの結果。
#[derive(Serialize)]
struct Integrity {
    /// デコード中に検出したエラー行数
    error_count: usize,
    /// 問題なし（エラー0）か
    ok: bool,
    /// エラーの先頭サンプル（最大30件）
    errors: Vec<String>,
}

/// ffmpeg で全体をデコードし、破損・デコードエラーを検出する（進捗つき）。
#[tauri::command]
async fn integrity_check(
    path: String,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<Integrity, String> {
    tauri::async_runtime::spawn_blocking(move || run_integrity(path, duration, on_progress))
        .await
        .map_err(|e| format!("チェックタスクの実行に失敗しました: {e}"))?
}

fn run_integrity(path: String, duration: f64, on_progress: Channel<f64>) -> Result<Integrity, String> {
    let ffmpeg = find_ffmpeg()
        .ok_or_else(|| "ffmpeg が見つかりません。整合性チェックには ffmpeg が必要です。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let _ = on_progress.send(if duration > 0.0 { 0.0 } else { -1.0 });

    let mut child = Command::new(&ffmpeg)
        .args(["-hide_banner", "-nostats", "-progress", "pipe:1", "-v", "error", "-i"])
        .arg(&path)
        .args(["-f", "null", "-"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg の起動に失敗しました: {e}"))?;

    // stderr のエラー行を別スレッドで収集
    let stderr_pipe = child.stderr.take().ok_or("stderr を取得できませんでした")?;
    let stderr_handle = std::thread::spawn(move || {
        let reader = BufReader::new(stderr_pipe);
        let mut errors: Vec<String> = Vec::new();
        let mut count = 0usize;
        for line in reader.lines().map_while(Result::ok) {
            let l = line.trim().to_string();
            if l.is_empty() {
                continue;
            }
            count += 1;
            if errors.len() < 30 {
                errors.push(l);
            }
        }
        (count, errors)
    });

    // stdout の進捗
    if let Some(stdout) = child.stdout.take() {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(rest) = line.strip_prefix("out_time=") {
                if duration > 0.0 {
                    if let Some(sec) = parse_hms(rest) {
                        let _ = on_progress.send((sec / duration).clamp(0.0, 0.99));
                    }
                }
            }
        }
    }

    let _ = child.wait();
    let (error_count, errors) = stderr_handle.join().unwrap_or((0, Vec::new()));
    let _ = on_progress.send(1.0);

    Ok(Integrity {
        error_count,
        ok: error_count == 0,
        errors,
    })
}

/// `key` の直後に続く数値を取り出す（"black_start:12.5" など）。
fn extract_after(line: &str, key: &str) -> Option<f64> {
    let idx = line.find(key)?;
    let rest = line[idx + key.len()..].trim_start();
    let num: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E'))
        .collect();
    num.parse().ok()
}

/// ffmpeg を -progress 付きで実行し、進捗を送りながら stderr（フィルタ出力）を返す共通ヘルパー。
fn ffmpeg_progress(
    ffmpeg: &Path,
    input_and_out: Vec<String>,
    duration: f64,
    on_progress: &Channel<f64>,
) -> Result<String, String> {
    let _ = on_progress.send(if duration > 0.0 { 0.0 } else { -1.0 });

    let mut args: Vec<String> = vec![
        "-hide_banner".into(),
        "-nostats".into(),
        "-progress".into(),
        "pipe:1".into(),
    ];
    args.extend(input_and_out);

    let mut child = Command::new(ffmpeg)
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffmpeg の起動に失敗しました: {e}"))?;

    let stderr_pipe = child.stderr.take().ok_or("stderr を取得できませんでした")?;
    let stderr_handle = std::thread::spawn(move || {
        let mut buf = String::new();
        use std::io::Read;
        let _ = BufReader::new(stderr_pipe).read_to_string(&mut buf);
        buf
    });

    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some(rest) = line.strip_prefix("out_time=") {
                if duration > 0.0 {
                    if let Some(sec) = parse_hms(rest) {
                        let _ = on_progress.send((sec / duration).clamp(0.0, 0.99));
                    }
                }
            }
        }
    }
    let _ = child.wait();
    let stderr = stderr_handle.join().unwrap_or_default();
    let _ = on_progress.send(1.0);
    Ok(stderr)
}

#[derive(Serialize, Clone)]
struct Interval {
    start: f64,
    end: f64,
}

#[derive(Serialize)]
struct BlackSilence {
    black: Vec<Interval>,
    silence: Vec<Interval>,
}

/// ブラックフレーム / 無音区間を検出する。
#[tauri::command]
async fn detect_black_silence(
    path: String,
    duration: f64,
    has_video: bool,
    has_audio: bool,
    on_progress: Channel<f64>,
) -> Result<BlackSilence, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg が見つかりません。".to_string())?;
        if !Path::new(&path).is_file() {
            return Err(format!("ファイルが存在しません: {path}"));
        }
        let mut a: Vec<String> = vec!["-i".into(), path.clone()];
        if has_video {
            a.push("-vf".into());
            a.push("blackdetect=d=0.1:pic_th=0.98".into());
        }
        if has_audio {
            a.push("-af".into());
            a.push("silencedetect=noise=-50dB:d=0.5".into());
        }
        a.extend(["-f".into(), "null".into(), "-".into()]);

        let stderr = ffmpeg_progress(&ffmpeg, a, duration, &on_progress)?;

        let mut black = Vec::new();
        let mut silence = Vec::new();
        let mut pending: Option<f64> = None;
        for line in stderr.lines() {
            if line.contains("black_start:") {
                if let (Some(s), Some(e)) = (
                    extract_after(line, "black_start:"),
                    extract_after(line, "black_end:"),
                ) {
                    black.push(Interval { start: s, end: e });
                }
            }
            if let Some(s) = extract_after(line, "silence_start:") {
                pending = Some(s);
            }
            if line.contains("silence_end:") {
                if let (Some(e), Some(s)) = (extract_after(line, "silence_end:"), pending.take()) {
                    silence.push(Interval { start: s, end: e });
                }
            }
        }
        Ok(BlackSilence { black, silence })
    })
    .await
    .map_err(|e| format!("検出タスクの実行に失敗しました: {e}"))?
}

/// シーンチェンジの時刻一覧を検出する。
#[tauri::command]
async fn detect_scene(
    path: String,
    duration: f64,
    threshold: f64,
    on_progress: Channel<f64>,
) -> Result<Vec<f64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg が見つかりません。".to_string())?;
        if !Path::new(&path).is_file() {
            return Err(format!("ファイルが存在しません: {path}"));
        }
        let th = threshold.clamp(0.05, 0.95);
        let a: Vec<String> = vec![
            "-i".into(),
            path.clone(),
            "-vf".into(),
            format!("select='gt(scene,{th})',showinfo"),
            "-an".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ];
        let stderr = ffmpeg_progress(&ffmpeg, a, duration, &on_progress)?;
        let mut times = Vec::new();
        for line in stderr.lines() {
            if line.contains("showinfo") && line.contains("pts_time:") {
                if let Some(t) = extract_after(line, "pts_time:") {
                    times.push(t);
                }
            }
        }
        Ok(times)
    })
    .await
    .map_err(|e| format!("検出タスクの実行に失敗しました: {e}"))?
}

#[derive(Serialize)]
struct CropResult {
    crop: String,
    w: i64,
    h: i64,
    x: i64,
    y: i64,
}

/// 黒帯を検出し推奨クロップ値を返す（先頭の数百フレームを解析）。
#[tauri::command]
fn detect_crop(path: String) -> Result<CropResult, String> {
    let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg が見つかりません。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(&path)
        .args(["-vf", "cropdetect=round=2", "-frames:v", "400", "-f", "null", "-"])
        .output()
        .map_err(|e| format!("ffmpeg の実行に失敗しました: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    // 最後の "crop=W:H:X:Y" を採用
    let mut last: Option<String> = None;
    for line in stderr.lines() {
        if let Some(idx) = line.find("crop=") {
            let val: String = line[idx + 5..]
                .chars()
                .take_while(|c| c.is_ascii_digit() || *c == ':')
                .collect();
            if val.matches(':').count() == 3 {
                last = Some(val);
            }
        }
    }
    let crop = last.ok_or_else(|| "クロップ値を検出できませんでした。".to_string())?;
    let nums: Vec<i64> = crop.split(':').filter_map(|s| s.parse().ok()).collect();
    if nums.len() != 4 {
        return Err("クロップ値の解析に失敗しました。".to_string());
    }
    Ok(CropResult {
        crop: format!("crop={crop}"),
        w: nums[0],
        h: nums[1],
        x: nums[2],
        y: nums[3],
    })
}

/// バイナリ（PDF 等）をファイル保存する。
#[tauri::command]
fn save_binary(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| format!("保存に失敗しました: {e}"))
}

fn to_hex(bytes: &[u8]) -> String {
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push_str(&format!("{b:02x}"));
    }
    s
}

#[derive(Serialize)]
struct FileHash {
    md5: String,
    sha256: String,
    size: u64,
}

/// ファイルの MD5 / SHA-256 を計算する（進捗つき）。
#[tauri::command]
async fn file_hash(path: String, on_progress: Channel<f64>) -> Result<FileHash, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use md5::Md5;
        use sha2::{Digest, Sha256};
        use std::io::Read;

        let meta = std::fs::metadata(&path).map_err(|e| format!("ファイルを開けません: {e}"))?;
        let total = meta.len();
        let file = std::fs::File::open(&path).map_err(|e| format!("ファイルを開けません: {e}"))?;
        let mut reader = BufReader::new(file);
        let mut sha = Sha256::new();
        let mut md5h = Md5::new();
        let mut buf = vec![0u8; 1 << 20];
        let mut read_total = 0u64;
        let _ = on_progress.send(if total > 0 { 0.0 } else { -1.0 });
        loop {
            let n = reader.read(&mut buf).map_err(|e| format!("読み取りエラー: {e}"))?;
            if n == 0 {
                break;
            }
            sha.update(&buf[..n]);
            md5h.update(&buf[..n]);
            read_total += n as u64;
            if total > 0 {
                let _ = on_progress.send((read_total as f64 / total as f64).clamp(0.0, 0.99));
            }
        }
        let _ = on_progress.send(1.0);
        Ok(FileHash {
            md5: to_hex(&md5h.finalize()),
            sha256: to_hex(&sha.finalize()),
            size: total,
        })
    })
    .await
    .map_err(|e| format!("ハッシュ計算に失敗しました: {e}"))?
}

/// 2ファイルの映像品質を比較する (metric: psnr / ssim / vmaf)。
/// distorted を reference の解像度へ合わせて全フレーム比較する。
#[tauri::command]
async fn quality_compare(
    distorted: String,
    reference: String,
    metric: String,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg が見つかりません。".to_string())?;
        for p in [&distorted, &reference] {
            if !Path::new(p).is_file() {
                return Err(format!("ファイルが存在しません: {p}"));
            }
        }
        let filter_name = match metric.as_str() {
            "psnr" => "psnr",
            "ssim" => "ssim",
            "vmaf" => "libvmaf",
            _ => return Err("不明な指標です。".to_string()),
        };
        let lavfi = format!(
            "[0:v][1:v]scale2ref[dist][ref];[dist]setpts=PTS-STARTPTS[d];[ref]setpts=PTS-STARTPTS[r];[d][r]{filter_name}"
        );
        let args: Vec<String> = vec![
            "-i".into(),
            distorted.clone(),
            "-i".into(),
            reference.clone(),
            "-lavfi".into(),
            lavfi,
            "-an".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ];
        let stderr = ffmpeg_progress(&ffmpeg, args, duration, &on_progress)?;

        let key = match metric.as_str() {
            "psnr" => "average:",
            "ssim" => "All:",
            _ => "VMAF score:",
        };
        for line in stderr.lines().rev() {
            if let Some(v) = extract_after(line, key) {
                return Ok(format!("{v:.4}"));
            }
        }
        if metric == "vmaf" {
            return Err(format!(
                "VMAF を計算できませんでした（この ffmpeg は libvmaf 非対応の可能性）。\n{}",
                stderr.lines().rev().take(3).collect::<Vec<_>>().join("\n")
            ));
        }
        Err(format!(
            "スコアを取得できませんでした:\n{}",
            stderr.lines().rev().take(3).collect::<Vec<_>>().join("\n")
        ))
    })
    .await
    .map_err(|e| format!("品質比較の実行に失敗しました: {e}"))?
}

/// 2ファイルの同時刻フレームを差分合成し PNG data URL で返す。
/// mode="diff": 差分そのもの（一致=黒・差異=色、amplify で強調）。
/// mode="highlight": 差異が threshold を超える箇所だけをオレンジで表示。
#[tauri::command]
fn frame_diff(
    path_a: String,
    path_b: String,
    time_sec: f64,
    mode: String,
    amplify: f64,
    threshold: f64,
    width: u32,
) -> Result<String, String> {
    use base64::Engine;

    let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg が見つかりません。".to_string())?;
    for p in [&path_a, &path_b] {
        if !Path::new(p).is_file() {
            return Err(format!("ファイルが存在しません: {p}"));
        }
    }
    let t = if time_sec.is_finite() && time_sec > 0.0 { time_sec } else { 0.0 };

    let effect = if mode == "highlight" {
        let th = threshold.clamp(1.0, 200.0);
        // 差分が th を超える画素だけオレンジ(255,140,0)、他は黒
        format!(
            "format=gray,lut=y='if(gt(val,{th}),255,0)',format=rgb24,lutrgb=r='val':g='val*55/100':b=0"
        )
    } else {
        let amp = amplify.clamp(1.0, 64.0);
        format!(
            "format=rgb24,lutrgb=r='clip(val*{amp},0,255)':g='clip(val*{amp},0,255)':b='clip(val*{amp},0,255)'"
        )
    };
    let filter = format!(
        "[0:v][1:v]scale2ref[a][b];[a][b]blend=all_mode=difference,{effect},scale={width}:-2[out]"
    );

    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-ss"])
        .arg(format!("{t}"))
        .arg("-i")
        .arg(&path_a)
        .args(["-ss"])
        .arg(format!("{t}"))
        .arg("-i")
        .arg(&path_b)
        .args(["-frames:v", "1", "-filter_complex", &filter, "-map", "[out]"])
        .args(["-f", "image2pipe", "-vcodec", "png", "-"])
        .output()
        .map_err(|e| format!("ffmpeg の実行に失敗しました: {e}"))?;

    if !output.status.success() || output.stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("差分の生成に失敗しました:\n{}", stderr.trim()));
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// 差分の時系列（各時刻の平均差分量）。差異のある時間帯の可視化に使う。
#[derive(Serialize)]
struct DiffTimeline {
    t: Vec<f64>,
    mag: Vec<f64>,
    max: f64,
}

/// 2ファイル全体を比較し、時刻ごとの平均差分量 (signalstats YAVG) を返す（進捗つき）。
#[tauri::command]
async fn diff_timeline(
    path_a: String,
    path_b: String,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<DiffTimeline, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg が見つかりません。".to_string())?;
        for p in [&path_a, &path_b] {
            if !Path::new(p).is_file() {
                return Err(format!("ファイルが存在しません: {p}"));
            }
        }
        let args: Vec<String> = vec![
            "-i".into(),
            path_a.clone(),
            "-i".into(),
            path_b.clone(),
            "-lavfi".into(),
            "[0:v][1:v]scale2ref[a][b];[a][b]blend=all_mode=difference,format=gray,signalstats,metadata=print".into(),
            "-an".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ];
        let stderr = ffmpeg_progress(&ffmpeg, args, duration, &on_progress)?;

        let mut t: Vec<f64> = Vec::new();
        let mut mag: Vec<f64> = Vec::new();
        let mut cur_t: Option<f64> = None;
        for line in stderr.lines() {
            if let Some(v) = extract_after(line, "pts_time:") {
                cur_t = Some(v);
            } else if let Some(v) = extract_after(line, "lavfi.signalstats.YAVG=") {
                if let Some(tt) = cur_t.take() {
                    t.push(tt);
                    mag.push(v);
                }
            }
        }
        if t.is_empty() {
            return Err("差分の時系列を取得できませんでした。".to_string());
        }
        // 最大2000点へ間引き
        if t.len() > 2000 {
            let step = (t.len() as f64 / 2000.0).ceil() as usize;
            t = t.iter().step_by(step).cloned().collect();
            mag = mag.iter().step_by(step).cloned().collect();
        }
        let max = mag.iter().cloned().fold(0.0_f64, f64::max);
        Ok(DiffTimeline { t, mag, max })
    })
    .await
    .map_err(|e| format!("差分解析の実行に失敗しました: {e}"))?
}

#[derive(Serialize)]
struct TsIssue {
    time: f64,
    kind: String,
    detail: String,
}

#[derive(Serialize)]
struct TsResult {
    issues: Vec<TsIssue>,
    checked: usize,
}

/// PTS/DTS のタイムスタンプ不連続（巻き戻り・大ギャップ・DTS>PTS）を検出する。
#[tauri::command]
async fn timestamp_check(
    path: String,
    stream_index: u32,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<TsResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ffprobe = find_ffprobe().ok_or_else(|| "ffprobe が見つかりません。".to_string())?;
        if !Path::new(&path).is_file() {
            return Err(format!("ファイルが存在しません: {path}"));
        }
        let _ = on_progress.send(if duration > 0.0 { 0.0 } else { -1.0 });

        let mut child = Command::new(&ffprobe)
            .args([
                "-hide_banner",
                "-loglevel",
                "error",
                "-select_streams",
                &stream_index.to_string(),
                "-show_entries",
                "packet=pts_time,dts_time,duration_time",
                "-of",
                "csv=p=0",
            ])
            .arg(&path)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("ffprobe の起動に失敗しました: {e}"))?;

        let stdout = child.stdout.take().ok_or("stdout を取得できませんでした")?;
        let reader = BufReader::new(stdout);
        let mut issues: Vec<TsIssue> = Vec::new();
        let mut checked = 0usize;
        let mut prev_pts: Option<f64> = None;
        let mut last_report = 0.0_f64;

        for line in reader.lines().map_while(Result::ok) {
            // CSV: pts_time,dts_time,duration_time（順序は内部順に依存しないよう値で判定）
            let fields: Vec<f64> = line
                .split(',')
                .map(|s| s.trim())
                .map(|s| s.parse::<f64>().unwrap_or(f64::NAN))
                .collect();
            if fields.is_empty() {
                continue;
            }
            let pts = fields.first().copied().filter(|v| v.is_finite());
            let dts = fields.get(1).copied().filter(|v| v.is_finite());
            let dur = fields.get(2).copied().filter(|v| v.is_finite());
            checked += 1;

            if let (Some(p), Some(d)) = (pts, dts) {
                if d > p + 0.001 {
                    if issues.len() < 200 {
                        issues.push(TsIssue {
                            time: p,
                            kind: "dts>pts".into(),
                            detail: format!("DTS {d:.3} > PTS {p:.3}"),
                        });
                    }
                }
            }
            if let (Some(p), Some(pp)) = (pts, prev_pts) {
                if p < pp - 0.001 {
                    if issues.len() < 200 {
                        issues.push(TsIssue {
                            time: p,
                            kind: "非単調PTS".into(),
                            detail: format!("PTS が巻き戻り: {pp:.3} → {p:.3}"),
                        });
                    }
                } else if let Some(dd) = dur {
                    if dd > 0.0 && (p - pp) > dd * 3.0 && (p - pp) > 0.5 {
                        if issues.len() < 200 {
                            issues.push(TsIssue {
                                time: p,
                                kind: "ギャップ".into(),
                                detail: format!("{:.3}s の空白 (前 {pp:.3} → {p:.3})", p - pp),
                            });
                        }
                    }
                }
            }
            if let Some(p) = pts {
                prev_pts = Some(p);
                if duration > 0.0 && p - last_report > duration / 100.0 {
                    let _ = on_progress.send((p / duration).clamp(0.0, 0.99));
                    last_report = p;
                }
            }
        }
        let _ = child.wait();
        let _ = on_progress.send(1.0);
        Ok(TsResult { issues, checked })
    })
    .await
    .map_err(|e| format!("チェックタスクの実行に失敗しました: {e}"))?
}

#[derive(Serialize)]
struct ToolInfo {
    ffmpeg_version: String,
    ffprobe_version: String,
    ffmpeg_path: String,
    ffprobe_path: String,
}

/// 検出した ffmpeg / ffprobe のバージョン行とパスを返す。
#[tauri::command]
fn tool_info() -> ToolInfo {
    let first_line = |bin: Option<PathBuf>| -> (String, String) {
        match bin {
            Some(p) => {
                let ver = Command::new(&p)
                    .arg("-version")
                    .output()
                    .ok()
                    .map(|o| {
                        String::from_utf8_lossy(&o.stdout)
                            .lines()
                            .next()
                            .unwrap_or("")
                            .to_string()
                    })
                    .unwrap_or_else(|| "—".into());
                (ver, p.to_string_lossy().into_owned())
            }
            None => ("未検出".into(), "—".into()),
        }
    };
    let (fmv, fmp) = first_line(find_ffmpeg());
    let (fpv, fpp) = first_line(find_ffprobe());
    ToolInfo {
        ffmpeg_version: fmv,
        ffprobe_version: fpv,
        ffmpeg_path: fmp,
        ffprobe_path: fpp,
    }
}

/// 映像ストリームの HDR 詳細メタデータ (MaxCLL/MaxFALL/Mastering Display) を取得する。
/// 先頭フレームの side_data を読む。ラベル→値 の配列で返す。
#[tauri::command]
fn hdr_metadata(path: String, stream_index: u32) -> Result<Vec<(String, String)>, String> {
    let ffprobe = find_ffprobe().ok_or_else(|| "ffprobe が見つかりません。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let output = Command::new(&ffprobe)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-select_streams",
            &stream_index.to_string(),
            "-read_intervals",
            "%+#1",
            "-show_frames",
            "-show_entries",
            "frame=side_data_list",
            "-of",
            "json",
        ])
        .arg(&path)
        .output()
        .map_err(|e| format!("ffprobe の実行に失敗しました: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("HDR メタデータ取得に失敗しました:\n{}", stderr.trim()));
    }

    let parsed: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("JSON を解釈できませんでした: {e}"))?;

    let mut rows: Vec<(String, String)> = Vec::new();
    if let Some(frames) = parsed.get("frames").and_then(|v| v.as_array()) {
        for frame in frames {
            if let Some(list) = frame.get("side_data_list").and_then(|v| v.as_array()) {
                for sd in list {
                    if let Some(obj) = sd.as_object() {
                        for (k, v) in obj {
                            if k == "side_data_type" {
                                continue;
                            }
                            let val = match v {
                                serde_json::Value::String(s) => s.clone(),
                                other => other.to_string(),
                            };
                            rows.push((k.clone(), val));
                        }
                    }
                }
            }
        }
    }
    Ok(rows)
}

/// 任意の ffprobe 引数を実行して stdout/stderr を返す（上級者向け・シェルは介さない）。
#[derive(Serialize)]
struct CommandOutput {
    stdout: String,
    stderr: String,
    code: i32,
}

#[tauri::command]
fn run_ffprobe(args: Vec<String>) -> Result<CommandOutput, String> {
    let ffprobe = find_ffprobe().ok_or_else(|| "ffprobe が見つかりません。".to_string())?;
    let output = Command::new(&ffprobe)
        .args(&args)
        .output()
        .map_err(|e| format!("ffprobe の実行に失敗しました: {e}"))?;
    Ok(CommandOutput {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        code: output.status.code().unwrap_or(-1),
    })
}

/// GitHub リポジトリを既定ブラウザで開く（About パネルから使用）。
#[tauri::command]
fn open_repo<R: Runtime>(app: tauri::AppHandle<R>) {
    let _ = app.opener().open_url(REPO_URL, None::<&str>);
}

/// アプリのメニューバーを構築する。
/// デフォルトメニューの不要項目を整理し、実用的な項目のみを配置する。
fn build_menu<R: Runtime>(handle: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    // macOS のネイティブ About パネルは website/authors 欄を表示しないため、
    // 表示される comments(Credits) に開発者とサイト URL を含める。
    let about_meta = AboutMetadata {
        name: Some("ffScope".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        authors: Some(vec!["CubeZeero".into()]),
        comments: Some(format!(
            "ffprobe GUI フロントエンド\n\n開発者: CubeZeero\n{REPO_URL}"
        )),
        copyright: Some("© 2026 CubeZeero".into()),
        website: Some(REPO_URL.into()),
        website_label: Some("GitHub".into()),
        ..Default::default()
    };

    // アプリメニュー（macOS の先頭メニュー）
    let app_menu = SubmenuBuilder::new(handle, "ffScope")
        .about(Some(about_meta))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // ファイル
    let open_item = MenuItemBuilder::with_id("open", "ファイルを開く…")
        .accelerator("CmdOrCtrl+O")
        .build(handle)?;
    let file_menu = SubmenuBuilder::new(handle, "ファイル")
        .item(&open_item)
        .separator()
        .close_window()
        .build()?;

    // 編集（生JSONやメタデータのコピー・貼付に必要）
    let edit_menu = SubmenuBuilder::new(handle, "編集")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // 表示
    let theme_item = MenuItemBuilder::with_id("toggle-theme", "テーマ切替")
        .accelerator("CmdOrCtrl+T")
        .build(handle)?;
    let view_menu = SubmenuBuilder::new(handle, "表示")
        .item(&theme_item)
        .separator()
        .fullscreen()
        .build()?;

    // ウィンドウ
    let window_menu = SubmenuBuilder::new(handle, "ウィンドウ")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    // ヘルプ
    let repo_item = MenuItemBuilder::with_id("repo", "GitHub リポジトリを開く").build(handle)?;
    let help_menu = SubmenuBuilder::new(handle, "ヘルプ")
        .item(&repo_item)
        .build()?;

    Menu::with_items(
        handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

/// メニュー項目のクリックをフロントエンドへ橋渡しする。
fn on_menu_event<R: Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "open" => {
            let _ = app.emit("menu:open", ());
        }
        "toggle-theme" => {
            let _ = app.emit("menu:toggle-theme", ());
        }
        "repo" => {
            let _ = app.opener().open_url(REPO_URL, None::<&str>);
        }
        _ => {}
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // ウィンドウの位置・サイズを記憶（デスクトップのみ）
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
    }

    builder
        .menu(build_menu)
        .on_menu_event(on_menu_event)
        .invoke_handler(tauri::generate_handler![
            check_ffprobe,
            check_ffmpeg,
            probe,
            bitrate_series,
            frame_stats,
            frame_stats_parallel,
            loudness,
            save_text,
            thumbnail,
            save_frame,
            waveform,
            spectrogram,
            integrity_check,
            detect_black_silence,
            detect_scene,
            detect_crop,
            timestamp_check,
            tool_info,
            hdr_metadata,
            run_ffprobe,
            open_repo,
            save_binary,
            file_hash,
            quality_compare,
            frame_diff,
            diff_timeline,
            set_tool_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
