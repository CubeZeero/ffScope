use std::path::{Path, PathBuf};

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
        "/opt/homebrew/bin", // macOS Apple Silicon (Homebrew)
        "/usr/local/bin",    // macOS Intel / Linux
        "/usr/bin",          // Linux
        "/snap/bin",         // Linux (snap)
        "C:\\ffmpeg\\bin",   // Windows よくある手動配置
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

pub(crate) fn find_ffprobe() -> Option<PathBuf> {
    find_tool("ffprobe", "FFPROBE_PATH")
}

pub(crate) fn find_ffmpeg() -> Option<PathBuf> {
    find_tool("ffmpeg", "FFMPEG_PATH")
}

use serde::Serialize;
use std::process::Command;

#[tauri::command]
pub(crate) fn set_tool_paths(ffprobe: Option<String>, ffmpeg: Option<String>) {
    match ffprobe {
        Some(p) if !p.is_empty() => std::env::set_var("FFPROBE_PATH", p),
        _ => std::env::remove_var("FFPROBE_PATH"),
    }
    match ffmpeg {
        Some(p) if !p.is_empty() => std::env::set_var("FFMPEG_PATH", p),
        _ => std::env::remove_var("FFMPEG_PATH"),
    }
}

#[tauri::command]
pub(crate) fn check_ffmpeg() -> Option<String> {
    find_ffmpeg().map(|p| p.to_string_lossy().into_owned())
}

#[derive(Serialize)]
pub(crate) struct ToolInfo {
    ffmpeg_version: String,
    ffprobe_version: String,
    ffmpeg_path: String,
    ffprobe_path: String,
}

/// 検出した ffmpeg / ffprobe のバージョン行とパスを返す。
#[tauri::command]
pub(crate) async fn tool_info() -> Result<ToolInfo, String> {
    tauri::async_runtime::spawn_blocking(execute_tool_info)
        .await
        .map_err(|e| format!("ツール情報の取得に失敗しました: {e}"))
}

fn execute_tool_info() -> ToolInfo {
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
