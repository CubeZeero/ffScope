import type { FfprobeData } from "./ffprobe";
import { detectWarnings } from "./warnings";
import type { T } from "./i18n";
import { sanitizeAiMetadata } from "./ai-context";
import { aiAnalysisAttachments, type AnalysisRecord } from "./analysis-store";

export type AiProvider = "openai" | "anthropic";
export interface AiPreferences { provider: AiProvider; models: Record<AiProvider, string> }
export interface ChatMessage { role: "user" | "assistant"; content: string }
export const AI_PREFERENCES_KEY = "ffscope-ai-preferences";
export const AI_PREFERENCES_EVENT = "ffscope:ai-preferences";

export function loadAiPreferences(): AiPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(AI_PREFERENCES_KEY) || "{}");
    return {
      provider: saved.provider === "anthropic" ? "anthropic" : "openai",
      models: {
        openai: typeof saved.models?.openai === "string" ? saved.models.openai.slice(0, 200) : "",
        anthropic: typeof saved.models?.anthropic === "string" ? saved.models.anthropic.slice(0, 200) : "",
      },
    };
  } catch { return { provider: "openai", models: { openai: "", anthropic: "" } }; }
}

export function saveAiPreferences(preferences: AiPreferences) {
  // Serialize an allowlist: no credential field can leak to browser storage.
  localStorage.setItem(AI_PREFERENCES_KEY, JSON.stringify({
    provider: preferences.provider,
    models: { openai: preferences.models.openai, anthropic: preferences.models.anthropic },
  }));
  window.dispatchEvent(new Event(AI_PREFERENCES_EVENT));
}

/** Explicit allowlist excludes paths, filenames, tags, titles, images and raw JSON. */
export function buildAiContext(data: FfprobeData | null, t: T, records: readonly AnalysisRecord[] = [], ids: string[] = []): string | null {
  const results = aiAnalysisAttachments(records, ids);
  if (!data && !results.length) return null;
  const sanitized = data ? sanitizeAiMetadata(data) : null;
  return JSON.stringify({
    scope: "Only explicitly selected metadata and completed analysis summaries. Omitted or unmeasured checks are unknown. Anomaly candidates require human review. Raw logs, media and filenames are excluded.",
    ...(sanitized ?? {}),
    warnings: sanitized ? detectWarnings(sanitized, t) : undefined,
    analyses: results.length ? results : undefined,
  }, null, 2);
}
