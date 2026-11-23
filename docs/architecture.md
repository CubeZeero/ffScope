# コード構成と検証

## フロントエンド

- `App.tsx`: アプリの表示モード、テーマ、設定、ネイティブイベントの接続。
- `SingleView.tsx` / `CompareView.tsx` / `BatchView.tsx`: 各モードの表示。解析パネルは表示を切り替えてもマウントを維持する。
- `InfoTab.tsx` / `MediaTabs.tsx` / `CommandBar.tsx`: メタデータ、プレビューと検査、コピーとエクスポート。
- `file-jobs.ts`: Reactに依存しないファイル解析キュー。キューごとに最大2件を実行。同一パスの追加を重複排除し、削除・置換されたジョブの結果を無視する。実行済みの外部プロセス自体をキャンセルする機能ではない。
- `useFileJobs.ts`: キューのスナップショットとReactを接続する。バッチの成功通知に履歴登録を渡さないことで、最近開いたファイルへの追加を防ぐ。
- `RetainedTab.tsx`: 未訪問の画面は初期化せず、訪問後は非表示でも処理と状態を維持する。
- `shared-task.ts`: 同一条件で実行中の処理を共有し、各呼び出し元へ進捗を通知する。完了済み結果の自動キャッシュとは分ける。
- `media-types.ts`: IPCで受け渡す解析結果の型。
- `media-format.ts`: 単位、時刻、ストリーム情報の純粋な表示処理。
- `ffprobe.ts`: Rustコマンド呼び出し。既存のimportを維持するため、型とフォーマッタも再公開する。
- `analysis-store.ts`: 総合チェックとAI連携用の制限付き解析結果レジストリ。
- `preferences.ts`: 設定・最近開いたファイルの検証と永続化。APIキーはここに保存しない。
- `ProgressBar.tsx`: 既知・不定進捗の共通表示。

## Rust

`lib.rs`はアプリ起動、プラグイン、IPC登録を担当する。コマンド名と引数の形式は既存のフロントエンドと互換を保つ。

| モジュール | 責務 |
| --- | --- |
| `tools` | ffmpeg / ffprobeの探索、指定パス、ビルド情報 |
| `probe` | 基本解析、HDRメタデータ、カスタムffprobe実行 |
| `process` | ffmpegの実行、進捗、共通ログ解析 |
| `frames` / `bitrate` / `timestamps` | フレーム種別、ビットレート、タイムスタンプ検査 |
| `audio` / `images` | ラウドネス、波形、スペクトログラム、フレーム抽出・保存 |
| `inspection` / `visual_anomaly` | 整合性、ブラック・無音・シーン・クロップ、異常フレーム |
| `comparison` | 品質比較、差分画像、差分タイムライン |
| `files` | テキスト・バイナリ保存、ファイルハッシュ |
| `menu` | ネイティブメニューとAbout |
| `ai` | クラウドAI、資格情報ストア、ストリーム受信 |

## 検証

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Rustの結合テストはffmpeg / ffprobeを使用する。フロントエンドのテストは既存のTypeScriptコンパイラで読み込み、外部APIへ送信せずに状態遷移・表示・送信情報の制限を検証する。

性能測定と高速化の詳細は[performance.md](performance.md)を参照。
