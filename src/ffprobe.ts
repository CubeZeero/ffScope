import { Channel, invoke } from "@tauri-apps/api/core";
import { createSharedTask } from "./shared-task";
import { trackAnalysis } from "./analysis-store";
import type { AnomalyScan } from "./media-types";
import type { ProbeResult, BitrateSeries, CommandOutput, Integrity, BlackSilence, CropResult, TsResult, ToolInfo, FileHash, QualityMetric, FrameStats, Loudness, FrameProgress, DiffMode, DiffTimeline } from "./media-types";
export type * from "./media-types";
export * from "./media-format";

const sharedProbe = createSharedTask<ProbeResult>();
const sharedBitrate = createSharedTask<BitrateSeries>();
const sharedFrames = createSharedTask<FrameStats, FrameProgress>();
const sharedLoudness = createSharedTask<Loudness, number>();
const sharedIntegrity = createSharedTask<Integrity, number>();
const sharedTimestamps = createSharedTask<TsResult, number>();
const sharedBlackSilence = createSharedTask<BlackSilence, number>();
const sharedThumbnail = createSharedTask<string>();
const sharedAnomaly = createSharedTask<AnomalyScan, number>();
let toolRevision = 0;
const taskKey = (...args: unknown[]) => JSON.stringify([toolRevision, ...args]);
function progressChannel<P>(callback: (value: P) => void) {
  const channel = new Channel<P>();
  channel.onmessage = callback;
  return channel;
}

// ---- Rust コマンド呼び出し ----
export function probeFile(path: string): Promise<ProbeResult> {
  return sharedProbe(taskKey(path), () => invoke<ProbeResult>("probe", { path }));
}

export function bitrateSeries(path: string, streamIndex: number): Promise<BitrateSeries> {
  return sharedBitrate(taskKey(path, streamIndex), () => trackAnalysis(path, "bitrate", streamIndex, () => invoke<BitrateSeries>("bitrate_series", { path, streamIndex })));
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


/** 時間分割の並列解析＋進捗通知でフレーム種別を集計。 */
export function frameStatsParallel(
  path: string,
  streamIndex: number,
  duration: number,
  onProgress: (p: FrameProgress) => void
): Promise<FrameStats> {
  return sharedFrames(taskKey(path, streamIndex, duration), emit =>
    trackAnalysis(path, "frames", streamIndex, () => invoke<FrameStats>("frame_stats_parallel", { path, streamIndex, duration, threads: null, onProgress: progressChannel(emit) })), onProgress);
}

export function loudness(
  path: string,
  streamIndex: number,
  duration: number,
  onProgress: (p: number) => void
): Promise<Loudness> {
  return sharedLoudness(taskKey(path, streamIndex, duration), emit =>
    trackAnalysis(path, "loudness", streamIndex, () => invoke<Loudness>("loudness", { path, streamIndex, duration, onProgress: progressChannel(emit) })), onProgress);
}

export function setToolPaths(ffprobe: string, ffmpeg: string): Promise<void> {
  toolRevision++;
  return invoke<void>("set_tool_paths", {
    ffprobe: ffprobe || null,
    ffmpeg: ffmpeg || null,
  });
}

/** 指定時刻のフレームを抽出し JPEG data URL を返す。 */
export function thumbnail(path: string, timeSec: number, width = 480): Promise<string> {
  return sharedThumbnail(taskKey(path, timeSec, width), () => invoke<string>("thumbnail", { path, timeSec, width }));
}

export function visualAnomalies(path: string, streamIndex: number, duration: number, sensitivity: number, onProgress: (value: number) => void): Promise<AnomalyScan> {
  return sharedAnomaly(taskKey(path, streamIndex, duration, sensitivity), emit =>
    trackAnalysis(path, "anomaly", streamIndex, async () => ({
      ...await invoke<Omit<AnomalyScan, "sensitivity">>("visual_anomalies", { path, streamIndex, duration, sensitivity, onProgress: progressChannel(emit) }), sensitivity,
    })), onProgress);
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
  return sharedIntegrity(taskKey(path, duration), emit =>
    trackAnalysis(path, "integrity", null, () => invoke<Integrity>("integrity_check", { path, duration, onProgress: progressChannel(emit) })), onProgress);
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
  return sharedBlackSilence(taskKey(path, duration, hasVideo, hasAudio), emit =>
    trackAnalysis(path, "blackSilence", null, () => invoke<BlackSilence>("detect_black_silence", { path, duration, hasVideo, hasAudio, onProgress: progressChannel(emit) })), onProgress);
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
  return sharedTimestamps(taskKey(path, streamIndex, duration), emit =>
    trackAnalysis(path, "timestamps", streamIndex, () => invoke<TsResult>("timestamp_check", { path, streamIndex, duration, onProgress: progressChannel(emit) })), onProgress);
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
