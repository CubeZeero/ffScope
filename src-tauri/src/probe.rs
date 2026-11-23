use crate::tools::find_ffprobe;
use serde::Serialize;
use std::path::Path;
use std::process::Command;

#[derive(Serialize)]
pub(crate) struct ProbeResult {
    /// ffprobe が出力した JSON をそのまま構造化したもの
    data: serde_json::Value,
    /// 実際に使用した ffprobe のパス
    ffprobe_path: String,
}

/// 起動時チェック用：見つかった ffprobe のパスを返す（なければ null）。
#[tauri::command]
pub(crate) fn check_ffprobe() -> Option<String> {
    find_ffprobe().map(|p| p.to_string_lossy().into_owned())
}

/// 指定ファイルを ffprobe で解析し、JSON を返す。
#[tauri::command]
pub(crate) async fn probe(path: String) -> Result<ProbeResult, String> {
    tauri::async_runtime::spawn_blocking(move || run_probe(path))
        .await
        .map_err(|e| format!("解析タスクに失敗しました: {e}"))?
}

fn run_probe(path: String) -> Result<ProbeResult, String> {
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

/// 映像ストリームの HDR 詳細メタデータ (MaxCLL/MaxFALL/Mastering Display) を取得する。
/// 先頭フレームの side_data を読む。ラベル→値 の配列で返す。
#[tauri::command]
pub(crate) async fn hdr_metadata(
    path: String,
    stream_index: u32,
) -> Result<Vec<(String, String)>, String> {
    tauri::async_runtime::spawn_blocking(move || execute_hdr_metadata(path, stream_index))
        .await
        .map_err(|e| format!("処理タスクに失敗しました: {e}"))?
}

fn execute_hdr_metadata(path: String, stream_index: u32) -> Result<Vec<(String, String)>, String> {
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
        return Err(format!(
            "HDR メタデータ取得に失敗しました:\n{}",
            stderr.trim()
        ));
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
pub(crate) struct CommandOutput {
    stdout: String,
    stderr: String,
    code: i32,
}

#[tauri::command]
pub(crate) async fn run_ffprobe(args: Vec<String>) -> Result<CommandOutput, String> {
    tauri::async_runtime::spawn_blocking(move || execute_run_ffprobe(args))
        .await
        .map_err(|e| format!("処理タスクに失敗しました: {e}"))?
}

fn execute_run_ffprobe(args: Vec<String>) -> Result<CommandOutput, String> {
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
