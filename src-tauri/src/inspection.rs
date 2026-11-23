use crate::process::{extract_after, ffmpeg_progress, parse_hms};
use crate::tools::find_ffmpeg;
use serde::Serialize;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::Command;
use std::process::Stdio;
use tauri::ipc::Channel;

#[derive(Serialize)]
pub(crate) struct Integrity {
    /// デコード中に検出したエラー行数
    error_count: usize,
    /// 問題なし（エラー0）か
    ok: bool,
    /// エラーの先頭サンプル（最大30件）
    errors: Vec<String>,
}

/// ffmpeg で全体をデコードし、破損・デコードエラーを検出する（進捗つき）。
#[tauri::command]
pub(crate) async fn integrity_check(
    path: String,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<Integrity, String> {
    tauri::async_runtime::spawn_blocking(move || run_integrity(path, duration, on_progress))
        .await
        .map_err(|e| format!("チェックタスクの実行に失敗しました: {e}"))?
}

fn run_integrity(
    path: String,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<Integrity, String> {
    let ffmpeg = find_ffmpeg().ok_or_else(|| {
        "ffmpeg が見つかりません。整合性チェックには ffmpeg が必要です。".to_string()
    })?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let _ = on_progress.send(if duration > 0.0 { 0.0 } else { -1.0 });

    let mut child = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-nostats",
            "-progress",
            "pipe:1",
            "-v",
            "error",
            "-i",
        ])
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

    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg の終了待機に失敗しました: {e}"))?;
    let (mut error_count, mut errors) = stderr_handle
        .join()
        .map_err(|_| "整合性チェックのログ読み取りに失敗しました。".to_string())?;
    if !status.success() && error_count == 0 {
        error_count = 1;
        errors.push(format!(
            "ffmpeg exited unsuccessfully (code {})",
            status.code().unwrap_or(-1)
        ));
    }
    let _ = on_progress.send(1.0);

    Ok(Integrity {
        error_count,
        ok: error_count == 0,
        errors,
    })
}

#[derive(Serialize, Clone)]
pub(crate) struct Interval {
    start: f64,
    end: f64,
}

#[derive(Serialize)]
pub(crate) struct BlackSilence {
    black: Vec<Interval>,
    silence: Vec<Interval>,
}

/// ブラックフレーム / 無音区間を検出する。
#[tauri::command]
pub(crate) async fn detect_black_silence(
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
pub(crate) async fn detect_scene(
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
pub(crate) struct CropResult {
    crop: String,
    w: i64,
    h: i64,
    x: i64,
    y: i64,
}

/// 黒帯を検出し推奨クロップ値を返す（先頭の数百フレームを解析）。
#[tauri::command]
pub(crate) async fn detect_crop(path: String) -> Result<CropResult, String> {
    tauri::async_runtime::spawn_blocking(move || execute_detect_crop(path))
        .await
        .map_err(|e| format!("処理タスクに失敗しました: {e}"))?
}

fn execute_detect_crop(path: String) -> Result<CropResult, String> {
    let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg が見つかりません。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-i"])
        .arg(&path)
        .args([
            "-vf",
            "cropdetect=round=2",
            "-frames:v",
            "400",
            "-f",
            "null",
            "-",
        ])
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
