# ffprobe 同梱（sidecar）

このディレクトリに **静的ビルドの ffprobe** を置くと、ffScope に同梱して
「FFmpeg 未インストールの環境でもそのまま動く」単体アプリとして配布できます。

ffScope の検出ロジック（`src/lib.rs` の `find_ffprobe`）は、アプリ実行ファイルの
隣に置かれた `ffprobe`（Windows は `ffprobe.exe`）を **最優先で** 使うため、
sidecar として同梱されたバイナリが自動的に使われます。

## 1. 静的ビルドの ffprobe を入手

Homebrew や apt の ffprobe は共有ライブラリ（dylib/so）に依存しており、
**他マシンへ配布すると動きません**。配布用には静的リンク版を使ってください。

- macOS: https://evermeet.cx/ffmpeg/ （`ffprobe` の static build）
- Windows: https://www.gyan.dev/ffmpeg/builds/ または https://github.com/BtbN/FFmpeg-Builds
- Linux: https://johnvansickle.com/ffmpeg/ （static build）

## 2. ターゲットトリプル付きの名前で配置

Tauri の sidecar はターゲットトリプルを付けたファイル名を要求します。
自分のトリプルは `rustc -Vv | grep host` で確認できます。例：

```
binaries/ffprobe-aarch64-apple-darwin      # macOS Apple Silicon
binaries/ffprobe-x86_64-apple-darwin       # macOS Intel
binaries/ffprobe-x86_64-pc-windows-msvc.exe
binaries/ffprobe-x86_64-unknown-linux-gnu
```

実行権限も付けておきます（macOS/Linux）：

```bash
chmod +x binaries/ffprobe-*
```

## 3. tauri.conf.json で有効化

`bundle` に次の1行を追加します（バイナリを置いてから追加すること。
ファイルが無いまま設定するとビルドが失敗します）：

```jsonc
"bundle": {
  "externalBin": ["binaries/ffprobe"],
  ...
}
```

これで `npm run tauri build` 時にアプリへ同梱され、実行ファイルの隣に
`ffprobe` として展開されます。
