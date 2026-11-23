use crate::process::{extract_after, ffmpeg_progress};
use crate::tools::find_ffmpeg;
use serde::Serialize;
use std::path::Path;
use std::process::Command;
use tauri::ipc::Channel;

/// 2ファイルの映像品質を比較する (metric: psnr / ssim / vmaf)。
/// distorted を reference の解像度へ合わせて全フレーム比較する。
#[tauri::command]
pub(crate) async fn quality_compare(
    distorted: String,
    reference: String,
    metric: String,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg が見つかりません。".to_string())?;
        for p in [&distorted, &reference] {
            if !Path::new(p).is_file() {
                return Err(format!("ファイルが存在しません: {p}"));
            }
        }
        let filter_name = match metric.as_str() {
            "psnr" => "psnr",
            "ssim" => "ssim",
            "vmaf" => "libvmaf",
            _ => return Err("不明な指標です。".to_string()),
        };
        let lavfi = format!(
            "[0:v][1:v]scale2ref[dist][ref];[dist]setpts=PTS-STARTPTS[d];[ref]setpts=PTS-STARTPTS[r];[d][r]{filter_name}"
        );
        let args: Vec<String> = vec![
            "-i".into(),
            distorted.clone(),
            "-i".into(),
            reference.clone(),
            "-lavfi".into(),
            lavfi,
            "-an".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ];
        let stderr = ffmpeg_progress(&ffmpeg, args, duration, &on_progress)?;

        let key = match metric.as_str() {
            "psnr" => "average:",
            "ssim" => "All:",
            _ => "VMAF score:",
        };
        for line in stderr.lines().rev() {
            if let Some(v) = extract_after(line, key) {
                return Ok(format!("{v:.4}"));
            }
        }
        if metric == "vmaf" {
            return Err(format!(
                "VMAF を計算できませんでした（この ffmpeg は libvmaf 非対応の可能性）。\n{}",
                stderr.lines().rev().take(3).collect::<Vec<_>>().join("\n")
            ));
        }
        Err(format!(
            "スコアを取得できませんでした:\n{}",
            stderr.lines().rev().take(3).collect::<Vec<_>>().join("\n")
        ))
    })
    .await
    .map_err(|e| format!("品質比較の実行に失敗しました: {e}"))?
}

/// 2ファイルの同時刻フレームを差分合成し PNG data URL で返す。
/// mode="diff": 差分そのもの（一致=黒・差異=色、amplify で強調）。
/// mode="highlight": 差異が threshold を超える箇所だけをオレンジで表示。
#[tauri::command]
pub(crate) async fn frame_diff(
    path_a: String,
    path_b: String,
    time_sec: f64,
    mode: String,
    amplify: f64,
    threshold: f64,
    width: u32,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        execute_frame_diff(path_a, path_b, time_sec, mode, amplify, threshold, width)
    })
    .await
    .map_err(|e| format!("差分画像タスクに失敗しました: {e}"))?
}

fn execute_frame_diff(
    path_a: String,
    path_b: String,
    time_sec: f64,
    mode: String,
    amplify: f64,
    threshold: f64,
    width: u32,
) -> Result<String, String> {
    use base64::Engine;

    let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg が見つかりません。".to_string())?;
    for p in [&path_a, &path_b] {
        if !Path::new(p).is_file() {
            return Err(format!("ファイルが存在しません: {p}"));
        }
    }
    let t = if time_sec.is_finite() && time_sec > 0.0 {
        time_sec
    } else {
        0.0
    };

    let effect = if mode == "highlight" {
        let th = threshold.clamp(1.0, 200.0);
        // 差分が th を超える画素だけオレンジ(255,140,0)、他は黒
        format!(
            "format=gray,lut=y='if(gt(val,{th}),255,0)',format=rgb24,lutrgb=r='val':g='val*55/100':b=0"
        )
    } else {
        let amp = amplify.clamp(1.0, 64.0);
        format!(
            "format=rgb24,lutrgb=r='clip(val*{amp},0,255)':g='clip(val*{amp},0,255)':b='clip(val*{amp},0,255)'"
        )
    };
    let filter = format!(
        "[0:v][1:v]scale2ref[a][b];[a][b]blend=all_mode=difference,{effect},scale={width}:-2[out]"
    );

    let output = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-ss"])
        .arg(format!("{t}"))
        .arg("-i")
        .arg(&path_a)
        .args(["-ss"])
        .arg(format!("{t}"))
        .arg("-i")
        .arg(&path_b)
        .args([
            "-frames:v",
            "1",
            "-filter_complex",
            &filter,
            "-map",
            "[out]",
        ])
        .args(["-f", "image2pipe", "-vcodec", "png", "-"])
        .output()
        .map_err(|e| format!("ffmpeg の実行に失敗しました: {e}"))?;

    if !output.status.success() || output.stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("差分の生成に失敗しました:\n{}", stderr.trim()));
    }
    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:image/png;base64,{b64}"))
}

/// 差分の時系列（各時刻の平均差分量）。差異のある時間帯の可視化に使う。
#[derive(Serialize)]
pub(crate) struct DiffTimeline {
    t: Vec<f64>,
    mag: Vec<f64>,
    max: f64,
}

/// 2ファイル全体を比較し、時刻ごとの平均差分量 (signalstats YAVG) を返す（進捗つき）。
#[tauri::command]
pub(crate) async fn diff_timeline(
    path_a: String,
    path_b: String,
    duration: f64,
    on_progress: Channel<f64>,
) -> Result<DiffTimeline, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let ffmpeg = find_ffmpeg().ok_or_else(|| "ffmpeg が見つかりません。".to_string())?;
        for p in [&path_a, &path_b] {
            if !Path::new(p).is_file() {
                return Err(format!("ファイルが存在しません: {p}"));
            }
        }
        let args: Vec<String> = vec![
            "-i".into(),
            path_a.clone(),
            "-i".into(),
            path_b.clone(),
            "-lavfi".into(),
            "[0:v][1:v]scale2ref[a][b];[a][b]blend=all_mode=difference,format=gray,signalstats,metadata=print".into(),
            "-an".into(),
            "-f".into(),
            "null".into(),
            "-".into(),
        ];
        let stderr = ffmpeg_progress(&ffmpeg, args, duration, &on_progress)?;

        let mut t: Vec<f64> = Vec::new();
        let mut mag: Vec<f64> = Vec::new();
        let mut cur_t: Option<f64> = None;
        for line in stderr.lines() {
            if let Some(v) = extract_after(line, "pts_time:") {
                cur_t = Some(v);
            } else if let Some(v) = extract_after(line, "lavfi.signalstats.YAVG=") {
                if let Some(tt) = cur_t.take() {
                    t.push(tt);
                    mag.push(v);
                }
            }
        }
        if t.is_empty() {
            return Err("差分の時系列を取得できませんでした。".to_string());
        }
        // 最大2000点へ間引き
        if t.len() > 2000 {
            let step = (t.len() as f64 / 2000.0).ceil() as usize;
            t = t.iter().step_by(step).cloned().collect();
            mag = mag.iter().step_by(step).cloned().collect();
        }
        let max = mag.iter().cloned().fold(0.0_f64, f64::max);
        Ok(DiffTimeline { t, mag, max })
    })
    .await
    .map_err(|e| format!("差分解析の実行に失敗しました: {e}"))?
}
