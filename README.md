<p align="center">
  <img src="logo/logo.iconset/icon_512x512@2x.png" alt="ffScope" width="160" />
</p>

<h1 align="center">ffScope</h1>

<p align="center">
  ffprobe / ffmpeg を使ったクロスプラットフォームのメディア解析 GUI<br>
  <em>A cross-platform media analysis GUI powered by ffprobe / ffmpeg</em>
</p>

<p align="center">
  <img alt="version" src="https://img.shields.io/badge/version-1.0.0-5b9dff">
  <img alt="platform" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-888">
  <img alt="built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%202-24C8DB">
  <img alt="license" src="https://img.shields.io/badge/license-MIT-3fb950">
</p>

---

メディアファイルをドラッグ&ドロップ（またはクリックで選択）すると、`ffprobe` を実行してフォーマット・ストリーム・メタデータを見やすく表示します。ビットレートグラフ、ラウドネス、HDR、画質比較（VMAF）、フレーム差分など、専門的な解析も 1 つのアプリで完結します。

- **動画・音声・画像に対応**: 静止画（PNG/JPG 等）はプレビュー付きの専用表示、アニメーション GIF/WebP は動画として解析
- **クロスプラットフォーム**: macOS / Windows / Linux
- **軽量**: Tauri 2（Rust バックエンド + React フロントエンド）。OS 標準の WebView を使うため配布物が小さい
- **日英切替 (i18n)** ・ **ライト / ダークテーマ**

## モード

- **解析** — 1ファイルを詳細解析（タブ: 情報 / プレビュー / ビットレート / ラウドネス / 検査 / 生JSON。静止画では画像プレビュー付きの 情報 / 生JSON に自動整理）
- **比較** — 複数ファイルのメタデータ差分、画質比較(VMAF/PSNR/SSIM)、フレーム差分
- **バッチ** — 複数ファイルの主要スペックを一覧表に（動画・音声・画像の混在OK）
- **コマンド** — ffprobe 引数を自由に編集して実行（プリセット保存つき）

## 機能

### 情報 / メタデータ
- フォーマット / ストリーム / チャプター / メタデータの整形表示（**全 ffprobe フィールド**の展開、Unix 時刻の日時変換）
- **警告検出**: VFR・映像/音声欠落・長さ不一致・アナモルフィック・非標準サンプルレート等
- **HDR / カラー情報**: primaries / transfer / space / bit depth を整形し HDR10・HLG を判定、MaxCLL / MaxFALL / Mastering Display の詳細取得
- **ファイルハッシュ**: MD5 / SHA-256（進捗バー）

### プレビュー
- **フレームピッカー**: シークバーでライブプレビュー、前後フレーム送り、任意フレームを JPG / PNG 保存
- **コンタクトシート**: ランダムな時刻から 12 枚のサムネイルを生成（進捗バー・クリックで保存・再生成）
- **画像プレビュー**: 静止画は情報タブに原寸プレビューを表示（透過は市松模様で確認可）

### ビットレート
- **uPlot グラフ**: ホイールズーム / ドラッグパン、キーフレーム(GOP)重ね表示
- **統計**: 中央値 / p95 / p99 / ピーク平均比
- **GOP 構造**: 平均/最短/最長 GOP とヒストグラム
- **フレーム種別分布**: I/P/B 比率（**時間分割の並列解析＋進捗バー**）
- **タイムスタンプ不連続チェック**: PTS 巻き戻り・ギャップ・DTS>PTS の検出

### ラウドネス（音声）
- **EBU R128 測定**: LUFS / True Peak / LRA と放送(-23)/配信(-14)基準との比較（進捗バー）
- **波形** ・ **スペクトログラム**

### 検査
- **整合性チェック**: 全体をデコードして破損・エラーを検出（進捗バー）
- **検出**: ブラックフレーム / 無音 / シーンチェンジ / クロップ（黒帯）

### 比較（2ファイル / 画像2枚もOK）
- メタデータ・各ストリームの差分ハイライト（**N ファイル**対応）
- **画質比較**: VMAF / PSNR / SSIM（進捗バー）
- **フレーム差分（差分合成）**: 一致部分は黒・差異は色（増幅 ×1〜32）、または**変化箇所だけオレンジ**表示（しきい値調整）
- **差分タイムライン**（動画のみ）: 全体をスキャンし**変化のある時間帯をオレンジ**で表示。感度スライダーで調整、クリックでその時刻へ

### 出力・その他
- **レポート出力**: HTML / **PDF**（全フィールド込み）
- **コピー / エクスポート**: ffprobe コマンド・生 JSON のコピー / 保存
- **最近開いたファイル** ・ **完了トースト通知** ・ **ウィンドウ状態の記憶**
- **設定**: 言語 / テーマ / サムネイル位置 / ffprobe・ffmpeg パス上書き

## 必要なもの

- [Node.js](https://nodejs.org/)（18+）
- [Rust](https://www.rust-lang.org/tools/install)（stable）
- **FFmpeg / ffprobe**（解析に `ffprobe`、サムネイル・波形・フレーム保存・ラウドネスに `ffmpeg`）
  - macOS: `brew install ffmpeg`
  - Windows: [ffmpeg.org](https://ffmpeg.org/download.html) からダウンロードして PATH に追加
  - Linux: `apt install ffmpeg` など

`ffprobe` / `ffmpeg` は以下の順で自動検出されます:

1. 環境変数 `FFPROBE_PATH` / `FFMPEG_PATH`（設定画面からも上書き可）
2. アプリ実行ファイルの隣（sidecar 同梱バイナリ）
3. よくあるインストール場所（`/opt/homebrew/bin`, `/usr/local/bin`, `/usr/bin`, `/snap/bin`, `C:\ffmpeg\bin`）
4. `PATH`

## 開発

```bash
npm install
npm run tauri dev      # 開発用ウィンドウを起動（ホットリロード）
```

## ビルド（配布用バイナリ）

```bash
npm run tauri build            # OS ネイティブのインストーラ／実行ファイルを生成
npm run tauri build -- --bundles app   # macOS で .app のみ素早く生成（動作確認向け）
```

生成物は `src-tauri/target/release/bundle/` に出力されます
（macOS: `.app` / `.dmg`、Windows: `.msi` / `.exe`、Linux: `.deb` / `.AppImage` / `.rpm`）。
クロスコンパイルは基本不可のため、各 OS 向けの成果物はその OS 上でビルドしてください。

## リリース（GitHub Actions 自動ビルド）

`v*` タグを push すると [release.yml](.github/workflows/release.yml) が起動し、
**ffmpeg / ffprobe の静的ビルドを sidecar 同梱**した配布物を自動生成して GitHub Release に添付します。

```bash
git tag v1.0.0
git push origin v1.0.0
```

| OS | 成果物 | 同梱 FFmpeg の取得元 |
|----|--------|---------------------|
| macOS (Apple Silicon) | `ffScope_v*_macos_arm64.dmg` | [ffmpeg.martin-riedl.de](https://ffmpeg.martin-riedl.de/)（fallback: osxexperts.net） |
| Windows (x64) | `ffScope_v*_windows_x64.zip`（ポータブル: exe + ffmpeg/ffprobe） | [BtbN/FFmpeg-Builds](https://github.com/BtbN/FFmpeg-Builds)（GPL・libvmaf 含む） |

- ローカル開発ビルドには FFmpeg は同梱されません（`externalBin` は CI 実行時のみ `--config` で有効化）
- 同梱される FFmpeg は **GPL/LGPL** です（本体アプリは MIT）。ライセンス表記とソース入手先は Release ノートに記載されます
- 手動実行（workflow_dispatch）ではリリースを作らず、Actions のアーティファクトとして成果物を確認できます

## アプリアイコンの差し替え

`logo/SVG/app-icon.svg`（アクセント色背景＋白ロゴ）を編集し、次のコマンドでアイコン一式を再生成します:

```bash
npm run tauri icon logo/SVG/app-icon.svg
```

## プロジェクト構成

```
ffScope/
├── src/                    # React フロントエンド
│   ├── App.tsx             # 画面全体（解析/比較/バッチ/コマンドのモード・タブ）
│   ├── ffprobe.ts          # 型・フォーマッタ・Rust コマンド呼び出し
│   ├── BitrateChart.tsx BitrateStats.tsx GopDetail.tsx FrameStatsPanel.tsx TimestampCheck.tsx
│   ├── LoudnessTab.tsx     # EBU R128 ラウドネス＋波形＋スペクトログラム
│   ├── ColorPanel.tsx      # HDR / カラー情報
│   ├── FramePicker.tsx ContactSheet.tsx ImagePreview.tsx  # プレビュー / 画像表示
│   ├── IntegrityCheck.tsx DetectPanel.tsx   # 検査（破損・ブラック/無音/シーン/クロップ）
│   ├── CompareExtras.tsx   # 画質比較(VMAF/PSNR/SSIM)・フレーム差分・差分タイムライン
│   ├── FileHashPanel.tsx BatchView.tsx CommandRunner.tsx
│   ├── report.ts           # HTML / PDF レポート生成
│   ├── SettingsModal.tsx AboutModal.tsx
│   ├── toast.tsx i18n.tsx warnings.ts color.ts Logo.tsx
│   └── App.css
├── src-tauri/              # Rust バックエンド
│   ├── src/lib.rs          # ffprobe/ffmpeg 実行コマンド群・メニュー・ツール探索
│   ├── binaries/           # ffprobe 同梱(sidecar)用（手順は同 README）
│   └── tauri.conf.json
└── README.md
```

## 技術スタック

| レイヤ | 採用技術 |
|--------|----------|
| バックエンド | Rust + Tauri 2（sha2 / md-5 / base64） |
| フロントエンド | React 19 + TypeScript + Vite |
| グラフ | uPlot |
| PDF | jsPDF + autotable |
| アイコン | Bootstrap Icons |
| 解析エンジン | FFmpeg（`ffprobe` / `ffmpeg`、libvmaf 含む）をサブプロセス実行 |

## ライセンス / 作者

- ライセンス: **MIT**（[LICENSE](LICENSE)）
- 開発者: **CubeZeero** — © 2026 CubeZeero
- リポジトリ: https://github.com/CubeZeero/ffScope
