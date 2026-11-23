use crate::tools::find_ffprobe;
#[cfg(test)]
use serde::Deserialize;
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};

#[cfg(test)]
#[derive(Deserialize)]
struct PacketOutput {
    #[serde(default)]
    packets: Vec<RawPacket>,
}

#[cfg(test)]
#[derive(Deserialize)]
struct RawPacket {
    pts_time: Option<String>,
    dts_time: Option<String>,
    size: Option<String>,
    flags: Option<String>,
}

#[cfg(test)]
impl RawPacket {
    fn into_packet(self) -> Option<Pkt> {
        let t = self
            .pts_time
            .as_deref()
            .and_then(|s| s.parse::<f64>().ok())
            .or_else(|| self.dts_time.as_deref().and_then(|s| s.parse::<f64>().ok()))?;
        let size = self.size?.parse::<i64>().ok()?;
        if !t.is_finite() || size < 0 {
            return None;
        }
        Some(Pkt {
            t,
            size,
            keyframe: self.flags.is_some_and(|s| s.contains('K')),
        })
    }
}

struct Pkt {
    t: f64,
    size: i64,
    keyframe: bool,
}

// Keyed compact output avoids a JSON string allocation for each packet field.
fn parse_packet(line: &str) -> Option<Pkt> {
    let (mut pts, mut dts, mut size, mut keyframe) = (None, None, None, false);
    for field in line.trim().split('|') {
        let Some((key, value)) = field.split_once('=') else {
            continue;
        };
        match key {
            "pts_time" => pts = value.parse::<f64>().ok(),
            "dts_time" => dts = value.parse::<f64>().ok(),
            "size" => size = value.parse::<i64>().ok(),
            "flags" => keyframe = value.contains('K'),
            _ => {}
        }
    }
    let t = pts.or(dts)?;
    let size = size?;
    (t.is_finite() && size >= 0).then_some(Pkt { t, size, keyframe })
}

/// 指定ストリームのパケット（時刻・サイズ・キーフレーム）を収集する内部ヘルパー。
fn collect_packets(path: &str, stream_index: u32) -> Result<Vec<Pkt>, String> {
    let ffprobe = find_ffprobe().ok_or_else(|| "ffprobe が見つかりません。".to_string())?;

    if !Path::new(path).is_file() {
        return Err(format!("ファイルが存在しません: {path}"));
    }

    let mut child = Command::new(&ffprobe)
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-select_streams",
            &stream_index.to_string(),
            "-show_entries",
            "packet=pts_time,dts_time,size,flags",
            "-of",
            "compact=p=0:nk=0",
        ])
        .arg(path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("ffprobe の実行に失敗しました: {e}"))?;
    // Stream compact records, keeping only numeric packets, not a second string-based packet array.
    let stdout = child
        .stdout
        .take()
        .ok_or("ffprobe の stdout を取得できません。")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("ffprobe の stderr を取得できません。")?;
    let errors = std::thread::spawn(move || {
        let mut message = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut message);
        message
    });
    let parsed = (|| -> Result<Vec<Pkt>, std::io::Error> {
        let mut reader = BufReader::new(stdout);
        let mut packets = Vec::new();
        let mut line = String::new();
        loop {
            line.clear();
            if reader.read_line(&mut line)? == 0 {
                break;
            }
            if let Some(packet) = parse_packet(&line) {
                packets.push(packet);
            }
        }
        Ok(packets)
    })();
    // A parse error closes stdout; terminate instead of waiting on a blocked producer.
    if parsed.is_err() {
        let _ = child.kill();
    }
    let status = child
        .wait()
        .map_err(|e| format!("ffprobe の終了待機に失敗しました: {e}"))?;
    let stderr = errors.join().unwrap_or_default();
    if !status.success() {
        return Err(format!(
            "ffprobe がエラーを返しました (code {}):\n{}",
            status.code().unwrap_or(-1),
            stderr.trim()
        ));
    }
    parsed.map_err(|e| format!("ffprobe の出力を読み取れませんでした: {e}"))
}

/// uPlot 向けに整列したビットレート時系列。
#[derive(Serialize)]
pub(crate) struct BitrateSeries {
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
pub(crate) async fn bitrate_series(
    path: String,
    stream_index: u32,
) -> Result<BitrateSeries, String> {
    tauri::async_runtime::spawn_blocking(move || run_bitrate_series(path, stream_index))
        .await
        .map_err(|e| format!("解析タスクに失敗しました: {e}"))?
}

fn run_bitrate_series(path: String, stream_index: u32) -> Result<BitrateSeries, String> {
    let packets = collect_packets(&path, stream_index)?;
    aggregate_packets(&packets)
}

fn aggregate_packets(packets: &[Pkt]) -> Result<BitrateSeries, String> {
    if packets.is_empty() {
        return Err("パケットが取得できませんでした（このストリームには時系列情報がない可能性があります）。".to_string());
    }

    let t_min = packets.iter().map(|p| p.t).fold(f64::INFINITY, f64::min);
    let t_max = packets
        .iter()
        .map(|p| p.t)
        .fold(f64::NEG_INFINITY, f64::max);
    let range = (t_max - t_min).max(0.001);

    // 1秒あたり1ビンを基本に、最大 4000 ビンへクランプ（ズームにも十分な解像度）。
    let bin_count = (range.ceil() as usize).clamp(20, 4000);
    let bin_dur = range / bin_count as f64;

    let mut sums = vec![0i64; bin_count];
    let mut total: i64 = 0;
    let mut kf_times: Vec<f64> = Vec::new();
    for p in packets {
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
    // Presentation timestamps may arrive out of order with B-frames.
    kf_times.sort_unstable_by(f64::total_cmp);
    let gop_lengths: Vec<f64> = kf_times.windows(2).map(|w| w[1] - w[0]).collect();
    let avg_gop_sec = if !gop_lengths.is_empty() {
        gop_lengths.iter().sum::<f64>() / gop_lengths.len() as f64
    } else {
        0.0
    };
    let gop_min_sec = gop_lengths.iter().cloned().fold(f64::INFINITY, f64::min);
    let gop_max_sec = gop_lengths.iter().cloned().fold(0.0_f64, f64::max);
    let gop_min_sec = if gop_min_sec.is_finite() {
        gop_min_sec
    } else {
        0.0
    };

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn real_b_frame_packets_preserve_all_bitrate_and_gop_statistics() {
        let ffmpeg = crate::tools::find_ffmpeg().expect("ffmpeg required for integration test");
        let path = std::env::temp_dir().join(format!("ffscope-bitrate-{}.mp4", std::process::id()));
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
        let reference = Command::new(find_ffprobe().unwrap())
            .args([
                "-v",
                "error",
                "-select_streams",
                "0",
                "-show_entries",
                "packet=pts_time,dts_time,size,flags",
                "-of",
                "json",
            ])
            .arg(&path)
            .output()
            .unwrap();
        assert!(reference.status.success());
        let expected: PacketOutput = serde_json::from_slice(&reference.stdout).unwrap();
        let expected: Vec<Pkt> = expected
            .packets
            .into_iter()
            .filter_map(RawPacket::into_packet)
            .collect();
        let actual = collect_packets(&path.to_string_lossy(), 0);
        let _ = std::fs::remove_file(path);
        let actual = actual.unwrap();
        assert_eq!(
            serde_json::to_value(aggregate_packets(&actual).unwrap()).unwrap(),
            serde_json::to_value(aggregate_packets(&expected).unwrap()).unwrap()
        );
    }

    #[test]
    fn compact_packets_match_json_with_reordering_missing_fields_and_side_data() {
        for (json, compact) in [
            (
                r#"{"pts_time":"1.2","dts_time":"1.1","size":"100","flags":"K_"}"#,
                "size=100|flags=K_|dts_time=1.1|pts_time=1.2",
            ),
            (
                r#"{"pts_time":"N/A","dts_time":"-0.1","size":"42"}"#,
                "pts_time=N/A|dts_time=-0.1|size=42|side_data_type=Skip Samples",
            ),
            (r#"{"pts_time":"NaN","size":"42"}"#, "pts_time=NaN|size=42"),
            (r#"{"pts_time":"2","size":"-1"}"#, "pts_time=2|size=-1"),
            (r#"{"size":"42"}"#, "size=42"),
        ] {
            let expected = serde_json::from_str::<RawPacket>(json)
                .unwrap()
                .into_packet();
            let actual = parse_packet(compact);
            assert_eq!(
                actual.as_ref().map(|p| (p.t, p.size, p.keyframe)),
                expected.as_ref().map(|p| (p.t, p.size, p.keyframe))
            );
        }
        assert!(parse_packet("side_data_type=Metadata\n").is_none());
    }

    #[test]
    fn parses_packets_with_dts_fallback_and_rejects_invalid_values() {
        let raw: PacketOutput = serde_json::from_str(
            r#"{"packets":[
            {"pts_time":"N/A","dts_time":"1.5","size":"42","flags":"K_"},
            {"pts_time":"NaN","size":"42"},
            {"pts_time":"2","size":"-1"},
            {"size":"42"}
        ]}"#,
        )
        .unwrap();
        let packets: Vec<_> = raw
            .packets
            .into_iter()
            .filter_map(RawPacket::into_packet)
            .collect();
        assert_eq!(packets.len(), 1);
        assert_eq!(packets[0].t, 1.5);
        assert_eq!(packets[0].size, 42);
        assert!(packets[0].keyframe);
    }

    #[test]
    fn aggregation_preserves_bytes_and_orders_gop_timestamps() {
        let packets = [
            Pkt {
                t: 2.0,
                size: 100,
                keyframe: true,
            },
            Pkt {
                t: 0.0,
                size: 200,
                keyframe: true,
            },
            Pkt {
                t: 1.0,
                size: 300,
                keyframe: false,
            },
        ];
        let series = aggregate_packets(&packets).unwrap();
        assert_eq!(series.packet_count, 3);
        assert_eq!(series.keyframes, vec![0.0, 2.0]);
        assert_eq!(series.avg_gop_sec, 2.0);
        assert_eq!(series.gop_hist.iter().sum::<usize>(), 1);
        assert!((series.bps.iter().sum::<f64>() * series.bin_dur - 4800.0).abs() < 1e-9);
        assert_eq!(series.avg, 2400.0);
    }

    #[test]
    fn empty_and_single_packet_streams() {
        assert!(aggregate_packets(&[]).is_err());
        let series = aggregate_packets(&[Pkt {
            t: 0.0,
            size: 10,
            keyframe: true,
        }])
        .unwrap();
        assert!(series.avg.is_finite());
        assert_eq!(series.gop_min_sec, 0.0);
        assert_eq!(series.keyframe_count, 1);
    }
}
