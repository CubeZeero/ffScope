// Local, bounded result registry. No logs, media, file names or paths in summaries.
export type AnalysisKind = "integrity" | "timestamps" | "bitrate" | "frames" | "loudness" | "blackSilence" | "anomaly" | "delivery";
export type Metric = string | number | boolean | null;
export interface AnalysisRecord {
  id: string; kind: AnalysisKind; streamIndex: number | null; status: "running" | "complete" | "error";
  updatedAt: string; summary: Record<string, Metric>; points?: Record<string, number>[];
  generation: number;
}
const files = new Map<string, readonly AnalysisRecord[]>();
const listeners = new Set<() => void>();
const EMPTY: readonly AnalysisRecord[] = Object.freeze([]);
let generation = 0;
export const analysisId = (kind: AnalysisKind, stream: number | null = null) => `${kind}:${stream ?? "all"}`;
export function getAnalyses(path: string): readonly AnalysisRecord[] { return files.get(path) ?? EMPTY; }
export function subscribeAnalyses(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function discardAnalysis(path: string, kind: AnalysisKind, stream: number | null = null) {
  const id = analysisId(kind, stream);
  if (!getAnalyses(path).some(r => r.id === id)) return;
  files.set(path, getAnalyses(path).filter(r => r.id !== id));
  listeners.forEach(fn => fn());
}
function publish(path: string, entry: AnalysisRecord) {
  const previous = getAnalyses(path);
  files.delete(path);
  files.set(path, [...previous.filter(r => r.id !== entry.id), entry]);
  while (files.size > 32) files.delete(files.keys().next().value!);
  listeners.forEach(fn => fn());
}
export function beginAnalysis(path: string, kind: AnalysisKind, stream: number | null = null) {
  const entry: AnalysisRecord = { id: analysisId(kind, stream), kind, streamIndex: stream, status: "running", updatedAt: new Date().toISOString(), summary: {}, generation: ++generation };
  publish(path, entry);
  return entry;
}
function n(value: unknown): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (value === "" || value === null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
export function completeAnalysis(path: string, entry: AnalysisRecord, value: unknown) {
  if (getAnalyses(path).find(r => r.id === entry.id)?.generation !== entry.generation) return;
  const raw = (value ?? {}) as Record<string, unknown>;
  const summary: Record<string, Metric> = {};
  let points: Record<string, number>[] | undefined;
  const pick = (keys: string[]) => keys.forEach(key => { summary[key] = n(raw[key]); });
  switch (entry.kind) {
    case "integrity": summary.ok = raw.ok === true; pick(["error_count"]); break;
    case "timestamps": pick(["checked"]); summary.issues = Array.isArray(raw.issues) ? raw.issues.length : 0; summary.display_limit = 200; break;
    case "bitrate": pick(["avg", "peak", "packet_count", "keyframe_count", "avg_gop_sec", "gop_min_sec", "gop_max_sec"]); break;
    case "frames": pick(["i", "p", "b", "total"]); break;
    case "loudness": pick(["input_i", "input_tp", "input_lra", "input_thresh"]); summary.silent = raw.input_i === "-inf"; summary.true_peak_negative_infinity = raw.input_tp === "-inf"; break;
    case "blackSilence": {
      for (const key of ["black", "silence"]) {
        const intervals = Array.isArray(raw[key]) ? raw[key] as { start: number; end: number }[] : [];
        summary[`${key}_count`] = intervals.length;
        summary[`${key}_seconds`] = intervals.reduce((sum, p) => sum + Math.max(0, (n(p.end) ?? 0) - (n(p.start) ?? 0)), 0);
      }
      break;
    }
    case "anomaly": {
      pick(["frames", "sensitivity"]); summary.truncated = raw.truncated === true;
      const candidates = Array.isArray(raw.candidates) ? raw.candidates as Record<string, unknown>[] : [];
      summary.candidates = candidates.length;
      points = candidates.slice(0, 12).map(p => ({ frame: n(p.frame) ?? 0, time: n(p.time) ?? 0, score: n(p.score) ?? 0 }));
      summary.sample_limit = 12; break;
    }
    case "delivery": pick(["pass", "fail", "unknown", "skip"]); break;
  }
  publish(path, { ...entry, summary, points, status: "complete", updatedAt: new Date().toISOString() });
}
export async function trackAnalysis<T>(path: string, kind: AnalysisKind, stream: number | null, action: () => Promise<T>): Promise<T> {
  const entry = beginAnalysis(path, kind, stream);
  try { const result = await action(); completeAnalysis(path, entry, result); return result; }
  catch (error) {
    if (getAnalyses(path).find(r => r.id === entry.id)?.generation === entry.generation) publish(path, { ...entry, status: "error" });
    throw error;
  }
}

/** Re-allowlist at the network boundary even if a caller mutates a record. */
export function aiAnalysisAttachments(records: readonly AnalysisRecord[], ids: string[]) {
  const allowed: Record<AnalysisKind, string[]> = {
    integrity: ["ok", "error_count"], timestamps: ["checked", "issues", "display_limit"],
    bitrate: ["avg", "peak", "packet_count", "keyframe_count", "avg_gop_sec", "gop_min_sec", "gop_max_sec"],
    frames: ["i", "p", "b", "total"], loudness: ["input_i", "input_tp", "input_lra", "input_thresh", "silent", "true_peak_negative_infinity"],
    blackSilence: ["black_count", "black_seconds", "silence_count", "silence_seconds"], anomaly: ["frames", "sensitivity", "truncated", "candidates", "sample_limit"],
    delivery: ["pass", "fail", "unknown", "skip"],
  };
  return records.filter(r => r.status === "complete" && ids.includes(r.id)).slice(0, 24).map(r => ({
    kind: r.kind, streamIndex: r.streamIndex, measuredAt: r.updatedAt,
    summary: Object.fromEntries(Object.entries(r.summary).filter(([key, v]) => allowed[r.kind].includes(key) && (typeof v === "number" && Number.isFinite(v) || typeof v === "boolean" || v === null))),
    points: r.kind === "anomaly" ? r.points?.slice(0, 12).map(p => ({ frame: n(p.frame), time: n(p.time), score: n(p.score) })) : undefined,
  }));
}

export function analysisNeedsReview(record: AnalysisRecord): boolean {
  if (record.status === "error") return true;
  if (record.status !== "complete") return false;
  const summary = record.summary;
  switch (record.kind) {
    case "integrity": return summary.ok === false;
    case "timestamps": return Number(summary.issues) > 0;
    case "anomaly": return Number(summary.candidates) > 0 || summary.truncated === true;
    case "blackSilence": return Number(summary.black_count) > 0 || Number(summary.silence_count) > 0;
    case "delivery": return Number(summary.fail) > 0 || Number(summary.unknown) > 0;
    default: return false;
  }
}
