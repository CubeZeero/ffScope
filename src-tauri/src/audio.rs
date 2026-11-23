use crate::process::ffmpeg_progress;
use crate::tools::find_ffmpeg;
use serde::Serialize;
use std::path::Path;
use std::process::Command;
use tauri::ipc::Channel;

/// EBU R128 ラウドネス測定結果。
#[derive(Serialize)]
pub(crate) struct Loudness {
    /// Integrated Loudness (LUFS)
    input_i: String,
    /// True Peak (dBTP)
    input_tp: String,
    /// Loudness Range (LU)
    input_lra: String,
    /// Threshold (LUFS)
    input_thresh: String,
}

/// ffmpeg の loudnorm フィルタで EBU R128 ラウドネスを測定し、進捗を通知する。
#[tauri::command]
pub(crate) async fn loudness(
    path: String,
    stream_index: u32,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<Loudness, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_loudness(path, stream_index, duration, on_progress)
    })
    .await
    .map_err(|e| format!("測定タスクの実行に失敗しました: {e}"))?
}

fn run_loudness(
    path: String,
    stream_index: u32,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<Loudness, String> {
    let ffmpeg = find_ffmpeg().ok_or_else(|| {
        "ffmpeg が見つかりません。ラウドネス測定には ffmpeg が必要です。".to_string()
    })?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let stderr = ffmpeg_progress(
        &ffmpeg,
        vec![
            "-i".into(),
            path,
            "-map".into(),
            format!("0:{stream_index}"),
            "-af".into(),
            "loudnorm=print_format=json".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ],
        duration,
        &on_progress,
    )?;

    let start = stderr
        .rfind('{')
        .ok_or_else(|| format!("ラウドネス測定に失敗しました:\n{}", stderr.trim()))?;
    let end = stderr[start..]
        .find('}')
        .map(|e| start + e + 1)
        .ok_or_else(|| "ラウドネスの JSON を解釈できませんでした。".to_string())?;
    let json: serde_json::Value = serde_json::from_str(&stderr[start..end])
        .map_err(|e| format!("ラウドネスの JSON を解釈できませんでした: {e}"))?;

    let get = |k: &str| {
        json.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("—")
            .to_string()
    };
    let _ = on_progress.send(1.0);
    Ok(Loudness {
        input_i: get("input_i"),
        input_tp: get("input_tp"),
        input_lra: get("input_lra"),
        input_thresh: get("input_thresh"),
    })
}

/// 音声ストリームの波形画像 (showwavespic) を PNG data URL で返す。
#[tauri::command]
pub(crate) async fn waveform(
    path: String,
    stream_index: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        execute_waveform(path, stream_index, width, height)
    })
    .await
    .map_err(|e| format!("処理タスクに失敗しました: {e}"))?
}

fn execute_waveform(
    path: String,
    stream_index: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    use base64::Engine;

    let ffmpeg = find_ffmpeg()
        .ok_or_else(|| "ffmpeg が見つかりません。波形表示には ffmpeg が必要です。".to_string())?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    // 音声を filter_complex に通し、生成された波形映像だけを出力にマップする。
    let filter = format!("[0:{stream_index}]showwavespic=s={width}x{height}:colors=#5b9dff[wave]");
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&path)
        .args([
            "-filter_complex",
            &filter,
            "-map",
            "[wave]",
            "-frames:v",
            "1",
        ])
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
pub(crate) async fn spectrogram(
    path: String,
    stream_index: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        execute_spectrogram(path, stream_index, width, height)
    })
    .await
    .map_err(|e| format!("処理タスクに失敗しました: {e}"))?
}

fn execute_spectrogram(
    path: String,
    stream_index: u32,
    width: u32,
    height: u32,
) -> Result<String, String> {
    use base64::Engine;

    let ffmpeg = find_ffmpeg().ok_or_else(|| {
        "ffmpeg が見つかりません。スペクトログラム表示には ffmpeg が必要です。".to_string()
    })?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let filter = format!("[0:{stream_index}]showspectrumpic=s={width}x{height}:legend=1[out]");
    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-i"])
        .arg(&path)
        .args([
            "-filter_complex",
            &filter,
            "-map",
            "[out]",
            "-frames:v",
            "1",
        ])
        .args(["-f", "image2pipe", "-vcodec", "png", "-"])
        .output()
        .map_err(|e| format!("ffmpeg の実行に失敗しました: {e}"))?;

    if !output.status.success() || output.stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "スペクトログラム生成に失敗しました:\n{}",
            stderr.trim()
        ));
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/png;base64,{b64}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_process_runner_preserves_loudness_measurements() {
        let ffmpeg = find_ffmpeg().expect("ffmpeg required for integration test");
        let path =
            std::env::temp_dir().join(format!("ffscope-loudness-{}.wav", std::process::id()));
        let status = Command::new(ffmpeg)
            .args([
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "sine=frequency=1000:duration=1",
            ])
            .arg(&path)
            .status()
            .unwrap();
        assert!(status.success());
        let result = run_loudness(
            path.to_string_lossy().into_owned(),
            0,
            1.0,
            Channel::new(|_| Ok(())),
        );
        let _ = std::fs::remove_file(path);
        let result = result.unwrap();
        assert!(result.input_i.parse::<f64>().unwrap().is_finite());
        assert!(result.input_tp.parse::<f64>().unwrap().is_finite());
        assert!(result.input_lra.parse::<f64>().unwrap() >= 0.0);
    }
}
