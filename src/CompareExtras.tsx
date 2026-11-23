import { useEffect, useMemo, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import {
  basename,
  diffTimeline,
  frameDiff,
  humanDuration,
  qualityCompare,
  saveBinary,
  type DiffMode,
  type DiffTimeline,
  type QualityMetric,
} from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

const METRICS: { key: QualityMetric; label: string }[] = [
  { key: "vmaf", label: "VMAF" },
  { key: "psnr", label: "PSNR" },
  { key: "ssim", label: "SSIM" },
];

function dataUrlToBytes(url: string): Uint8Array {
  const b64 = url.split(",")[1] ?? "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function CompareExtras({
  pathA,
  pathB,
  durA,
  durB,
}: {
  pathA: string;
  pathB: string;
  durA: number;
  durB: number;
}) {
  const t = useT();
  const { notify } = useToast();
  const maxDur = Math.max(durA, durB);
  const minDur = Math.min(durA || maxDur, durB || maxDur);

  // ---- 品質比較 ----
  const [metric, setMetric] = useState<QualityMetric>("vmaf");
  const [score, setScore] = useState<string | null>(null);
  const [qLoading, setQLoading] = useState(false);
  const [qProg, setQProg] = useState(0);
  const [qErr, setQErr] = useState<string | null>(null);
  const qReq = useRef(0);

  async function runQuality(m: QualityMetric) {
    setMetric(m);
    setScore(null);
    setQErr(null);
    setQLoading(true);
    setQProg(0);
    const my = ++qReq.current;
    try {
      // A = 基準(reference), B = 対象(distorted)
      const s = await qualityCompare(pathB, pathA, m, maxDur, (p) => {
        if (my === qReq.current) setQProg(p);
      });
      if (my === qReq.current) {
        setScore(s);
        notify(t("品質比較が完了しました", "Quality comparison complete"), "success");
      }
    } catch (e) {
      if (my === qReq.current) setQErr(String(e));
    } finally {
      if (my === qReq.current) setQLoading(false);
    }
  }

  // ---- フレーム差分 ----
  const [time, setTime] = useState(minDur > 0 ? Math.min(minDur * 0.1, minDur) : 0);
  const [amp, setAmp] = useState(4);
  const [mode, setMode] = useState<DiffMode>("diff");
  const [threshold, setThreshold] = useState(16);
  const [diffSrc, setDiffSrc] = useState<string | null>(null);
  const [dLoading, setDLoading] = useState(false);
  const [dErr, setDErr] = useState<string | null>(null);
  const dReq = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const my = ++dReq.current;
    setDLoading(true);
    setDErr(null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      frameDiff(pathA, pathB, time, mode, amp, threshold, 640)
        .then((url) => {
          if (my === dReq.current) setDiffSrc(url);
        })
        .catch((e) => {
          if (my === dReq.current) setDErr(String(e));
        })
        .finally(() => {
          if (my === dReq.current) setDLoading(false);
        });
    }, 200);
    return () => clearTimeout(timer.current);
  }, [pathA, pathB, time, amp, mode, threshold]);

  // ---- 差分タイムライン（全体スキャン） ----
  const [timeline, setTimeline] = useState<DiffTimeline | null>(null);
  const [tlLoading, setTlLoading] = useState(false);
  const [tlProg, setTlProg] = useState(0);
  const [sens, setSens] = useState(0.25); // 感度（基準からの相対しきい値 0..1）
  const tlReq = useRef(0);

  // 「変化なし」の基準（下位10パーセンタイル）とレンジを算出
  const tlStats = useMemo(() => {
    if (!timeline || !timeline.mag.length) return null;
    const sorted = [...timeline.mag].sort((a, b) => a - b);
    const floor = sorted[Math.floor(sorted.length * 0.1)] ?? sorted[0];
    const range = Math.max(timeline.max - floor, 1e-6);
    return { floor, range };
  }, [timeline]);

  async function scanTimeline() {
    setTlLoading(true);
    setTlProg(0);
    const my = ++tlReq.current;
    try {
      const r = await diffTimeline(pathA, pathB, maxDur, (p) => {
        if (my === tlReq.current) setTlProg(p);
      });
      if (my === tlReq.current) setTimeline(r);
    } catch (e) {
      if (my === tlReq.current) notify(String(e), "error");
    } finally {
      if (my === tlReq.current) setTlLoading(false);
    }
  }

  async function saveDiff() {
    if (!diffSrc) return;
    const target = await save({
      title: t("差分画像を保存", "Save diff image"),
      defaultPath: `diff_${time.toFixed(2)}s.png`,
      filters: [{ name: "PNG", extensions: ["png"] }],
    });
    if (!target) return;
    try {
      await saveBinary(target, dataUrlToBytes(diffSrc));
      notify(t("保存しました", "Saved"), "success");
    } catch (e) {
      notify(String(e), "error");
    }
  }

  const qPct = Math.round(Math.max(qProg, 0) * 100);

  return (
    <>
      <section className="compare-table-wrap">
        <h2>{t("画質比較 (VMAF / PSNR / SSIM)", "Quality (VMAF / PSNR / SSIM)")}</h2>
        <p className="hint">
          A ({basename(pathA)}) = {t("基準", "reference")}, B ({basename(pathB)}) ={" "}
          {t("対象", "distorted")}
        </p>
        <div className="scope-kinds">
          {METRICS.map((m) => (
            <button key={m.key} className={m.key === metric ? "active" : ""} onClick={() => runQuality(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        {qLoading && (
          <div className="frame-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${qPct}%` }} />
            </div>
            <span className="progress-label">{qPct}%</span>
          </div>
        )}
        {qErr && <p className="hint">{qErr}</p>}
        {score && !qLoading && (
          <div className="summary">
            <div className="card summary-card metric-big">
              <div className="card-label">{metric.toUpperCase()}</div>
              <div className="card-value">{score}</div>
            </div>
          </div>
        )}
      </section>

      <section className="compare-table-wrap">
        <h2>{t("フレーム差分（差分合成）", "Frame difference")}</h2>

        <div className="scope-controls">
          <div className="scope-kinds">
            <button className={mode === "diff" ? "active" : ""} onClick={() => setMode("diff")}>
              {t("差分", "Difference")}
            </button>
            <button className={mode === "highlight" ? "active" : ""} onClick={() => setMode("highlight")}>
              {t("変化箇所だけ", "Changes only")}
            </button>
          </div>
          {mode === "diff" ? (
            <>
              <span className="muted">{t("増幅", "Amplify")}</span>
              <select value={amp} onChange={(e) => setAmp(Number(e.target.value))}>
                {[1, 2, 4, 8, 16, 32].map((v) => (
                  <option key={v} value={v}>
                    ×{v}
                  </option>
                ))}
              </select>
            </>
          ) : (
            <>
              <span className="muted">{t("しきい値", "Threshold")}</span>
              <input
                type="number"
                className="fs-time"
                min={1}
                max={200}
                step={1}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </>
          )}
        </div>

        <div className="fp-preview">
          {diffSrc && <img src={diffSrc} alt="diff" draggable={false} />}
          {dLoading && (
            <div className="fp-overlay">
              <span className="spinner" />
            </div>
          )}
          <span className="fp-time-badge">{humanDuration(time)}</span>
        </div>
        {minDur > 0 && (
          <input
            type="range"
            className="fp-slider"
            min={0}
            max={minDur}
            step={Math.max(minDur / 2000, 0.01)}
            value={time}
            onChange={(e) => setTime(Number(e.target.value))}
          />
        )}

        {/* 差分タイムライン：差異のある時間帯をオレンジで表示（動画のみ） */}
        {maxDur > 0 && (
        <div className="difftl">
          <div className="difftl-head">
            <span className="muted">{t("差分タイムライン", "Difference timeline")}</span>
            {timeline && !tlLoading && (
              <label className="difftl-sens">
                {t("感度", "Sensitivity")}
                <input
                  type="range"
                  min={0.02}
                  max={0.8}
                  step={0.02}
                  value={sens}
                  onChange={(e) => setSens(Number(e.target.value))}
                />
              </label>
            )}
            {!tlLoading && (
              <button className="preset-chip" onClick={scanTimeline}>
                {timeline ? t("再スキャン", "Re-scan") : t("全体をスキャン", "Scan whole video")}
              </button>
            )}
          </div>
          {tlLoading && (
            <div className="frame-progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round(Math.max(tlProg, 0) * 100)}%` }} />
              </div>
              <span className="progress-label">{Math.round(Math.max(tlProg, 0) * 100)}%</span>
            </div>
          )}
          {timeline && tlStats && !tlLoading && (
            <div className="difftl-bar" title={t("クリックでその位置へ", "Click to seek")}>
              {timeline.t.map((tt, i) => {
                // 基準(floor)からの相対量。0=変化なし、1=最大の差
                const norm = Math.min(Math.max((timeline.mag[i] - tlStats.floor) / tlStats.range, 0), 1);
                const differs = norm > sens;
                return (
                  <span
                    key={i}
                    className="difftl-cell"
                    style={{
                      background: differs ? `rgba(240,136,62,${(0.35 + 0.65 * norm).toFixed(3)})` : "transparent",
                    }}
                    onClick={() => setTime(tt)}
                  />
                );
              })}
            </div>
          )}
          {timeline && !tlLoading && (
            <p className="chart-hint">
              {t(
                "オレンジ = 変化のある時間帯（濃いほど大）。感度で検出量を調整、クリックでその時刻へ。",
                "Orange = time ranges that changed (darker = larger). Adjust sensitivity, click to seek."
              )}
            </p>
          )}
        </div>
        )}

        <div className="fp-controls">
          {minDur > 0 && (
            <>
              <input
                type="number"
                className="fs-time"
                min={0}
                max={minDur}
                step={0.1}
                value={Number(time.toFixed(2))}
                onChange={(e) => setTime(Number(e.target.value))}
              />
              <span className="muted">s</span>
            </>
          )}
          <button className="primary-btn" onClick={saveDiff} disabled={!diffSrc}>
            <i className="bi bi-download" /> {t("差分を保存", "Save diff")}
          </button>
        </div>
        {dErr && <p className="hint">{dErr}</p>}
      </section>
    </>
  );
}
