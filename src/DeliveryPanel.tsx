import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_SPEC, evaluateDelivery, validateSpec, type DeliverySpec } from "./delivery";
import { beginAnalysis, completeAnalysis, discardAnalysis } from "./analysis-store";
import { useAnalyses } from "./useAnalyses";
import { useT } from "./i18n";
import type { FfprobeData } from "./ffprobe";

const labels: Record<string, [string, string]> = {
  video_present: ["映像ストリーム", "Video streams"], audio_present: ["音声ストリーム", "Audio streams"], width: ["横幅", "Width"], height: ["高さ", "Height"], fps: ["平均fps", "Average FPS"],
  video_codec: ["映像コーデック", "Video codec"], audio_codec: ["音声コーデック", "Audio codec"], sample_rate: ["サンプルレート", "Sample rate"], channels: ["チャンネル数", "Channels"], lufs: ["統合LUFS", "Integrated LUFS"], true_peak: ["True Peak (dBTP)", "True Peak (dBTP)"],
};
export function DeliveryPanel({ path, data }: { path: string; data: FfprobeData }) {
  const t = useT();
  const analyses = useAnalyses(path);
  const [spec, setSpec] = useState<DeliverySpec>(() => {
    try {
      const saved = { ...DEFAULT_SPEC, ...JSON.parse(localStorage.getItem("ffscope-delivery-spec") || "{}") };
      return validateSpec(saved) ? { ...DEFAULT_SPEC } : saved;
    } catch { return { ...DEFAULT_SPEC }; }
  });
  const [error, setError] = useState("");
  const [showSpec, setShowSpec] = useState(true);
  const [publishResult, setPublishResult] = useState(false);
  const invalid = validateSpec(spec);
  const verdicts = useMemo(() => invalid ? [] : evaluateDelivery(data, spec, analyses), [data, spec, analyses, invalid]);
  const counts = { pass: verdicts.filter(v => v.status === "pass").length, fail: verdicts.filter(v => v.status === "fail").length, unknown: verdicts.filter(v => v.status === "unknown").length, skip: verdicts.filter(v => v.status === "skip").length };
  // Summary-only publication: dependency excludes the delivery record itself to avoid a feedback loop.
  const signature = JSON.stringify({ spec, verdicts });
  useEffect(() => {
    if (!publishResult) return;
    if (invalid) { discardAnalysis(path, "delivery"); return; }
    completeAnalysis(path, beginAnalysis(path, "delivery"), counts);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, signature, invalid, publishResult]);
  const update = (patch: Partial<DeliverySpec>) => setSpec(s => ({ ...s, ...patch }));
  async function exportReport() {
    try {
      const target = await save({ defaultPath: "delivery-check.json", filters: [{ name: "JSON", extensions: ["json"] }] });
      if (target) await invoke("save_text", { path: target, contents: JSON.stringify({ spec, counts, verdicts }, null, 2) });
    } catch (e) { setError(String(e)); }
  }
  return <section className="delivery-panel"><h2>{t("納品仕様チェック", "Delivery specification check")}</h2>
    <p className="hint">{t("初期値は1080p/29.97fps・H.264/AAC・-14 LUFSの設定例です。納品先の指定条件に変更してください。全映像・音声ストリームを判定し、未測定は未確認とします。平均fpsの一致だけではCFRは保証しません。", "Defaults are an example, not a delivery standard. Edit for your recipient. Checks all video/audio streams; unmeasured items stay unknown. Average FPS alone does not prove CFR.")}</p>
    <div className="qc-actions"><button type="button" className="icon-btn" onClick={() => setShowSpec(v => !v)} aria-expanded={showSpec}>{t("仕様を編集", "Edit specification")}</button>
      <button type="button" className="primary-btn" disabled={!!invalid} onClick={() => setPublishResult(true)}>{publishResult ? t("結果を共有中（変更に追従）", "Sharing result (updates automatically)") : t("この仕様で判定・AI連携", "Check & enable AI attachment")}</button>
      <button type="button" className="icon-btn" disabled={!!invalid} onClick={() => { try { localStorage.setItem("ffscope-delivery-spec", JSON.stringify(spec)); setError(t("仕様を保存しました", "Specification saved")); } catch { setError(t("仕様を保存できませんでした", "Could not save specification")); } }}>{t("仕様を保存", "Save specification")}</button>
      <button type="button" className="icon-btn" disabled={!!invalid} onClick={exportReport}>{t("結果をJSON保存", "Export JSON")}</button>
    </div>
    {showSpec && <div className="qc-spec-grid">
      <label className="ai-checkbox"><input type="checkbox" checked={spec.requireVideo} onChange={e => update({ requireVideo: e.target.checked })} />{t("映像必須", "Require video")}</label>
      <label className="ai-checkbox"><input type="checkbox" checked={spec.requireAudio} onChange={e => update({ requireAudio: e.target.checked })} />{t("音声必須", "Require audio")}</label>
      {(["width", "height", "sampleRate", "channels", "lufs", "tolerance", "truePeak"] as const).map(key => <label className="field" key={key}><span>{t(...({ width: labels.width, height: labels.height, sampleRate: labels.sample_rate, channels: labels.channels, lufs: labels.lufs, tolerance: ["LUFS許容差", "LUFS tolerance"], truePeak: labels.true_peak } as Record<string, [string, string]>)[key])}</span>
        <input type="number" step={key === "lufs" || key === "tolerance" || key === "truePeak" ? "0.1" : "1"} value={spec[key] ?? ""} onChange={e => update({ [key]: e.target.value === "" ? key === "tolerance" ? 0 : null : Number(e.target.value) })} /></label>)}
      {(["fps", "videoCodec", "audioCodec"] as const).map(key => <label className="field" key={key}><span>{t(...({ fps: labels.fps, videoCodec: labels.video_codec, audioCodec: labels.audio_codec })[key])}</span><input type="text" maxLength={80} value={spec[key]} onChange={e => update({ [key]: e.target.value })} /></label>)}
      <p className="hint">{t("空欄の条件は判定対象外です。fpsは29.97または30000/1001の形式。", "Blank fields are ignored. FPS accepts 29.97 or 30000/1001.")}</p>
    </div>}
    {invalid && <p className="ai-error">{t("仕様の値を確認してください", "Invalid specification field")}: {invalid}</p>}
    {error && <p className="hint" role="status">{error}</p>}
    {!invalid && <><p className="qc-verdict" role="status">{counts.fail ? t("不適合あり", "Non-compliant") : counts.unknown ? t("未確認項目あり", "Verification incomplete") : counts.pass ? t("指定条件に適合", "Specified checks passed") : t("判定対象なし", "No specified checks")} — {t("適合", "Pass")} {counts.pass} / {t("不適合", "Fail")} {counts.fail} / {t("未確認", "Unknown")} {counts.unknown}</p>
      <div className="qc-table-wrap"><table className="qc-table"><thead><tr>{[t("項目", "Check"), t("実測", "Actual"), t("条件", "Expected"), t("判定", "Result")].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{verdicts.map(v => <tr key={`${v.code}:${v.stream}`}><td>{t(...labels[v.code])}{v.stream !== null && ` #${v.stream}`}</td><td>{v.actual}</td><td>{v.expected}</td><td className={`qc-${v.status}`}>{({ pass: t("適合", "Pass"), fail: t("不適合", "Fail"), unknown: t("未測定・不明", "Unmeasured/unknown"), skip: t("対象外", "Not specified") })[v.status]}</td></tr>)}</tbody></table></div></>}
  </section>;
}
