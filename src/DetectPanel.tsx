import { useRef, useState } from "react";
import {
  detectBlackSilence,
  detectCrop,
  detectScene,
  humanDuration,
  type BlackSilence,
  type CropResult,
} from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

function ProgressBar({ progress, label }: { progress: number; label: string }) {
  const indet = progress < 0;
  const pct = Math.round(Math.max(progress, 0) * 100);
  return (
    <div className="frame-progress">
      <div className="progress-track">
        <div
          className={`progress-fill ${indet ? "indeterminate" : ""}`}
          style={indet ? undefined : { width: `${pct}%` }}
        />
      </div>
      <span className="progress-label">{indet ? label : `${pct}%`}</span>
    </div>
  );
}

export function DetectPanel({
  path,
  duration,
  hasVideo,
  hasAudio,
}: {
  path: string;
  duration: number;
  hasVideo: boolean;
  hasAudio: boolean;
}) {
  const t = useT();
  const { notify } = useToast();

  // --- black / silence ---
  const [bs, setBs] = useState<BlackSilence | null>(null);
  const [bsLoading, setBsLoading] = useState(false);
  const [bsProg, setBsProg] = useState(0);
  const bsReq = useRef(0);

  async function runBs() {
    setBsLoading(true);
    setBsProg(0);
    const my = ++bsReq.current;
    try {
      const r = await detectBlackSilence(path, duration, hasVideo, hasAudio, (p) => {
        if (my === bsReq.current) setBsProg(p);
      });
      if (my === bsReq.current) {
        setBs(r);
        notify(
          t(
            `ブラック ${r.black.length} 件 / 無音 ${r.silence.length} 件`,
            `${r.black.length} black / ${r.silence.length} silence`
          ),
          "success"
        );
      }
    } catch (e) {
      if (my === bsReq.current) notify(String(e), "error");
    } finally {
      if (my === bsReq.current) setBsLoading(false);
    }
  }

  // --- scene ---
  const [scenes, setScenes] = useState<number[] | null>(null);
  const [scLoading, setScLoading] = useState(false);
  const [scProg, setScProg] = useState(0);
  const [threshold, setThreshold] = useState(0.4);
  const scReq = useRef(0);

  async function runScene() {
    setScLoading(true);
    setScProg(0);
    const my = ++scReq.current;
    try {
      const r = await detectScene(path, duration, threshold, (p) => {
        if (my === scReq.current) setScProg(p);
      });
      if (my === scReq.current) {
        setScenes(r);
        notify(t(`シーンチェンジ ${r.length} 件`, `${r.length} scene changes`), "success");
      }
    } catch (e) {
      if (my === scReq.current) notify(String(e), "error");
    } finally {
      if (my === scReq.current) setScLoading(false);
    }
  }

  // --- crop ---
  const [crop, setCrop] = useState<CropResult | null>(null);
  const [cropLoading, setCropLoading] = useState(false);

  async function runCrop() {
    setCropLoading(true);
    try {
      const r = await detectCrop(path);
      setCrop(r);
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setCropLoading(false);
    }
  }

  return (
    <section className="detect-panel">
      <h2>{t("検出", "Detection")}</h2>

      {/* ブラック / 無音 */}
      {(hasVideo || hasAudio) && (
        <div className="detect-block">
          <div className="detect-head">
            <span>{t("ブラックフレーム / 無音", "Black frames / silence")}</span>
            {!bsLoading && (
              <button className="preset-chip" onClick={runBs}>
                {bs ? t("再検出", "Re-run") : t("検出", "Detect")}
              </button>
            )}
          </div>
          {bsLoading && <ProgressBar progress={bsProg} label={t("検出中…", "Detecting…")} />}
          {bs && !bsLoading && (
            <div className="detect-cols">
              <IntervalList title={t("ブラック", "Black")} items={bs.black} icon="bi-circle-fill" />
              <IntervalList title={t("無音", "Silence")} items={bs.silence} icon="bi-volume-mute-fill" />
            </div>
          )}
        </div>
      )}

      {/* シーンチェンジ */}
      {hasVideo && (
        <div className="detect-block">
          <div className="detect-head">
            <span>{t("シーンチェンジ", "Scene changes")}</span>
            <label className="detect-th">
              {t("しきい値", "threshold")}
              <input
                type="number"
                min={0.05}
                max={0.95}
                step={0.05}
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
            </label>
            {!scLoading && (
              <button className="preset-chip" onClick={runScene}>
                {scenes ? t("再検出", "Re-run") : t("検出", "Detect")}
              </button>
            )}
          </div>
          {scLoading && <ProgressBar progress={scProg} label={t("検出中…", "Detecting…")} />}
          {scenes && !scLoading && (
            <div className="scene-chips">
              {scenes.length === 0 ? (
                <span className="muted">{t("検出されませんでした", "None detected")}</span>
              ) : (
                scenes.map((s, i) => (
                  <span key={i} className="scene-chip">
                    {humanDuration(s)}
                  </span>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* クロップ */}
      {hasVideo && (
        <div className="detect-block">
          <div className="detect-head">
            <span>{t("クロップ検出（黒帯）", "Crop detection (black bars)")}</span>
            {!cropLoading && (
              <button className="preset-chip" onClick={runCrop}>
                {crop ? t("再検出", "Re-run") : t("検出", "Detect")}
              </button>
            )}
          </div>
          {cropLoading && <ProgressBar progress={-1} label={t("検出中…", "Detecting…")} />}
          {crop && !cropLoading && (
            <div className="crop-result">
              <code>{crop.crop}</code>
              <span className="muted">
                {crop.x === 0 && crop.y === 0
                  ? t("黒帯なし", "no black bars")
                  : t(`推奨: ${crop.w}×${crop.h} @ (${crop.x},${crop.y})`, `suggested: ${crop.w}×${crop.h} @ (${crop.x},${crop.y})`)}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function IntervalList({
  title,
  items,
  icon,
}: {
  title: string;
  items: { start: number; end: number }[];
  icon: string;
}) {
  const t = useT();
  return (
    <div className="interval-list">
      <div className="interval-title">
        <i className={`bi ${icon}`} /> {title} ({items.length})
      </div>
      {items.length === 0 ? (
        <span className="muted">{t("なし", "none")}</span>
      ) : (
        <ul>
          {items.slice(0, 50).map((it, i) => (
            <li key={i}>
              {humanDuration(it.start)} – {humanDuration(it.end)}{" "}
              <span className="muted">({(it.end - it.start).toFixed(1)}s)</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
