import type { Lang } from "./i18n";

export interface Settings {
  lang: Lang;
  thumbPercent: number;
  ffprobePath: string;
  ffmpegPath: string;
}

export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* Session settings remain usable if storage is unavailable. */ }
}
function readJson(key: string): unknown {
  try { return JSON.parse(readPreference(key) || "null"); } catch { return null; }
}
export function loadSettings(): Settings {
  const raw = readJson("ffscope-settings");
  const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  return {
    lang: value.lang === "en" ? "en" : "ja",
    thumbPercent: typeof value.thumbPercent === "number" && Number.isFinite(value.thumbPercent)
      ? Math.max(0, Math.min(100, value.thumbPercent)) : 10,
    ffprobePath: typeof value.ffprobePath === "string" ? value.ffprobePath : "",
    ffmpegPath: typeof value.ffmpegPath === "string" ? value.ffmpegPath : "",
  };
}
export function loadRecent(): string[] {
  const value = readJson("ffscope-recent");
  return Array.isArray(value) ? [...new Set(value.filter((path): path is string => typeof path === "string" && !!path))].slice(0, 10) : [];
}
