import type { Stream } from "./ffprobe";
import type { T } from "./i18n";

export type HdrKind = "HDR10" | "HLG" | "SDR" | "Unknown";

/** 映像ストリームの HDR 種別を判定する。 */
export function detectHdr(s: Stream): HdrKind {
  const transfer = (s.color_transfer ?? "").toLowerCase();
  const primaries = (s.color_primaries ?? "").toLowerCase();

  if (transfer.includes("smpte2084") || transfer === "pq") {
    return "HDR10"; // PQ (SMPTE ST 2084)
  }
  if (transfer.includes("arib-std-b67") || transfer.includes("hlg")) {
    return "HLG";
  }
  if (
    transfer.includes("bt709") ||
    transfer.includes("bt601") ||
    transfer.includes("smpte170") ||
    primaries.includes("bt709")
  ) {
    return "SDR";
  }
  return s.color_transfer ? "SDR" : "Unknown";
}

/** ビット深度を推定（bits_per_raw_sample 優先、無ければ pix_fmt から）。 */
export function bitDepth(s: Stream): number | null {
  if (s.bits_per_raw_sample) {
    const n = parseInt(s.bits_per_raw_sample, 10);
    if (!isNaN(n)) return n;
  }
  const pf = (s.pix_fmt ?? "").toLowerCase();
  if (/(^|[^0-9])12(le|be|$)/.test(pf) || pf.includes("p12")) return 12;
  if (/(^|[^0-9])10(le|be|$)/.test(pf) || pf.includes("p10")) return 10;
  if (pf) return 8;
  return null;
}

/** カラーパネル用の行データを生成。 */
export function colorRows(s: Stream, t: T): [string, string][] {
  const rows: [string, string][] = [];
  const depth = bitDepth(s);
  if (depth) rows.push([t("ビット深度", "Bit depth"), `${depth}-bit`]);
  if (s.pix_fmt) rows.push([t("ピクセル形式", "Pixel format"), s.pix_fmt]);
  if (s.color_range) rows.push([t("レンジ", "Color range"), s.color_range]);
  if (s.color_space) rows.push([t("色空間", "Color space"), s.color_space]);
  if (s.color_primaries) rows.push([t("原色", "Primaries"), s.color_primaries]);
  if (s.color_transfer) rows.push([t("伝達特性", "Transfer"), s.color_transfer]);
  if (s.field_order) rows.push([t("フィールド順", "Field order"), s.field_order]);
  return rows;
}
