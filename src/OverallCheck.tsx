import { useRef, useState } from "react";
import { bitrateSeries, detectBlackSilence, frameStatsParallel, integrityCheck, isStillImage, loudness, timestampCheck, visualAnomalies, type FfprobeData } from "./ffprobe";
import { analysisId, analysisNeedsReview, getAnalyses, type AnalysisKind } from "./analysis-store";
import { useAnalyses } from "./useAnalyses";
import { analysisLabels } from "./analysis-labels";
import { detectWarnings } from "./warnings";
import { useT } from "./i18n";
import { AnalysisResult } from "./AnalysisResult";

interface Task { id: string; kind: AnalysisKind; stream: number | null; run: (progress: (value: number) => void) => Promise<unknown> }
interface TaskState { id: string; status: "waiting" | "running" | "done" | "reused" | "error" | "skipped"; error?: string }
export function OverallCheck({ path, data, ffmpegAvailable }: { path: string; data: FfprobeData; ffmpegAvailable: boolean }) {
  const t = useT();
  const records = useAnalyses(path);
  const [enabled, setEnabled] = useState<AnalysisKind[]>(["integrity", "timestamps", "bitrate", "frames", "loudness", "blackSilence"]);
  const [reuse, setReuse] = useState(true);
  const [busy, setBusy] = useState(false);
  const [states, setStates] = useState<TaskState[]>([]);
  const [progress, setProgress] = useState(0);
  const [stopping, setStopping] = useState(false);
  const stopRef = useRef(false);
  const busyRef = useRef(false);
  const duration = Number(data.format?.duration) || 0;
  const videos = (data.streams ?? []).filter(s => s.codec_type === "video");
  const audios = (data.streams ?? []).filter(s => s.codec_type === "audio");
  const still = isStillImage(data);
  const tasks: Task[] = [];
  const add = (kind: AnalysisKind, stream: number | null, run: Task["run"]) => tasks.push({ kind, stream, id: analysisId(kind, stream), run });
  if (ffmpegAvailable) add("integrity", null, p => integrityCheck(path, duration, p));
  if (!still) {
    for (const stream of [...videos, ...audios]) {
      add("timestamps", stream.index, p => timestampCheck(path, stream.index, duration, p));
      add("bitrate", stream.index, () => bitrateSeries(path, stream.index));
    }
    for (const stream of videos) {
      add("frames", stream.index, p => frameStatsParallel(path, stream.index, duration, value => p(value.progress)));
      if (ffmpegAvailable) add("anomaly", stream.index, p => visualAnomalies(path, stream.index, duration, 0.5, p));
    }
    if (ffmpegAvailable) {
      for (const stream of audios) add("loudness", stream.index, p => loudness(path, stream.index, duration, p));
      if (videos.length || audios.length) add("blackSilence", null, p => detectBlackSilence(path, duration, !!videos.length, !!audios.length, p));
    }
  }
  const available = Array.from(new Set(tasks.map(task => task.kind)));
  const selectedTasks = tasks.filter(task => enabled.includes(task.kind));
  const warnings = detectWarnings(data, t);
  async function run() {
    if (busyRef.current) return;
    busyRef.current = true; stopRef.current = false; setStopping(false); setBusy(true); setProgress(0);
    const jobs = selectedTasks;
    setStates(jobs.map(job => ({ id: job.id, status: "waiting" })));
    const state = (id: string, status: TaskState["status"], error?: string) => setStates(previous => previous.map(s => s.id === id ? { id, status, error } : s));
    try {
      for (let i = 0; i < jobs.length; i++) {
        const job = jobs[i];
        if (stopRef.current) { state(job.id, "skipped"); continue; }
        if (reuse && getAnalyses(path).some(r => r.id === job.id && r.status === "complete")) state(job.id, "reused");
        else {
          state(job.id, "running");
          try {
            await job.run(p => setProgress((i + Math.max(0, Math.min(0.99, p))) / jobs.length));
            state(job.id, "done");
          } catch (e) { state(job.id, "error", String(e)); }
        }
        setProgress((i + 1) / jobs.length);
      }
    } finally { busyRef.current = false; setBusy(false); }
  }
  return <section><h2>{t("総合チェック", "Overall check")}</h2>
    <p className="hint">{t("選んだ項目を順番に実行します。別タブでも継続し、結果は納品仕様とAIで再利用できます。進捗は工程数ベースです。黒フレーム・無音は先頭の映像／音声が対象。異常候補の有無は目視確認してください。", "Runs selected checks sequentially, continuing across tabs. Results feed delivery checks and AI. Progress is task-based. Black/silence uses the first video/audio stream. Review anomaly candidates visually.")}</p>
    <p className="qc-verdict">{t("メタデータ警告", "Metadata warnings")}: {warnings.length}</p>
    {!!warnings.length && <details><summary>{t("警告を確認", "Review warnings")}</summary>{warnings.map((w, i) => <p key={i} className="hint"><strong>{w.title}</strong> — {w.detail}</p>)}</details>}
    {!ffmpegAvailable && <p className="ai-error">{t("ffmpeg未検出のため実行できない項目があります。", "Some checks are unavailable without ffmpeg.")}</p>}
    <div className="qc-check-options">{available.map(kind => <label className="ai-checkbox" key={kind}><input type="checkbox" disabled={busy} checked={enabled.includes(kind)} onChange={e => setEnabled(previous => e.target.checked ? [...previous, kind] : previous.filter(k => k !== kind))} />{t(...analysisLabels[kind])}{kind === "anomaly" && t("（重い処理）", " (expensive)")}</label>)}</div>
    <label className="ai-checkbox"><input type="checkbox" checked={reuse} disabled={busy} onChange={e => setReuse(e.target.checked)} />{t("実行済み結果を再利用", "Reuse completed results")}</label>
    <div className="qc-actions"><button type="button" className="primary-btn" disabled={busy || !selectedTasks.length} onClick={run}>{t("まとめてチェック", "Run selected checks")} ({selectedTasks.length})</button>
      {busy && <button type="button" className="icon-btn" disabled={stopping} onClick={() => { stopRef.current = true; setStopping(true); }}>{stopping ? t("現在の処理の完了待ち…", "Waiting for current task…") : t("残りの項目を停止", "Stop remaining tasks")}</button>}
    </div>
    {!!states.length && <><div className="frame-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}><div className="progress-track"><div className="progress-fill" style={{ width: `${progress * 100}%` }} /></div><span>{Math.round(progress * 100)}%</span></div>
      <ul className="qc-task-list">{states.map(s => {
        const task = tasks.find(job => job.id === s.id);
        return <li key={s.id}><span>{task ? t(...analysisLabels[task.kind]) : s.id}{task?.stream !== null && task?.stream !== undefined && ` #${task.stream}`}</span><span className={`qc-${s.status}`}>{({ waiting: t("待機", "Waiting"), running: t("実行中", "Running"), done: t("完了", "Completed"), reused: t("再利用", "Reused"), error: t("実行失敗", "Failed"), skipped: t("停止・未実行", "Skipped") })[s.status]}</span>{s.error && <pre className="ai-error">{s.error}</pre>}</li>;
      })}</ul></>}
    <h3>{t("解析結果一覧（完了＝正常とは限りません）", "Results (completed does not mean no issues)")}</h3>
    {!!records.length && <p className="qc-unknown">{t("要確認・実行失敗", "Review needed / failed")}: {records.filter(analysisNeedsReview).length}</p>}
    {records.length === 0 && <p className="hint">{t("まだ測定結果がありません。", "No measurements yet.")}</p>}
    {records.map(record => <AnalysisResult key={record.id} record={record} />)}
  </section>;
}
