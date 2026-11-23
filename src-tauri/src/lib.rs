// Application startup and IPC registration. Implementations live in feature modules.
mod ai;
mod audio;
mod bitrate;
mod comparison;
mod files;
mod frames;
mod images;
mod inspection;
mod menu;
mod probe;
mod process;
mod timestamps;
mod tools;
mod visual_anomaly;

use ai::{ai_cancel, ai_chat, ai_delete_key, ai_key_status, ai_save_key};
use audio::{loudness, spectrogram, waveform};
use bitrate::bitrate_series;
use comparison::{diff_timeline, frame_diff, quality_compare};
use files::{file_hash, save_binary, save_text};
use frames::{frame_stats, frame_stats_parallel};
use images::{save_frame, thumbnail};
use inspection::{detect_black_silence, detect_crop, detect_scene, integrity_check};
use menu::open_repo;
use menu::{build_menu, on_menu_event};
use probe::{check_ffprobe, hdr_metadata, probe, run_ffprobe};
use timestamps::timestamp_check;
use tools::{check_ffmpeg, set_tool_paths, tool_info};
use visual_anomaly::visual_anomalies;

#[tauri::command]
fn update_platform() -> &'static str {
    if cfg!(target_os = "windows") {
        let portable = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|dir| dir.join("ffscope-portable.marker")))
            .is_some_and(|p| p.is_file());
        if portable {
            "windows-portable"
        } else {
            "windows"
        }
    } else if cfg!(target_os = "macos") {
        "macos"
    } else {
        "unsupported"
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .manage(ai::AiState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // ウィンドウの位置・サイズを記憶（デスクトップのみ）
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());
        builder = builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init());
    }

    builder
        .menu(build_menu)
        .on_menu_event(on_menu_event)
        .invoke_handler(tauri::generate_handler![
            ai_key_status,
            ai_save_key,
            ai_delete_key,
            ai_chat,
            ai_cancel,
            check_ffprobe,
            update_platform,
            check_ffmpeg,
            probe,
            bitrate_series,
            frame_stats,
            frame_stats_parallel,
            loudness,
            save_text,
            thumbnail,
            save_frame,
            waveform,
            spectrogram,
            integrity_check,
            visual_anomalies,
            detect_black_silence,
            detect_scene,
            detect_crop,
            timestamp_check,
            tool_info,
            hdr_metadata,
            run_ffprobe,
            open_repo,
            save_binary,
            file_hash,
            quality_compare,
            frame_diff,
            diff_timeline,
            set_tool_paths
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
