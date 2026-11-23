use crate::tools::find_ffprobe;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Command;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ipc::Channel;

/// I/P/B フレームの分布。
#[derive(Serialize)]
pub(crate) struct FrameStats {
    i: usize,
    p: usize,
    b: usize,
    total: usize,
}

/// 指定映像ストリームのフレーム種別(I/P/B)を集計する。
/// -show_frames は重いので、フロント側で明示的に要求された時のみ呼ぶ想定。
#[tauri::command]
pub(crate) async fn frame_stats(path: String, stream_index: u32) -> Result<FrameStats, String> {
    tauri::async_runtime::spawn_blocking(move || execute_frame_stats(path, stream_index))
        .await
        .map_err(|e| format!("処理タスクに失敗しました: {e}"))?
}

fn execute_frame_stats(path: String, stream_index: u32) -> Result<FrameStats, String> {
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
pub(crate) struct FrameProgress {
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
pub(crate) async fn frame_stats_parallel(
    path: String,
    stream_index: u32,
    duration: f64,
    threads: Option<usize>,
    on_progress: Channel<FrameProgress>,
) -> Result<FrameStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_frame_stats(path, stream_index, duration, threads, on_progress)
    })
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
    let seg = if parallel {
        duration / nthreads as f64
    } else {
        duration
    };

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
            (
                Some(format!("{start}%+{}", end - start)),
                Some((start, end)),
            )
        } else {
            (None, None)
        };
        handles.push(std::thread::spawn(move || {
            scan_segment(
                &ffprobe,
                &path,
                stream_index,
                interval,
                window,
                &processed,
                &counts,
            )
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
        let _ = on_progress.send(FrameProgress {
            progress: pct,
            i: 0,
            p: 0,
            b: 0,
        });
        if all_done {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(80));
    }

    for h in handles {
        h.join()
            .map_err(|_| "解析スレッドが異常終了しました".to_string())??;
    }

    let (i, p, b) = *counts.lock().unwrap();
    let total = i + p + b;
    if total == 0 {
        return Err("フレーム種別を取得できませんでした。".to_string());
    }
    let _ = on_progress.send(FrameProgress {
        progress: 1.0,
        i,
        p,
        b,
    });
    Ok(FrameStats { i, p, b, total })
}
