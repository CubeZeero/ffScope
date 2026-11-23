import type { FfprobeData } from "./ffprobe";

function technicalFields(source: object, keys: string[]): Record<string, string | number> {
  const result: Record<string, string | number> = {};
  for (const key of keys) {
    const value = (source as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    if (typeof value === "string") result[key] = value.slice(0, 120);
  }
  return result;
}

/** Never spread arbitrary ffprobe output into an external API request. */
export function sanitizeAiMetadata(data: FfprobeData): FfprobeData {
  return {
    format: technicalFields(data.format ?? {}, ["format_name", "duration", "size", "bit_rate", "nb_streams"]),
    streams: (data.streams ?? []).slice(0, 64).map(s => ({
      ...technicalFields(s, ["codec_type", "codec_name", "profile", "width", "height", "pix_fmt",
        "r_frame_rate", "avg_frame_rate", "sample_rate", "channels", "channel_layout", "bit_rate", "duration",
        "color_range", "color_space", "color_transfer", "color_primaries", "bits_per_raw_sample", "field_order"]),
      index: Number.isFinite(s.index) ? s.index : 0,
    })),
  };
}
