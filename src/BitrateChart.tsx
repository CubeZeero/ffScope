import { useEffect, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { BitrateSeries } from "./ffprobe";
import { humanDuration } from "./ffprobe";
import { useT } from "./i18n";

interface Props {
  series: BitrateSeries;
}

function fmtRate(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(1)} Mb/s`;
  return `${(bps / 1000).toFixed(0)} kb/s`;
}

// CSS変数を読み取る（テーマ対応）
function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

const clampRange = (min: number, max: number, lo: number, hi: number): [number, number] => {
  const span = max - min;
  if (min < lo) {
    min = lo;
    max = Math.min(hi, lo + span);
  }
  if (max > hi) {
    max = hi;
    min = Math.max(lo, hi - span);
  }
  return [min, max];
};

/**
 * ホイールでリアルタイムズーム（カーソル位置中心）＋ドラッグでパン。
 * データ範囲 [lo, hi] を超えないようクランプする。
 */
function realtimeZoomPlugin(lo: number, hi: number): uPlot.Plugin {
  const MIN_SPAN = Math.max((hi - lo) / 2000, 0.05); // 拡大の下限

  return {
    hooks: {
      ready: (u) => {
        const over = u.over;

        // --- ホイールズーム ---
        over.addEventListener(
          "wheel",
          (e: WheelEvent) => {
            e.preventDefault();
            const rect = over.getBoundingClientRect();
            const left = e.clientX - rect.left;
            const leftPct = left / rect.width;
            const xVal = u.posToVal(left, "x");
            const oMin = u.scales.x.min ?? lo;
            const oMax = u.scales.x.max ?? hi;
            const oRange = oMax - oMin;
            const factor = e.deltaY < 0 ? 0.8 : 1 / 0.8; // 上スクロールで拡大
            let nRange = oRange * factor;
            nRange = Math.min(Math.max(nRange, MIN_SPAN), hi - lo);
            let nMin = xVal - leftPct * nRange;
            let nMax = nMin + nRange;
            [nMin, nMax] = clampRange(nMin, nMax, lo, hi);
            u.batch(() => u.setScale("x", { min: nMin, max: nMax }));
          },
          { passive: false }
        );

        // --- ドラッグでパン ---
        over.addEventListener("mousedown", (e: MouseEvent) => {
          if (e.button !== 0) return;
          const rect = over.getBoundingClientRect();
          const startX = e.clientX;
          const min0 = u.scales.x.min ?? lo;
          const max0 = u.scales.x.max ?? hi;
          const range0 = max0 - min0;
          over.style.cursor = "grabbing";

          const onMove = (ev: MouseEvent) => {
            const dxPct = (ev.clientX - startX) / rect.width;
            const dVal = dxPct * range0;
            const [nMin, nMax] = clampRange(min0 - dVal, max0 - dVal, lo, hi);
            u.batch(() => u.setScale("x", { min: nMin, max: nMax }));
          };
          const onUp = () => {
            over.style.cursor = "grab";
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
        });

        over.style.cursor = "grab";
      },
    },
  };
}

export function BitrateChart({ series }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [expanded, setExpanded] = useState(false);
  // キーフレームが多すぎると見づらいので、既定は500本以下のときだけ表示
  const [showKeyframes, setShowKeyframes] = useState(
    series.keyframe_count > 0 && series.keyframe_count <= 500
  );
  // draw フックからは ref 経由で参照し、トグル時はチャートを作り直さず再描画する
  const showKfRef = useRef(showKeyframes);
  const t = useT();

  function toggleKeyframes() {
    const next = !showKfRef.current;
    showKfRef.current = next;
    setShowKeyframes(next);
    plotRef.current?.redraw();
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    const accent = cssVar("--accent", "#5b9dff");
    const ng = cssVar("--ng", "#f0883e");
    const muted = cssVar("--muted", "#8b93a3");
    const border = cssVar("--border", "#2a2f3a");
    const kfColor = cssVar("--ok", "#3fb950");

    const lo = series.t[0];
    const hi = series.t[series.t.length - 1];
    const data: uPlot.AlignedData = [series.t, series.bps];

    const opts: uPlot.Options = {
      width: wrap.clientWidth || 800,
      height: expanded ? 420 : 280,
      legend: { show: true },
      // 既定の範囲選択ズームは無効化（ホイール/ドラッグで操作）
      cursor: { drag: { x: false, y: false } },
      scales: { x: { time: false, min: lo, max: hi } },
      axes: [
        {
          stroke: muted,
          grid: { stroke: border, width: 1 },
          ticks: { stroke: border },
          values: (_u, vals) => vals.map((v) => humanDuration(v)),
        },
        {
          stroke: muted,
          grid: { stroke: border, width: 1 },
          ticks: { stroke: border },
          size: 72, // 「12.5 Mb/s」等が収まる溝幅を確保
          values: (_u, vals) => vals.map((v) => fmtRate(v)),
        },
      ],
      series: [
        { label: "時刻", value: (_u, v) => (v == null ? "—" : humanDuration(v)) },
        {
          label: "ビットレート",
          stroke: accent,
          fill: accent + "33",
          width: 1,
          points: { show: false },
          value: (_u, v) => (v == null ? "—" : fmtRate(v)),
        },
      ],
      plugins: [realtimeZoomPlugin(lo, hi)],
      hooks: {
        draw: [
          (u) => {
            const { ctx } = u;
            const top = u.bbox.top;
            const bottom = u.bbox.top + u.bbox.height;

            // キーフレーム（GOP境界）の縦線
            if (showKfRef.current && series.keyframes.length) {
              ctx.save();
              ctx.strokeStyle = kfColor + "66";
              ctx.lineWidth = 1;
              for (const kt of series.keyframes) {
                if (kt < (u.scales.x.min ?? lo) || kt > (u.scales.x.max ?? hi)) continue;
                const x = u.valToPos(kt, "x", true);
                ctx.beginPath();
                ctx.moveTo(x, top);
                ctx.lineTo(x, bottom);
                ctx.stroke();
              }
              ctx.restore();
            }

            // 平均線
            const y = u.valToPos(series.avg, "y", true);
            const x0 = u.bbox.left;
            const x1 = u.bbox.left + u.bbox.width;
            ctx.save();
            ctx.strokeStyle = ng;
            ctx.setLineDash([4, 3]);
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(x0, y);
            ctx.lineTo(x1, y);
            ctx.stroke();
            ctx.restore();
          },
        ],
      },
    };

    const plot = new uPlot(opts, data, wrap);
    plotRef.current = plot;

    const ro = new ResizeObserver(() => {
      plot.setSize({ width: wrap.clientWidth, height: expanded ? 420 : 280 });
    });
    ro.observe(wrap);

    return () => {
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [series, expanded]);

  return (
    <div className={`chart-outer ${expanded ? "chart-expanded" : ""}`}>
      <div className="chart-toolbar">
        <span className="chart-stats">
          {t("ピーク", "Peak")} {fmtRate(series.peak)}　/　{t("平均", "Avg")} {fmtRate(series.avg)}
          {series.keyframe_count > 0 && (
            <>
              　/　{t("キーフレーム", "Keyframes")} {series.keyframe_count}　/　{t("平均GOP", "Avg GOP")}{" "}
              {series.avg_gop_sec.toFixed(2)}s
            </>
          )}
        </span>
        <div className="chart-buttons">
          {series.keyframe_count > 0 && (
            <button type="button" className={showKeyframes ? "active" : ""} onClick={toggleKeyframes}>
              {t("キーフレーム", "Keyframes")}
            </button>
          )}
          <button
            type="button"
            onClick={() =>
              plotRef.current?.setScale("x", {
                min: series.t[0],
                max: series.t[series.t.length - 1],
              })
            }
          >
            {t("ズーム解除", "Reset zoom")}
          </button>
          <button type="button" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t("縮小表示", "Shrink") : t("全幅で拡大", "Full width")}
          </button>
        </div>
      </div>
      <div className="chart-wrap" ref={wrapRef} />
      <p className="chart-hint">
        {t(
          "ホイールで拡大／縮小（カーソル位置中心）、ドラッグで左右にパン、「ズーム解除」で全体に戻ります。",
          "Scroll to zoom (centered on cursor), drag to pan, “Reset zoom” to fit."
        )}
      </p>
    </div>
  );
}
