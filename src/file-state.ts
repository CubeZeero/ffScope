import type { ProbeResult } from "./ffprobe";

export type Mode = "single" | "compare" | "batch" | "tools" | "ai";
export type Tab = "info" | "preview" | "bitrate" | "loudness" | "inspect" | "raw" | "delivery" | "overall";

export interface FileState {
  path: string;
  result: ProbeResult | null;
  error: string | null;
  loading: boolean;
}
export const EMPTY_FILE: FileState = { path: "", result: null, error: null, loading: false };
