use tauri::menu::{AboutMetadata, Menu, MenuItemBuilder, SubmenuBuilder};
use tauri::{Emitter, Runtime};
use tauri_plugin_opener::OpenerExt;
const REPO_URL: &str = "https://github.com/CubeZeero/ffScope";

#[tauri::command]
pub(crate) fn open_repo<R: Runtime>(app: tauri::AppHandle<R>) {
    let _ = app.opener().open_url(REPO_URL, None::<&str>);
}

/// アプリのメニューバーを構築する。
/// デフォルトメニューの不要項目を整理し、実用的な項目のみを配置する。
pub(crate) fn build_menu<R: Runtime>(handle: &tauri::AppHandle<R>) -> tauri::Result<Menu<R>> {
    // macOS のネイティブ About パネルは website/authors 欄を表示しないため、
    // 表示される comments(Credits) に開発者とサイト URL を含める。
    let about_meta = AboutMetadata {
        name: Some("ffScope".into()),
        version: Some(env!("CARGO_PKG_VERSION").into()),
        authors: Some(vec!["CubeZeero".into()]),
        comments: Some(format!(
            "ffprobe GUI フロントエンド\n\n開発者: CubeZeero\n{REPO_URL}"
        )),
        copyright: Some("© 2026 CubeZeero".into()),
        website: Some(REPO_URL.into()),
        website_label: Some("GitHub".into()),
        ..Default::default()
    };

    // アプリメニュー（macOS の先頭メニュー）
    let app_menu = SubmenuBuilder::new(handle, "ffScope")
        .about(Some(about_meta))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    // ファイル
    let open_item = MenuItemBuilder::with_id("open", "ファイルを開く…")
        .accelerator("CmdOrCtrl+O")
        .build(handle)?;
    let file_menu = SubmenuBuilder::new(handle, "ファイル")
        .item(&open_item)
        .separator()
        .close_window()
        .build()?;

    // 編集（生JSONやメタデータのコピー・貼付に必要）
    let edit_menu = SubmenuBuilder::new(handle, "編集")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // 表示
    let theme_item = MenuItemBuilder::with_id("toggle-theme", "テーマ切替")
        .accelerator("CmdOrCtrl+T")
        .build(handle)?;
    let view_menu = SubmenuBuilder::new(handle, "表示")
        .item(&theme_item)
        .separator()
        .fullscreen()
        .build()?;

    // ウィンドウ
    let window_menu = SubmenuBuilder::new(handle, "ウィンドウ")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    // ヘルプ
    let repo_item = MenuItemBuilder::with_id("repo", "GitHub リポジトリを開く").build(handle)?;
    let help_menu = SubmenuBuilder::new(handle, "ヘルプ")
        .item(&repo_item)
        .build()?;

    Menu::with_items(
        handle,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

/// メニュー項目のクリックをフロントエンドへ橋渡しする。
pub(crate) fn on_menu_event<R: Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        "open" => {
            let _ = app.emit("menu:open", ());
        }
        "toggle-theme" => {
            let _ = app.emit("menu:toggle-theme", ());
        }
        "repo" => {
            let _ = app.opener().open_url(REPO_URL, None::<&str>);
        }
        _ => {}
    }
}
