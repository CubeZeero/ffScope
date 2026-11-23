import type { AnalysisKind } from "./analysis-store";
export const analysisLabels: Record<AnalysisKind, [string, string]> = {
  integrity: ["デコード整合性", "Decode integrity"], timestamps: ["タイムスタンプ", "Timestamps"], bitrate: ["ビットレート", "Bitrate"], frames: ["フレーム種別", "Frame types"], loudness: ["ラウドネス", "Loudness"], blackSilence: ["黒フレーム・無音", "Black/silence"], anomaly: ["視覚的異常候補", "Visual anomaly candidates"], delivery: ["納品仕様", "Delivery specification"],
};
