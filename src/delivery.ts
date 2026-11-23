import type { FfprobeData } from "./ffprobe";
import type { AnalysisRecord } from "./analysis-store";
export interface DeliverySpec {
  requireVideo: boolean; requireAudio: boolean; width: number | null; height: number | null;
  fps: string; videoCodec: string; audioCodec: string; sampleRate: number | null; channels: number | null;
  lufs: number | null; tolerance: number; truePeak: number | null;
}
export const DEFAULT_SPEC: DeliverySpec = {
  requireVideo: true, requireAudio: true, width: 1920, height: 1080, fps: "30000/1001",
  videoCodec: "h264", audioCodec: "aac", sampleRate: 48000, channels: 2, lufs: -14, tolerance: 1, truePeak: -1,
};
export interface Verdict { code: string; stream: number | null; status: "pass" | "fail" | "unknown" | "skip"; actual: string; expected: string }
export function frameRate(value: string | undefined): number | null {
  if (!value?.trim()) return null;
  const parts = value.split("/").map(Number);
  const result = parts.length === 2 ? parts[0] / parts[1] : parts.length === 1 ? parts[0] : NaN;
  return Number.isFinite(result) && result > 0 ? result : null;
}
export function validateSpec(s: DeliverySpec): string | null {
  if (typeof s.requireVideo !== "boolean" || typeof s.requireAudio !== "boolean") return "media";
  for (const key of ["fps", "videoCodec", "audioCodec"] as const) if (typeof s[key] !== "string" || s[key].length > 80) return key;
  if (s.fps && frameRate(s.fps) === null) return "fps";
  for (const k of ["width", "height", "sampleRate", "channels"] as const) {
    if (s[k] !== null && (!Number.isInteger(s[k]) || s[k]! <= 0)) return k;
  }
  if (!Number.isFinite(s.tolerance) || s.tolerance < 0) return "tolerance";
  for (const k of ["lufs", "truePeak"] as const) if (s[k] !== null && !Number.isFinite(s[k])) return k;
  return null;
}
export function evaluateDelivery(data: FfprobeData, spec: DeliverySpec, analyses: readonly AnalysisRecord[]): Verdict[] {
  const out: Verdict[] = [];
  const videos = (data.streams ?? []).filter(s => s.codec_type === "video");
  const audios = (data.streams ?? []).filter(s => s.codec_type === "audio");
  out.push({ code: "video_present", stream: null, status: videos.length ? "pass" : spec.requireVideo ? "fail" : "skip", actual: String(videos.length), expected: spec.requireVideo ? ">=1" : "optional" });
  out.push({ code: "audio_present", stream: null, status: audios.length ? "pass" : spec.requireAudio ? "fail" : "skip", actual: String(audios.length), expected: spec.requireAudio ? ">=1" : "optional" });
  const numeric = (code: string, stream: number, actual: number | null, expected: number | null, tolerance = 0, maximum = false) => {
    out.push({ code, stream, status: expected === null ? "skip" : actual === null ? "unknown" : (maximum ? actual <= expected : Math.abs(actual - expected) <= tolerance) ? "pass" : "fail", actual: actual === null ? "—" : String(actual), expected: expected === null ? "—" : maximum ? `<= ${expected}` : tolerance ? `${expected} ± ${tolerance}` : String(expected) });
  };
  const codec = (code: string, stream: number, actual: string | undefined, expected: string) => {
    out.push({ code, stream, status: !expected.trim() ? "skip" : !actual ? "unknown" : actual.toLowerCase() === expected.trim().toLowerCase() ? "pass" : "fail", actual: actual ?? "—", expected: expected || "—" });
  };
  const finite = (value: unknown) => value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) ? Number(value) : null;
  for (const s of videos) {
    numeric("width", s.index, finite(s.width), spec.width);
    numeric("height", s.index, finite(s.height), spec.height);
    numeric("fps", s.index, frameRate(s.avg_frame_rate), frameRate(spec.fps), 0.005);
    codec("video_codec", s.index, s.codec_name, spec.videoCodec);
  }
  for (const s of audios) {
    codec("audio_codec", s.index, s.codec_name, spec.audioCodec);
    numeric("sample_rate", s.index, finite(s.sample_rate), spec.sampleRate);
    numeric("channels", s.index, finite(s.channels), spec.channels);
    const measured = analyses.find(r => r.kind === "loudness" && r.streamIndex === s.index && r.status === "complete");
    numeric("lufs", s.index, finite(measured?.summary.input_i), spec.lufs, spec.tolerance);
    numeric("true_peak", s.index, finite(measured?.summary.input_tp), spec.truePeak, 0, true);
    if (measured?.summary.true_peak_negative_infinity && spec.truePeak !== null) {
      const peak = [...out].reverse().find(r => r.code === "true_peak" && r.stream === s.index);
      if (peak) { peak.status = "pass"; peak.actual = "-inf"; }
    }
    if (measured?.summary.silent && spec.lufs !== null) {
      const item = [...out].reverse().find(r => r.code === "lufs" && r.stream === s.index);
      if (item) { item.status = "fail"; item.actual = "-inf (silent)"; }
    }
  }
  return out;
}
