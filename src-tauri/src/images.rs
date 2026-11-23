use crate::tools::find_ffmpeg;
use std::collections::VecDeque;
use std::path::Path;
use std::process::Command;
use std::sync::{Mutex, OnceLock};

#[derive(PartialEq, Eq)]
struct ThumbnailKey {
    path: String,
    ffmpeg: std::path::PathBuf,
    modified: std::time::SystemTime,
    size: u64,
    time: u64,
    width: u32,
}

#[derive(Default)]
struct ThumbnailCache {
    entries: VecDeque<(ThumbnailKey, String)>,
    bytes: usize,
}
impl ThumbnailCache {
    const MAX_BYTES: usize = 24 * 1024 * 1024;
    fn get(&mut self, key: &ThumbnailKey) -> Option<String> {
        let index = self
            .entries
            .iter()
            .position(|(candidate, _)| candidate == key)?;
        let entry = self.entries.remove(index)?;
        let result = entry.1.clone();
        self.entries.push_back(entry);
        Some(result)
    }
    fn insert(&mut self, key: ThumbnailKey, value: String) {
        if value.len() > Self::MAX_BYTES {
            return;
        }
        if let Some(index) = self
            .entries
            .iter()
            .position(|(candidate, _)| candidate == &key)
        {
            self.bytes -= self.entries.remove(index).unwrap().1.len();
        }
        self.bytes += value.len();
        self.entries.push_back((key, value));
        while self.bytes > Self::MAX_BYTES || self.entries.len() > 48 {
            self.bytes -= self.entries.pop_front().unwrap().1.len();
        }
    }
}
fn thumbnail_cache() -> &'static Mutex<ThumbnailCache> {
    static CACHE: OnceLock<Mutex<ThumbnailCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(ThumbnailCache::default()))
}

/// 指定時刻のフレームを 1 枚抽出し、JPEG の data URL を返す。
#[tauri::command]
pub(crate) async fn thumbnail(path: String, time_sec: f64, width: u32) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || run_thumbnail(path, time_sec, width))
        .await
        .map_err(|e| format!("画像抽出タスクに失敗しました: {e}"))?
}

fn run_thumbnail(path: String, time_sec: f64, width: u32) -> Result<String, String> {
    use base64::Engine;

    let ffmpeg = find_ffmpeg().ok_or_else(|| {
        "ffmpeg が見つかりません。サムネイル表示には ffmpeg が必要です。".to_string()
    })?;

    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let t = if time_sec.is_finite() && time_sec > 0.0 {
        time_sec
    } else {
        0.0
    };
    // Recheck source metadata on every lookup; edits at the same path invalidate previews.
    let key = std::fs::metadata(&path).ok().and_then(|metadata| {
        Some(ThumbnailKey {
            path: path.clone(),
            ffmpeg: ffmpeg.clone(),
            modified: metadata.modified().ok()?,
            size: metadata.len(),
            time: t.to_bits(),
            width,
        })
    });
    if let Some(cached) = key
        .as_ref()
        .and_then(|key| thumbnail_cache().lock().ok()?.get(key))
    {
        return Ok(cached);
    }

    let output = Command::new(&ffmpeg)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-threads",
            "2",
            "-filter_threads",
            "1",
            "-ss",
        ])
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
        return Err(format!("フレーム抽出に失敗しました:\n{}", stderr.trim()));
    }

    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    let result = format!("data:image/jpeg;base64,{b64}");
    if let (Some(key), Ok(mut cache)) = (key, thumbnail_cache().lock()) {
        cache.insert(key, result.clone());
    }
    Ok(result)
}

/// 指定時刻のフレームを、拡張子に応じた形式(.jpg/.png)でファイル保存する。
#[tauri::command]
pub(crate) async fn save_frame(
    path: String,
    time_sec: f64,
    out_path: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || execute_save_frame(path, time_sec, out_path))
        .await
        .map_err(|e| format!("処理タスクに失敗しました: {e}"))?
}

fn execute_save_frame(path: String, time_sec: f64, out_path: String) -> Result<(), String> {
    let ffmpeg = find_ffmpeg().ok_or_else(|| {
        "ffmpeg が見つかりません。フレーム保存には ffmpeg が必要です。".to_string()
    })?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }
    let t = if time_sec.is_finite() && time_sec > 0.0 {
        time_sec
    } else {
        0.0
    };

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cached_thumbnail_changes_when_source_is_replaced() {
        let path =
            std::env::temp_dir().join(format!("ffscope-thumbnail-{}.ppm", std::process::id()));
        std::fs::write(&path, b"P3\n2 2\n255\n255 0 0 255 0 0 255 0 0 255 0 0\n").unwrap();
        let source = path.to_string_lossy().into_owned();
        let first = run_thumbnail(source.clone(), 0.0, 16).unwrap();
        assert_eq!(first, run_thumbnail(source.clone(), 0.0, 16).unwrap());
        // Different byte length invalidates even on filesystems with coarse mtime resolution.
        std::fs::write(
            &path,
            b"P3\n# new source\n2 2\n255\n0 255 0 0 255 0 0 255 0 0 255 0\n",
        )
        .unwrap();
        let updated = run_thumbnail(source, 0.0, 16);
        let _ = std::fs::remove_file(path);
        assert_ne!(first, updated.unwrap());
    }
}
