import { ProgressBar } from "./ProgressBar";
import { useRef, useState } from "react";
import { frameStatsParallel, type FrameStats } from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

const frameCache = new LruCache<string, FrameStats>(64);

export function FrameStatsPanel({
  path,
  streamIndex,
  duration,
}: {
  path: string;
  streamIndex: number;
  duration: number;
}) {
  const t = useT();
  const { notify } = useToast();
  const key = `${path}#${streamIndex}`;
  const [stats, setStats] = useState<FrameStats | null>(() => frameCache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1、負値は不定
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  async function analyze() {
    setError(null);
    setStats(null);
    setLoading(true);
    setProgress(0);
    const myReq = ++reqRef.current;
    const start = performance.now();
    try {
      const s = await frameStatsParallel(path, streamIndex, duration, (p) => {
        if (myReq === reqRef.current) setProgress(p.progress);
      });
      // 短い動画は一瞬で終わるため、バーが見えるよう最低表示時間を確保
      const elapsed = performance.now() - start;
      if (elapsed < 500) {
        if (myReq === reqRef.current) setProgress(1);
        await new Promise((r) => setTimeout(r, 500 - elapsed));
      }
      frameCache.set(key, s);
      if (myReq === reqRef.current) {
        setStats(s);
        notify(t("フレーム解析が完了しました", "Frame analysis complete"), "success");
      }
    } catch (e) {
      if (myReq === reqRef.current) setError(String(e));
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }


  return (
    <section className="frame-stats">
      <h3>{t("フレーム種別分布", "Frame type distribution")}</h3>
      {!stats && !loading && (
        <div className="panel-intro">
          <p className="hint">
            {t(
              "I/P/B フレームの割合を並列解析します（時間分割で高速化）。",
              "Analyze I/P/B frame ratio in parallel (split by time for speed)."
            )}
          </p>
          <button className="primary-btn" onClick={analyze}>
            {t("フレーム種別を解析", "Analyze frame types")}
          </button>
        </div>
      )}

      {loading && <ProgressBar progress={progress} label={t("解析中…", "Analyzing…")} />}

      {error && (
        <section className="error-box">
          <strong>{t("エラー", "Error")}</strong>
          <pre>{error}</pre>
        </section>
      )}

      {stats && !loading && (
        <>
          <div className="frame-bar">
            <span className="seg seg-i" style={{ width: `${(stats.i / stats.total) * 100}%` }} title={`I: ${stats.i}`} />
            <span className="seg seg-p" style={{ width: `${(stats.p / stats.total) * 100}%` }} title={`P: ${stats.p}`} />
            <span className="seg seg-b" style={{ width: `${(stats.b / stats.total) * 100}%` }} title={`B: ${stats.b}`} />
          </div>
          <div className="frame-legend">
            <span><b className="dot dot-i" />I {stats.i}（{((stats.i / stats.total) * 100).toFixed(1)}%）</span>
            <span><b className="dot dot-p" />P {stats.p}（{((stats.p / stats.total) * 100).toFixed(1)}%）</span>
            <span><b className="dot dot-b" />B {stats.b}（{((stats.b / stats.total) * 100).toFixed(1)}%）</span>
            <span className="muted">{t("合計", "Total")} {stats.total}</span>
            <button className="icon-btn" onClick={analyze} title={t("再解析", "Re-analyze")}>
              <i className="bi bi-arrow-clockwise" />
            </button>
          </div>
        </>
      )}
    </section>
  );
}
import { LruCache } from "./cache";
