import { Channel, invoke } from "@tauri-apps/api/core";
import type { T } from "./i18n";

// ---- ffprobe の出力に対応する型（必要な範囲のみ） ----
export interface Stream {
  index: number;
  codec_name?: string;
  codec_long_name?: string;
  codec_type?: "video" | "audio" | "subtitle" | "data" | "attachment";
  profile?: string;
  width?: number;
  height?: number;
  display_aspect_ratio?: string;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  bit_rate?: string;
  duration?: string;
  // カラー / HDR 関連
  color_range?: string;
  color_space?: string;
  color_transfer?: string;
  color_primaries?: string;
  bits_per_raw_sample?: string;
  field_order?: string;
  tags?: Record<string, string>;
}

export interface Format {
  filename?: string;
  nb_streams?: number;
  format_name?: string;
  format_long_name?: string;
  duration?: string;
  size?: string;
  bit_rate?: string;
  tags?: Record<string, string>;
}

export interface Chapter {
  id?: number;
  start_time?: string;
  end_time?: string;
  tags?: Record<string, string>;
}

export interface FfprobeData {
  streams?: Stream[];
  format?: Format;
  chapters?: Chapter[];
  programs?: unknown[];
}

export interface ProbeResult {
  data: FfprobeData;
  ffprobe_path: string;
}

export interface BitrateSeries {
  t: number[];
  bps: number[];
  avg: number;
  peak: number;
  bin_dur: number;
  packet_count: number;
  keyframes: number[];
  keyframe_count: number;
  avg_gop_sec: number;
  gop_min_sec: number;
  gop_max_sec: number;
  gop_hist: number[];
  gop_hist_bin_sec: number;
}

export interface CommandOutput {
  stdout: string;
  stderr: string;
  code: number;
}

export interface Integrity {
  error_count: number;
  ok: boolean;
  errors: string[];
}

export interface Interval {
  start: number;
  end: number;
}
export interface BlackSilence {
  black: Interval[];
  silence: Interval[];
}
export interface CropResult {
  crop: string;
  w: number;
  h: number;
  x: number;
  y: number;
}
export interface TsIssue {
  time: number;
  kind: string;
  detail: string;
}
export interface TsResult {
  issues: TsIssue[];
  checked: number;
}
export interface ToolInfo {
  ffmpeg_version: string;
  ffprobe_version: string;
  ffmpeg_path: string;
  ffprobe_path: string;
}
export interface FileHash {
  md5: string;
  sha256: string;
  size: number;
}
export type QualityMetric = "psnr" | "ssim" | "vmaf";

export interface FrameStats {
  i: number;
  p: number;
  b: number;
  total: number;
}

export interface Loudness {
  input_i: string;
  input_tp: string;
  input_lra: string;
  input_thresh: string;
}

// ---- Rust コマンド呼び出し ----
export function probeFile(path: string): Promise<ProbeResult> {
  return invoke<ProbeResult>("probe", { path });
}

export function bitrateSeries(path: string, streamIndex: number): Promise<BitrateSeries> {
  return invoke<BitrateSeries>("bitrate_series", { path, streamIndex });
}

export function checkFfprobe(): Promise<string | null> {
  return invoke<string | null>("check_ffprobe");
}

export function checkFfmpeg(): Promise<string | null> {
  return invoke<string | null>("check_ffmpeg");
}

export function frameStats(path: string, streamIndex: number): Promise<FrameStats> {
  return invoke<FrameStats>("frame_stats", { path, streamIndex });
}

export interface FrameProgress {
  progress: number; // 0..1、負値は不定
  i: number;
  p: number;
  b: number;
}

/** 時間分割の並列解析＋進捗通知でフレーム種別を集計。 */
export function frameStatsParallel(
  path: string,
  streamIndex: number,
  duration: number,
  onProgress: (p: FrameProgress) => void
): Promise<FrameStats> {
  const ch = new Channel<FrameProgress>();
  ch.onmessage = onProgress;
  return invoke<FrameStats>("frame_stats_parallel", {
    path,
    streamIndex,
    duration,
    threads: null,
    onProgress: ch,
  });
}

export function loudness(
  path: string,
  streamIndex: number,
  duration: number,
  onProgress: (p: number) => void
): Promise<Loudness> {
  const ch = new Channel<number>();
  ch.onmessage = onProgress;
  return invoke<Loudness>("loudness", { path, streamIndex, duration, onProgress: ch });
}

export function setToolPaths(ffprobe: string, ffmpeg: string): Promise<void> {
  return invoke<void>("set_tool_paths", {
    ffprobe: ffprobe || null,
    ffmpeg: ffmpeg || null,
  });
}

/** 指定時刻のフレームを抽出し JPEG data URL を返す。 */
export function thumbnail(path: string, timeSec: number, width = 480): Promise<string> {
  return invoke<string>("thumbnail", { path, timeSec, width });
}

/** 指定時刻のフレームを拡張子に応じた形式(.jpg/.png)でファイル保存。 */
export function saveFrame(path: string, timeSec: number, outPath: string): Promise<void> {
  return invoke<void>("save_frame", { path, timeSec, outPath });
}

/** 音声波形画像 (showwavespic) を PNG data URL で返す。 */
export function waveform(
  path: string,
  streamIndex: number,
  width = 900,
  height = 160
): Promise<string> {
  return invoke<string>("waveform", { path, streamIndex, width, height });
}

/** HDR 詳細メタデータ (MaxCLL/MaxFALL/Mastering Display) を取得。 */
export function hdrMetadata(path: string, streamIndex: number): Promise<[string, string][]> {
  return invoke<[string, string][]>("hdr_metadata", { path, streamIndex });
}

/** 音声スペクトログラム (showspectrumpic) を PNG data URL で返す。 */
export function spectrogram(
  path: string,
  streamIndex: number,
  width = 900,
  height = 300
): Promise<string> {
  return invoke<string>("spectrogram", { path, streamIndex, width, height });
}

/** ffmpeg でデコードして破損・エラーを検出（進捗つき）。 */
export function integrityCheck(
  path: string,
  duration: number,
  onProgress: (p: number) => void
): Promise<Integrity> {
  const ch = new Channel<number>();
  ch.onmessage = onProgress;
  return invoke<Integrity>("integrity_check", { path, duration, onProgress: ch });
}

/** 任意の ffprobe 引数を実行して結果を返す。 */
export function runFfprobe(args: string[]): Promise<CommandOutput> {
  return invoke<CommandOutput>("run_ffprobe", { args });
}

/** ブラックフレーム / 無音区間を検出（進捗つき）。 */
export function detectBlackSilence(
  path: string,
  duration: number,
  hasVideo: boolean,
  hasAudio: boolean,
  onProgress: (p: number) => void
): Promise<BlackSilence> {
  const ch = new Channel<number>();
  ch.onmessage = onProgress;
  return invoke<BlackSilence>("detect_black_silence", {
    path,
    duration,
    hasVideo,
    hasAudio,
    onProgress: ch,
  });
}

/** シーンチェンジの時刻一覧を検出（進捗つき）。 */
export function detectScene(
  path: string,
  duration: number,
  threshold: number,
  onProgress: (p: number) => void
): Promise<number[]> {
  const ch = new Channel<number>();
  ch.onmessage = onProgress;
  return invoke<number[]>("detect_scene", { path, duration, threshold, onProgress: ch });
}

/** 黒帯を検出して推奨クロップを返す。 */
export function detectCrop(path: string): Promise<CropResult> {
  return invoke<CropResult>("detect_crop", { path });
}

/** バイナリ（PDF 等）をファイル保存。 */
export function saveBinary(path: string, data: Uint8Array): Promise<void> {
  return invoke<void>("save_binary", { path: path, data: Array.from(data) });
}

/** PTS/DTS のタイムスタンプ不連続を検出（進捗つき）。 */
export function timestampCheck(
  path: string,
  streamIndex: number,
  duration: number,
  onProgress: (p: number) => void
): Promise<TsResult> {
  const ch = new Channel<number>();
  ch.onmessage = onProgress;
  return invoke<TsResult>("timestamp_check", { path, streamIndex, duration, onProgress: ch });
}

/** ffmpeg / ffprobe のバージョン・パスを取得。 */
export function toolInfo(): Promise<ToolInfo> {
  return invoke<ToolInfo>("tool_info");
}

/** ファイルの MD5 / SHA-256 を計算（進捗つき）。 */
export function fileHash(path: string, onProgress: (p: number) => void): Promise<FileHash> {
  const ch = new Channel<number>();
  ch.onmessage = onProgress;
  return invoke<FileHash>("file_hash", { path, onProgress: ch });
}

/** 2ファイルの映像品質比較（psnr/ssim/vmaf、進捗つき）。 */
export function qualityCompare(
  distorted: string,
  reference: string,
  metric: QualityMetric,
  duration: number,
  onProgress: (p: number) => void
): Promise<string> {
  const ch = new Channel<number>();
  ch.onmessage = onProgress;
  return invoke<string>("quality_compare", { distorted, reference, metric, duration, onProgress: ch });
}

export type DiffMode = "diff" | "highlight";

/** 2ファイルの同時刻フレームの差分合成画像を PNG data URL で返す。
 *  mode="diff": 差分そのもの(amplify強調)、"highlight": 差異部分だけオレンジ(threshold)。 */
export function frameDiff(
  pathA: string,
  pathB: string,
  timeSec: number,
  mode: DiffMode,
  amplify: number,
  threshold: number,
  width = 640
): Promise<string> {
  return invoke<string>("frame_diff", { pathA, pathB, timeSec, mode, amplify, threshold, width });
}

export interface DiffTimeline {
  t: number[];
  mag: number[];
  max: number;
}

/** 2ファイル全体の差分量の時系列を返す（進捗つき）。 */
export function diffTimeline(
  pathA: string,
  pathB: string,
  duration: number,
  onProgress: (p: number) => void
): Promise<DiffTimeline> {
  const ch = new Channel<number>();
  ch.onmessage = onProgress;
  return invoke<DiffTimeline>("diff_timeline", { pathA, pathB, duration, onProgress: ch });
}

/** probe コマンドが実際に実行する ffprobe コマンドライン（表示・コピー用）。 */
export function buildProbeCommand(path: string): string {
  const q = path.includes(" ") ? `"${path}"` : path;
  return `ffprobe -hide_banner -loglevel error -print_format json -show_format -show_streams -show_chapters -show_programs ${q}`;
}

// ---- フォーマッタ ----
export function humanBytes(bytes?: string | number): string {
  const n = typeof bytes === "string" ? parseInt(bytes, 10) : bytes;
  if (n === undefined || isNaN(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function humanDuration(sec?: string | number): string {
  const n = typeof sec === "string" ? parseFloat(sec) : sec;
  if (n === undefined || isNaN(n)) return "—";
  const total = Math.floor(n);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ms = Math.round((n - total) * 1000);
  const hh = h > 0 ? `${h}:` : "";
  const mm = String(m).padStart(h > 0 ? 2 : 1, "0");
  const ss = String(s).padStart(2, "0");
  return `${hh}${mm}:${ss}.${String(ms).padStart(3, "0")}`;
}

export function humanBitrate(bps?: string | number): string {
  const n = typeof bps === "string" ? parseInt(bps, 10) : bps;
  if (n === undefined || isNaN(n)) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} Mb/s`;
  return `${(n / 1000).toFixed(0)} kb/s`;
}

export function fps(rate?: string): string {
  if (!rate) return "—";
  const [num, den] = rate.split("/").map(Number);
  if (!den || isNaN(num) || isNaN(den)) return rate;
  const v = num / den;
  if (!isFinite(v) || v === 0) return "—";
  return `${v.toFixed(2)} fps`;
}

export function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** 静止画ファイルか判定（映像あり・音声なし・尺なし）。GIF/WebP アニメは尺があるため false。 */
export function isStillImage(d: FfprobeData): boolean {
  const streams = d.streams ?? [];
  const hasVideo = streams.some((s) => s.codec_type === "video");
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  const dur = d.format?.duration ? parseFloat(d.format.duration) : NaN;
  return hasVideo && !hasAudio && (isNaN(dur) || dur <= 0);
}

/** 値が Unix タイムスタンプ（秒10桁 or ミリ秒13桁）に見えるか。 */
export function isUnixTimestamp(value: string): boolean {
  if (!/^\d{10}$|^\d{13}$/.test(value)) return false;
  const n = parseInt(value, 10);
  const sec = value.length === 13 ? n / 1000 : n;
  // 2000-01-01 〜 2100-01-01 の範囲なら妥当とみなす
  return sec > 946684800 && sec < 4102444800;
}

/** Unix タイムスタンプ文字列を "YYYY-MM-DD HH:mm:ss" に整形（ローカル時刻）。 */
export function formatUnixTimestamp(value: string): string {
  const n = parseInt(value, 10);
  const ms = value.length === 13 ? n : n * 1000;
  const d = new Date(ms);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(
    d.getHours()
  )}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** ストリーム種別 → bootstrap-icons のクラス名 */
export const TYPE_ICON: Record<string, string> = {
  video: "bi-film",
  audio: "bi-music-note-beamed",
  subtitle: "bi-badge-cc",
  data: "bi-box",
  attachment: "bi-paperclip",
};

/** 種別から bootstrap-icons クラスを得る（未知は疑問符）。 */
export function typeIconClass(type?: string): string {
  return TYPE_ICON[type ?? ""] ?? "bi-question-circle";
}

/** 1ストリームを「ラベル: 値」の行配列に変換（情報表示・比較で共用）。 */
export function streamRows(s: Stream, t: T): [string, string][] {
  const rows: [string, string][] = [];
  rows.push([t("コーデック", "Codec"), s.codec_long_name ?? s.codec_name ?? "—"]);
  if (s.profile) rows.push([t("プロファイル", "Profile"), s.profile]);
  if (s.codec_type === "video") {
    if (s.width && s.height) rows.push([t("解像度", "Resolution"), `${s.width} × ${s.height}`]);
    if (s.display_aspect_ratio) rows.push([t("アスペクト比", "Aspect ratio"), s.display_aspect_ratio]);
    if (s.pix_fmt) rows.push([t("ピクセル形式", "Pixel format"), s.pix_fmt]);
    rows.push([t("フレームレート", "Frame rate"), fps(s.avg_frame_rate || s.r_frame_rate)]);
  } else if (s.codec_type === "audio") {
    if (s.sample_rate) rows.push([t("サンプルレート", "Sample rate"), `${s.sample_rate} Hz`]);
    if (s.channels)
      rows.push([
        t("チャンネル", "Channels"),
        `${s.channels}ch${s.channel_layout ? ` (${s.channel_layout})` : ""}`,
      ]);
  }
  if (s.bit_rate) rows.push([t("ビットレート", "Bitrate"), humanBitrate(s.bit_rate)]);
  if (s.duration) rows.push([t("再生時間", "Duration"), humanDuration(s.duration)]);
  if (s.tags?.language) rows.push([t("言語", "Language"), s.tags.language]);
  if (s.tags?.title) rows.push([t("タイトル", "Title"), s.tags.title]);
  return rows;
}
