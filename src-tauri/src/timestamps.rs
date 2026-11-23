use crate::tools::find_ffprobe;
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

const TOLERANCE: f64 = 0.001;
const ISSUE_LIMIT: usize = 200;

#[derive(Serialize)]
pub(crate) struct TsIssue {
    time: f64,
    kind: String,
    detail: String,
}

#[derive(Serialize)]
pub(crate) struct TsResult {
    issues: Vec<TsIssue>,
    checked: usize,
}

#[derive(Default)]
struct PacketTime {
    pts: Option<f64>,
    dts: Option<f64>,
    duration: Option<f64>,
}

fn parse_packet(line: &str) -> Option<PacketTime> {
    let mut packet = PacketTime::default();
    let mut found = false;
    for field in line.split('|') {
        let Some((key, value)) = field.split_once('=') else {
            continue;
        };
        let target = match key {
            "pts_time" => &mut packet.pts,
            "dts_time" => &mut packet.dts,
            "duration_time" => &mut packet.duration,
            _ => continue,
        };
        found = true;
        *target = value.parse::<f64>().ok().filter(|v| v.is_finite());
    }
    found.then_some(packet)
}

#[derive(Default)]
struct Checker {
    issues: Vec<TsIssue>,
    checked: usize,
    previous_dts: Option<f64>,
    // Only timing pairs are retained, not decoded frames or full packet JSON.
    presentation: Vec<(f64, f64)>,
}

impl Checker {
    fn issue(&mut self, time: f64, kind: &str, detail: String) {
        if self.issues.len() < ISSUE_LIMIT {
            self.issues.push(TsIssue {
                time,
                kind: kind.into(),
                detail,
            });
        }
    }

    fn push(&mut self, packet: PacketTime) {
        self.checked += 1;
        if let Some(dts) = packet.dts {
            // Packet order is decode order. PTS may legitimately move backwards.
            if let Some(previous) = self.previous_dts {
                if dts < previous - TOLERANCE {
                    self.issue(
                        packet.pts.unwrap_or(dts),
                        "非単調DTS",
                        format!("DTS が巻き戻り: {previous:.3} → {dts:.3}"),
                    );
                }
            }
            self.previous_dts = Some(dts);
            if let Some(pts) = packet.pts {
                if dts > pts + TOLERANCE {
                    self.issue(pts, "dts>pts", format!("DTS {dts:.3} > PTS {pts:.3}"));
                }
            }
        }
        if let Some(pts) = packet.pts {
            // Unknown duration is not evidence of a gap; do not assume CFR.
            let duration = packet.duration.filter(|d| *d > 0.0).unwrap_or(0.0);
            self.presentation.push((pts, duration));
        }
    }

    fn finish(mut self) -> TsResult {
        self.presentation
            .sort_unstable_by(|a, b| a.0.total_cmp(&b.0));
        let mut covered: Option<(f64, f64)> = None;
        // Merge covered intervals in presentation order. Long VFR frames,
        // overlaps and B-frame reordering must not look like missing frames.
        for i in 0..self.presentation.len() {
            let (pts, duration) = self.presentation[i];
            if let Some((end, previous_duration)) = covered {
                let gap = pts - end;
                if previous_duration > 0.0
                    && gap > 0.5 + TOLERANCE
                    && gap > previous_duration * 2.0 + TOLERANCE
                {
                    self.issue(
                        pts,
                        "ギャップ",
                        format!("{gap:.3}s の未カバー区間 ({end:.3} → {pts:.3})"),
                    );
                }
                if pts + duration >= end {
                    covered = Some((pts + duration, duration));
                }
            } else {
                covered = Some((pts + duration, duration));
            }
        }
        self.issues.sort_by(|a, b| a.time.total_cmp(&b.time));
        TsResult {
            issues: self.issues,
            checked: self.checked,
        }
    }
}

#[tauri::command]
pub(crate) async fn timestamp_check(
    path: String,
    stream_index: u32,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<TsResult, String> {
    tauri::async_runtime::spawn_blocking(move || scan(path, stream_index, duration, on_progress))
        .await
        .map_err(|e| format!("チェックタスクの実行に失敗しました: {e}"))?
}

fn scan(
    path: String,
    stream_index: u32,
    duration: f64,
    progress: Channel<f64>,
) -> Result<TsResult, String> {
    let ffprobe = find_ffprobe().ok_or("ffprobe が見つかりません。")?;
    if !Path::new(&path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }
    let _ = progress.send(if duration > 0.0 { 0.0 } else { -1.0 });
    let mut child = Command::new(ffprobe)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-select_streams",
            &stream_index.to_string(),
            "-show_entries",
            "packet=pts_time,dts_time,duration_time",
            "-of",
            "compact=p=0:nk=0",
        ])
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffprobe の起動に失敗しました: {e}"))?;
    let stdout = child.stdout.take().ok_or("stdout を取得できませんでした")?;
    let mut stderr = child.stderr.take().ok_or("stderr を取得できませんでした")?;
    let errors = std::thread::spawn(move || {
        let mut output = Vec::new();
        let mut buffer = [0u8; 4096];
        while let Ok(n) = stderr.read(&mut buffer) {
            if n == 0 {
                break;
            }
            let keep = n.min(65536usize.saturating_sub(output.len()));
            output.extend_from_slice(&buffer[..keep]);
        }
        String::from_utf8_lossy(&output).into_owned()
    });
    let mut checker = Checker::default();
    let mut last_report = 0.0;
    let read_result: Result<(), String> = (|| {
        for line in BufReader::new(stdout).lines() {
            let line = line.map_err(|e| format!("タイムスタンプの読み取りに失敗しました: {e}"))?;
            if let Some(packet) = parse_packet(&line) {
                if duration > 0.0 {
                    let position = packet.pts.or(packet.dts).unwrap_or(0.0);
                    if position - last_report > duration / 100.0 {
                        let _ = progress.send((position / duration).clamp(0.0, 0.95));
                        last_report = position;
                    }
                }
                checker.push(packet);
            }
        }
        Ok(())
    })();
    if read_result.is_err() {
        let _ = child.kill();
    }
    let status = child
        .wait()
        .map_err(|e| format!("ffprobe の終了待機に失敗しました: {e}"))?;
    let errors = errors.join().unwrap_or_default();
    read_result?;
    if !status.success() {
        return Err(format!("ffprobe の解析に失敗しました:\n{}", errors.trim()));
    }
    if checker.checked == 0 {
        return Err("タイムスタンプを確認できるパケットがありません。".into());
    }
    let result = checker.finish();
    let _ = progress.send(1.0);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check(packets: &[(f64, f64, f64)]) -> TsResult {
        let mut checker = Checker::default();
        for &(pts, dts, duration) in packets {
            checker.push(PacketTime {
                pts: Some(pts),
                dts: Some(dts),
                duration: Some(duration),
            });
        }
        checker.finish()
    }

    #[test]
    fn normal_b_frame_reordering_and_negative_initial_dts() {
        let result = check(&[
            (0.0, -0.08, 0.04),
            (0.12, -0.04, 0.04),
            (0.04, 0.0, 0.04),
            (0.08, 0.04, 0.04),
            (0.16, 0.08, 0.04),
        ]);
        assert_eq!(result.checked, 5);
        assert!(result.issues.is_empty());
    }

    #[test]
    fn detects_dts_rollback_and_real_gap() {
        assert!(check(&[(0.0, 0.0, 0.04), (0.08, -0.04, 0.04)])
            .issues
            .iter()
            .any(|i| i.kind == "非単調DTS"));
        assert!(check(&[(0.0, 0.0, 0.04), (2.0, 2.0, 0.04)])
            .issues
            .iter()
            .any(|i| i.kind == "ギャップ"));
    }

    #[test]
    fn long_vfr_frames_overlapping_intervals_and_unknown_durations() {
        assert!(check(&[(0.0, 0.0, 2.0), (2.0, 2.0, 0.04)])
            .issues
            .is_empty());
        assert!(
            check(&[(0.0, 0.0, 3.0), (0.5, 0.5, 0.04), (3.0, 3.0, 0.04)])
                .issues
                .is_empty()
        );
        assert!(check(&[(0.0, 0.0, 0.0), (2.0, 2.0, 0.0)]).issues.is_empty());
    }

    #[test]
    fn keyed_fields_are_order_independent_and_ignore_side_data() {
        let p = parse_packet(
            "duration_time=0.04|dts_time=-0.08|pts_time=0|side_data_type=Skip Samples",
        )
        .unwrap();
        assert_eq!(p.pts, Some(0.0));
        assert_eq!(p.dts, Some(-0.08));
        assert_eq!(p.duration, Some(0.04));
        assert!(parse_packet("pts_time=N/A|dts_time=NaN")
            .unwrap()
            .pts
            .is_none());
        assert!(parse_packet("side_data_type=Skip Samples").is_none());
    }

    #[test]
    fn normal_h264_mp4_has_no_issues() {
        let ffmpeg = crate::tools::find_ffmpeg().expect("ffmpeg required for integration test");
        let path =
            std::env::temp_dir().join(format!("ffscope-timestamps-{}.mp4", std::process::id()));
        let status = Command::new(ffmpeg)
            .args([
                "-y",
                "-v",
                "error",
                "-f",
                "lavfi",
                "-i",
                "testsrc2=s=160x90:r=25:d=2",
                "-c:v",
                "libx264",
                "-bf",
                "3",
                "-g",
                "25",
            ])
            .arg(&path)
            .status()
            .unwrap();
        assert!(status.success());
        let result = scan(
            path.to_string_lossy().into_owned(),
            0,
            2.0,
            Channel::new(|_| Ok(())),
        );
        let _ = std::fs::remove_file(path);
        let result = result.unwrap();
        assert_eq!(result.checked, 50);
        assert!(result.issues.is_empty());
    }
}
