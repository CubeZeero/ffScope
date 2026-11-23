import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { thumbnail, humanDuration, visualAnomalies, type AnomalyCandidate as Candidate, type AnomalyScan as Scan } from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

export function VisualAnomalyPanel({ path, duration, streamIndex }: { path: string; duration: number; streamIndex: number }) {
  const t = useT();
  const { notify } = useToast();
  const [sensitivity, setSensitivity] = useState(0.5);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Scan | null>(null);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [error, setError] = useState("");

  async function run() {
    setLoading(true); setProgress(0); setError(""); setResult(null); setSelected(null);
    try {
      const r = await visualAnomalies(path, streamIndex, duration, sensitivity, setProgress);
      setResult(r);
      notify(t(`異常フレーム解析完了: ${r.candidates.length} 候補`, `Visual scan complete: ${r.candidates.length} candidates`), "success");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }
  async function exportResults() {
    const target = await save({ defaultPath: "visual-anomalies.json", filters: [{ name: "JSON", extensions: ["json"] }] });
    if (target) await invoke("save_text", { path: target, contents: JSON.stringify({ path, streamIndex, sensitivity, ...result }, null, 2) });
  }
  return <section className="integrity">
    <h2>{t("視覚的な異常フレーム検出", "Visual anomaly detection")}</h2>
    <p className="hint">{t("前後の映像と比べ、1〜3フレームだけ急変する箇所を探します。フラッシュや意図的なエフェクトも候補になるため、画像を見て確認してください。", "Finds brief 1–3 frame excursions. Flashes and intentional effects can also be candidates; review the images.")}</p>
    <div className="fp-controls anomaly-controls">
      <label className="anomaly-sensitivity">
        <span>{t("感度", "Sensitivity")}</span>
        <input className="anomaly-range" type="range" min="0" max="1" step="0.05" value={sensitivity} disabled={loading} style={{ "--range-progress": `${sensitivity * 100}%` } as CSSProperties} onChange={e => setSensitivity(Number(e.target.value))} />
        <output>{Math.round(sensitivity*100)}%</output>
      </label>
      <button className="primary-btn" disabled={loading} onClick={run}>{t("全体をスキャン", "Scan whole video")}</button>
    </div>
    {loading && <div className="frame-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress < 0 ? undefined : Math.round(progress*100)}>
      <span className="spinner" /><div className="progress-track"><div className={`progress-fill ${progress < 0 ? "indeterminate" : ""}`} style={progress < 0 ? undefined : { width: `${Math.round(progress*100)}%` }} /></div><span>{progress < 0 ? t("解析中", "Scanning") : `${Math.round(progress*100)}%`}</span>
    </div>}
    {error && <pre className="integ-errors">{error}</pre>}
    {result && <>
      <p className="hint">{t(`${result.frames} フレームを確認 / ${result.candidates.length} 候補（フレーム番号は1始まり）`, `${result.frames} frames scanned / ${result.candidates.length} candidates (1-based frame numbers)`)}{result.truncated && t(" — 表示は2000件まで", " — capped at 2000")}</p>
      <div className="anomaly-timeline">{result.candidates.map(c => <button key={c.frame} style={{ left: `${duration > 0 ? Math.min(c.time/duration*100, 99.5) : 0}%` }} title={`${humanDuration(c.time)} #${c.frame}`} onClick={() => setSelected(c)} aria-label={`Frame ${c.frame}`} />)}</div>
      <div className="anomaly-candidates">
        {result.candidates.length === 0 && <p className="hint">{t("異常候補は見つかりませんでした。", "No anomaly candidates found.")}</p>}
        {result.candidates.map(c => <button type="button" className={`anomaly-candidate ${selected?.frame === c.frame ? "selected" : ""}`} key={c.frame} aria-pressed={selected?.frame === c.frame} onClick={() => setSelected(c)}>
          <span className="anomaly-candidate-main"><i className="bi bi-exclamation-triangle" aria-hidden="true" /><span><strong>{humanDuration(c.time)} <span className="anomaly-seconds">({c.time.toFixed(3)}s)</span></strong><small>{t("フレーム", "Frame")} #{c.frame}</small></span></span>
          <span className="anomaly-score"><small>{t("差異スコア", "Difference score")}</small><strong>{(c.score*100).toFixed(1)}</strong></span>
          <i className="bi bi-chevron-right" aria-hidden="true" />
        </button>)}
      </div>
      {selected && <div className="anomaly-images">{[selected.before, selected.time, selected.after].map((time, i) => <Preview key={`${selected.frame}-${i}`} path={path} time={time} label={[t("前", "Before"), t("候補", "Candidate"), t("次", "After")][i]} />)}</div>}
      <button className="icon-btn" onClick={() => exportResults().catch(e => setError(String(e)))}>{t("候補をJSON保存", "Export candidates as JSON")}</button>
    </>}
  </section>;
}

function Preview({ path, time, label }: { path: string; time: number; label: string }) {
  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { let active = true; thumbnail(path, Math.max(0, time), 480).then(s => { if (active) setSrc(s); }).catch(e => { if (active) setError(String(e)); }); return () => { active = false; }; }, [path, time]);
  return <figure><figcaption>{label} · {time.toFixed(3)}s</figcaption>{src ? <img src={src} draggable={false} alt={label} /> : <span>{error || "…"}</span>}</figure>;
}
