import type { T } from "./i18n";
import type { Stream, FfprobeData } from "./media-types";

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
