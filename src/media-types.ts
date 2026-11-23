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


export interface FrameProgress {
  progress: number; // 0..1、負値は不定
  i: number;
  p: number;
  b: number;
}

export type DiffMode = "diff" | "highlight";

export interface DiffTimeline {
  t: number[];
  mag: number[];
  max: number;
}

export interface AnomalyCandidate { frame: number; time: number; before: number; after: number; score: number }
export interface AnomalyScan { candidates: AnomalyCandidate[]; frames: number; truncated: boolean; sensitivity: number }
