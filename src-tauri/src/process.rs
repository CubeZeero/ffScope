use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

pub(crate) fn parse_hms(s: &str) -> Option<f64> {
    let mut parts = s.trim().split(':');
    let h: f64 = parts.next()?.parse().ok()?;
    let m: f64 = parts.next()?.parse().ok()?;
    let sec: f64 = parts.next()?.parse().ok()?;
    Some(h * 3600.0 + m * 60.0 + sec)
}

/// `key` の直後に続く数値を取り出す（"black_start:12.5" など）。
pub(crate) fn extract_after(line: &str, key: &str) -> Option<f64> {
    let idx = line.find(key)?;
    let rest = line[idx + key.len()..].trim_start();
    let num: String = rest
        .chars()
        .take_while(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+' | 'e' | 'E'))
        .collect();
    num.parse().ok()
}

/// ffmpeg を -progress 付きで実行し、進捗を送りながら stderr（フィルタ出力）を返す共通ヘルパー。
pub(crate) fn ffmpeg_progress(
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
    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg の終了待機に失敗しました: {e}"))?;
    let stderr = stderr_handle
        .join()
        .map_err(|_| "ffmpeg のログ読み取りに失敗しました。".to_string())?;
    if !status.success() {
        return Err(format!(
            "ffmpeg の解析に失敗しました (code {}):\n{}",
            status.code().unwrap_or(-1),
            stderr
        ));
    }
    let _ = on_progress.send(1.0);
    Ok(stderr)
}

#[cfg(test)]
mod progress_tests {
    use super::*;
    #[test]
    fn failed_ffmpeg_analysis_is_not_reported_as_a_clean_scan() {
        let ffmpeg = crate::tools::find_ffmpeg().expect("ffmpeg required for integration test");
        let result = ffmpeg_progress(
            &ffmpeg,
            vec!["-ffscope-invalid-option".into()],
            1.0,
            &Channel::new(|_| Ok(())),
        );
        assert!(result.is_err());
    }
}
