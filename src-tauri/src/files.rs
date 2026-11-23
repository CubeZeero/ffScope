use serde::Serialize;
use std::io::BufReader;
use tauri::ipc::Channel;

/// 指定パスへテキストを書き出す（エクスポート用）。
#[tauri::command]
pub(crate) fn save_text(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("保存に失敗しました: {e}"))
}

/// ffmpeg が利用可能かを返す（パス or null）。サムネイル機能の可否判定用。
#[tauri::command]
pub(crate) fn save_binary(path: String, data: Vec<u8>) -> Result<(), String> {
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
pub(crate) struct FileHash {
    md5: String,
    sha256: String,
    size: u64,
}

/// ファイルの MD5 / SHA-256 を計算する（進捗つき）。
#[tauri::command]
pub(crate) async fn file_hash(path: String, on_progress: Channel<f64>) -> Result<FileHash, String> {
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
        let mut last_progress = std::time::Instant::now();
        let _ = on_progress.send(if total > 0 { 0.0 } else { -1.0 });
        loop {
            let n = reader
                .read(&mut buf)
                .map_err(|e| format!("読み取りエラー: {e}"))?;
            if n == 0 {
                break;
            }
            sha.update(&buf[..n]);
            md5h.update(&buf[..n]);
            read_total += n as u64;
            if total > 0 && last_progress.elapsed().as_millis() >= 100 {
                let _ = on_progress.send((read_total as f64 / total as f64).clamp(0.0, 0.99));
                last_progress = std::time::Instant::now();
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
