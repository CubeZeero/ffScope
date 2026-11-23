use crate::tools::find_ffmpeg;
use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::{Command, Stdio};
use tauri::ipc::Channel;

#[derive(Serialize)]
pub struct Candidate {
    frame: usize,
    time: f64,
    before: f64,
    after: f64,
    score: f64,
}
#[derive(Serialize)]
pub struct Scan {
    candidates: Vec<Candidate>,
    frames: usize,
    truncated: bool,
}

fn distance(a: &[u8], b: &[u8]) -> f64 {
    let sum: u64 = a.iter().zip(b).map(|(a, b)| a.abs_diff(*b) as u64).sum();
    sum as f64 / a.len() as f64 / 255.0
}
#[cfg(test)]
fn excursion_score(window: &std::collections::VecDeque<(Vec<u8>, f64)>) -> f64 {
    let a = &window[0].0;
    let mut best: f64 = 0.0;
    for end in 2..window.len() {
        let b = &window[end].0;
        let bridge = distance(a, b);
        let excursion = (1..end)
            .map(|i| distance(a, &window[i].0).min(distance(b, &window[i].0)))
            .fold(f64::INFINITY, f64::min);
        if bridge < excursion * 0.55 {
            best = best.max(excursion - bridge);
        }
    }
    best
}

// Pair distances survive sliding the window. Only four new pairs are needed per frame.
fn cached_score(len: usize, distances: &[[f64; 5]; 5]) -> f64 {
    let mut best: f64 = 0.0;
    for end in 2..len {
        let bridge = distances[0][end];
        let excursion = (1..end)
            .map(|i| distances[0][i].min(distances[i][end]))
            .fold(f64::INFINITY, f64::min);
        if bridge < excursion * 0.55 {
            best = best.max(excursion - bridge);
        }
    }
    best
}
fn shift_distances(distances: &mut [[f64; 5]; 5]) {
    for i in 0..4 {
        for j in 0..4 {
            distances[i][j] = distances[i + 1][j + 1];
        }
    }
}

#[tauri::command]
pub async fn visual_anomalies(
    path: String,
    stream_index: u32,
    duration: f64,
    sensitivity: f64,
    on_progress: Channel<f64>,
) -> Result<Scan, String> {
    tauri::async_runtime::spawn_blocking(move || {
        scan(path, stream_index, duration, sensitivity, on_progress)
    })
    .await
    .map_err(|e| e.to_string())?
}

fn scan(
    path: String,
    stream_index: u32,
    duration: f64,
    sensitivity: f64,
    progress: Channel<f64>,
) -> Result<Scan, String> {
    if !Path::new(&path).is_file() {
        return Err("File not found".into());
    }
    let ffmpeg = find_ffmpeg().ok_or("ffmpeg not found")?;
    let threshold = 0.10 - sensitivity.clamp(0.0, 1.0) * 0.085;
    let _ = progress.send(0.0);
    let mut child = Command::new(ffmpeg)
        .args(["-hide_banner", "-nostdin", "-i"])
        .arg(path)
        .args([
            "-map",
            &format!("0:{stream_index}"),
            "-an",
            "-vf",
            "scale=160:90,format=rgb24,showinfo=checksum=0",
            "-fps_mode",
            "passthrough",
            "-f",
            "rawvideo",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let stderr = child.stderr.take().unwrap();
    let (tx, rx) = std::sync::mpsc::channel();
    let reader = std::thread::spawn(move || {
        let mut errors = String::new();
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if line.contains("Parsed_showinfo") && line.contains("pts_time:") {
                if let Some(t) = line
                    .split("pts_time:")
                    .nth(1)
                    .and_then(|s| s.split_whitespace().next())
                    .and_then(|s| s.parse::<f64>().ok())
                {
                    let _ = tx.send(t);
                }
            } else if errors.len() < 8000 {
                errors.push_str(&line);
                errors.push('\n');
            }
        }
        errors
    });
    let mut stdout = BufReader::with_capacity(160 * 90 * 3 * 2, child.stdout.take().unwrap());
    let mut window: std::collections::VecDeque<(Vec<u8>, f64)> = std::collections::VecDeque::new();
    let mut distances = [[0.0; 5]; 5];
    let mut recycled = None;
    let mut last_progress = std::time::Instant::now();
    let mut candidates = Vec::new();
    let mut frames = 0;
    let mut truncated = false;
    let mut read_error = None;
    loop {
        let mut pixels = recycled.take().unwrap_or_else(|| vec![0; 160 * 90 * 3]);
        // Read one byte first to distinguish EOF from a truncated raw frame.
        match stdout.read(&mut pixels[..1]) {
            Ok(0) => break,
            Err(e) => {
                read_error = Some(e.to_string());
                break;
            }
            _ => {}
        }
        if let Err(e) = stdout.read_exact(&mut pixels[1..]) {
            read_error = Some(e.to_string());
            break;
        }
        let time = match rx.recv() {
            Ok(t) => t,
            Err(_) => {
                read_error = Some("Missing frame timestamp".into());
                break;
            }
        };
        let next = window.len();
        for (i, (previous, _)) in window.iter().enumerate() {
            let d = distance(previous, &pixels);
            distances[i][next] = d;
            distances[next][i] = d;
        }
        window.push_back((pixels, time));
        frames += 1;
        // Look for 1–3-frame excursions that return to a similar image.
        if window.len() >= 5 {
            let best = cached_score(window.len(), &distances);
            if best > threshold {
                if candidates.len() < 2000 {
                    candidates.push(Candidate {
                        frame: frames - 3,
                        time: window[1].1,
                        before: window[0].1,
                        after: window[2].1,
                        score: best,
                    });
                } else {
                    truncated = true;
                }
            }
            recycled = window.pop_front().map(|(pixels, _)| pixels);
            shift_distances(&mut distances);
        }
        if last_progress.elapsed().as_millis() >= 100 {
            let _ = progress.send(if duration > 0.0 {
                (time / duration).clamp(0.0, 0.99)
            } else {
                -1.0
            });
            last_progress = std::time::Instant::now();
        }
    }
    if read_error.is_some() {
        let _ = child.kill();
    }
    let status = child.wait().map_err(|e| e.to_string())?;
    let errors = reader.join().unwrap_or_default();
    if let Some(e) = read_error {
        return Err(e);
    }
    if !status.success() {
        return Err(errors);
    }
    // Flush the final look-ahead window; only the very last frame lacks a following reference.
    while window.len() >= 3 {
        let best = cached_score(window.len(), &distances);
        if best > threshold {
            if candidates.len() < 2000 {
                candidates.push(Candidate {
                    frame: frames - window.len() + 2,
                    time: window[1].1,
                    before: window[0].1,
                    after: window[2].1,
                    score: best,
                });
            } else {
                truncated = true;
            }
        }
        window.pop_front();
        shift_distances(&mut distances);
    }
    let _ = progress.send(1.0);
    Ok(Scan {
        candidates,
        frames,
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pixel_distance() {
        assert_eq!(distance(&[0, 0, 0], &[0, 0, 0]), 0.0);
        assert_eq!(distance(&[0, 0, 0], &[255, 255, 255]), 1.0);
    }
    #[test]
    fn cached_scores_match_original_when_window_slides() {
        let mut window: std::collections::VecDeque<(Vec<u8>, f64)> =
            std::collections::VecDeque::new();
        let mut distances = [[0.0; 5]; 5];
        for n in 0..30usize {
            let pixels: Vec<u8> = (0..300).map(|i| ((i * 17 + n * 91) % 256) as u8).collect();
            let next = window.len();
            for (i, (previous, _)) in window.iter().enumerate() {
                let d = distance(previous, &pixels);
                distances[i][next] = d;
                distances[next][i] = d;
            }
            window.push_back((pixels, n as f64));
            if window.len() == 5 {
                assert!((cached_score(5, &distances) - excursion_score(&window)).abs() < 1e-12);
                window.pop_front();
                shift_distances(&mut distances);
            }
        }
        while window.len() >= 3 {
            assert!(
                (cached_score(window.len(), &distances) - excursion_score(&window)).abs() < 1e-12
            );
            window.pop_front();
            shift_distances(&mut distances);
        }
    }
    #[test]
    fn detects_glitch_but_not_a_cut() {
        let ffmpeg = find_ffmpeg().expect("ffmpeg is required for this integration test");
        let fixture =
            std::env::temp_dir().join(format!("ffscope-anomaly-{}.mkv", std::process::id()));
        for (filter, expected) in [
            ("drawbox=color=white:t=fill:enable='eq(n,4)'", true),
            ("drawbox=color=white:t=fill:enable='gte(n,4)'", false),
        ] {
            let status = Command::new(&ffmpeg)
                .args([
                    "-y",
                    "-v",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=black:s=160x90:r=10:d=1",
                    "-vf",
                    filter,
                    "-c:v",
                    "ffv1",
                ])
                .arg(&fixture)
                .status()
                .unwrap();
            assert!(status.success());
            let result = scan(
                fixture.to_string_lossy().into_owned(),
                0,
                1.0,
                0.5,
                Channel::new(|_| Ok(())),
            )
            .unwrap();
            assert_eq!(result.frames, 10);
            assert_eq!(!result.candidates.is_empty(), expected);
            if expected {
                assert_eq!(result.candidates[0].frame, 5);
                assert!((result.candidates[0].time - 0.4).abs() < 0.001);
            }
        }
        let _ = std::fs::remove_file(fixture);
    }
}
