import type { FfprobeData, Stream } from "./ffprobe";
import type { T } from "./i18n";

export type WarnLevel = "warning" | "info";

export interface Warning {
  level: WarnLevel;
  title: string;
  detail: string;
}

function parseRate(rate?: string): number | null {
  if (!rate) return null;
  const [num, den] = rate.split("/").map(Number);
  if (!den || isNaN(num) || isNaN(den) || den === 0) return null;
  return num / den;
}

const STANDARD_SAMPLE_RATES = [
  8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000, 192000,
];

/** ffprobe の結果から、注意すべき点を抽出する。 */
export function detectWarnings(data: FfprobeData, t: T): Warning[] {
  const warnings: Warning[] = [];
  const streams = data.streams ?? [];
  const video = streams.filter((s) => s.codec_type === "video");
  const audio = streams.filter((s) => s.codec_type === "audio");

  // --- VFR（可変フレームレート）の可能性 ---
  for (const v of video) {
    const r = parseRate(v.r_frame_rate);
    const avg = parseRate(v.avg_frame_rate);
    if (r && avg && r > 0) {
      const diff = Math.abs(r - avg) / r;
      if (diff > 0.01) {
        warnings.push({
          level: "warning",
          title: t("可変フレームレート (VFR) の可能性", "Possible variable frame rate (VFR)"),
          detail: t(
            `ストリーム #${v.index}: r_frame_rate=${r.toFixed(3)} と avg_frame_rate=${avg.toFixed(
              3
            )} が一致しません。編集や再エンコードで音ズレの原因になることがあります。`,
            `Stream #${v.index}: r_frame_rate=${r.toFixed(3)} and avg_frame_rate=${avg.toFixed(
              3
            )} differ. This can cause A/V sync issues when editing or re-encoding.`
          ),
        });
      }
    }
  }

  // --- 映像 / 音声の有無 ---
  if (video.length === 0) {
    warnings.push({
      level: "info",
      title: t("映像ストリームなし", "No video stream"),
      detail: t(
        "このファイルには映像ストリームが含まれていません（音声/字幕のみ）。",
        "This file has no video stream (audio/subtitle only)."
      ),
    });
  }
  if (audio.length === 0 && video.length > 0) {
    warnings.push({
      level: "info",
      title: t("音声ストリームなし", "No audio stream"),
      detail: t(
        "このファイルには音声ストリームが含まれていません（無音）。",
        "This file has no audio stream (silent)."
      ),
    });
  }

  // --- 再生時間の異常 ---
  const fmtDur = data.format?.duration ? parseFloat(data.format.duration) : NaN;
  if (data.format && (isNaN(fmtDur) || fmtDur <= 0)) {
    warnings.push({
      level: "warning",
      title: t("再生時間が不明 / ゼロ", "Unknown / zero duration"),
      detail: t(
        "コンテナの再生時間が取得できませんでした。ストリーミング断片や破損ファイルの可能性があります。",
        "Container duration could not be determined. Possibly a streaming fragment or corrupted file."
      ),
    });
  }

  // --- コンテナとストリームの duration 乖離 ---
  if (!isNaN(fmtDur) && fmtDur > 0) {
    for (const v of video) {
      const sd = v.duration ? parseFloat(v.duration) : NaN;
      if (!isNaN(sd) && sd > 0) {
        const diff = Math.abs(sd - fmtDur);
        if (diff > 1 && diff / fmtDur > 0.05) {
          warnings.push({
            level: "warning",
            title: t("コンテナと映像の長さが不一致", "Container/video duration mismatch"),
            detail: t(
              `コンテナ ${fmtDur.toFixed(2)}s に対し、映像ストリーム #${v.index} は ${sd.toFixed(
                2
              )}s。音ズレやトリム漏れの可能性があります。`,
              `Container is ${fmtDur.toFixed(2)}s but video stream #${v.index} is ${sd.toFixed(
                2
              )}s. Possible A/V sync or trimming issue.`
            ),
          });
        }
      }
    }
  }

  // --- アナモルフィック（非正方ピクセル） ---
  for (const v of video) {
    if (v.width && v.height && v.display_aspect_ratio) {
      const [dn, dd] = v.display_aspect_ratio.split(":").map(Number);
      if (dn && dd) {
        const dar = dn / dd;
        const sar = v.width / v.height;
        if (Math.abs(dar - sar) / dar > 0.02) {
          warnings.push({
            level: "info",
            title: t("アナモルフィック（非正方ピクセル）", "Anamorphic (non-square pixels)"),
            detail: t(
              `ストリーム #${v.index}: 格納解像度 ${v.width}×${v.height}（比 ${sar.toFixed(
                3
              )}）と表示アスペクト比 ${v.display_aspect_ratio}（${dar.toFixed(
                3
              )}）が異なります。再生時に横方向へ伸縮されます。`,
              `Stream #${v.index}: stored ${v.width}×${v.height} (ratio ${sar.toFixed(
                3
              )}) differs from display aspect ${v.display_aspect_ratio} (${dar.toFixed(
                3
              )}). It will be stretched horizontally on playback.`
            ),
          });
        }
      }
    }
  }

  // --- 非標準サンプルレート ---
  for (const a of audio) {
    const sr = a.sample_rate ? parseInt(a.sample_rate, 10) : NaN;
    if (!isNaN(sr) && !STANDARD_SAMPLE_RATES.includes(sr)) {
      warnings.push({
        level: "info",
        title: t("非標準サンプルレート", "Non-standard sample rate"),
        detail: t(
          `音声ストリーム #${a.index}: ${sr} Hz は一般的でない値です。一部の機器で再生できないことがあります。`,
          `Audio stream #${a.index}: ${sr} Hz is unusual. Some devices may not play it.`
        ),
      });
    }
  }

  // --- ビットレート不明（映像） ---
  for (const v of video) {
    if (!v.bit_rate && !data.format?.bit_rate) {
      warnings.push({
        level: "info",
        title: t("ビットレート不明", "Bitrate unknown"),
        detail: t(
          `ストリーム #${v.index}: ビットレート情報がありません。可変ビットレートや一部コンテナでは正常です。`,
          `Stream #${v.index}: no bitrate info. Normal for VBR or some containers.`
        ),
      });
      break;
    }
  }

  return warnings;
}

/** 最初の映像ストリームを返す（サムネイル抽出用）。 */
export function firstVideoStream(data: FfprobeData): Stream | undefined {
  return (data.streams ?? []).find((s) => s.codec_type === "video");
}
