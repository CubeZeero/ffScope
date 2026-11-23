import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  let removeListeners = () => {};
  let frame = 0;
  let pending: { min: number; max: number } | null = null;
  const schedule = (u: uPlot, min: number, max: number) => {
    pending = { min, max };
    if (!frame) frame = requestAnimationFrame(() => {
      frame = 0;
      if (pending) u.setScale("x", pending);
      pending = null;
    });
  };

  return {
    hooks: {
      ready: (u) => {
        const over = u.over;

        // --- ホイールズーム ---
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = over.getBoundingClientRect();
            if (!rect.width || hi <= lo) return;
            const left = e.clientX - rect.left;
            const leftPct = left / rect.width;
            const oMin = pending?.min ?? u.scales.x.min ?? lo;
            const oMax = pending?.max ?? u.scales.x.max ?? hi;
            const oRange = oMax - oMin;
            const xVal = oMin + leftPct * oRange;
            const factor = e.deltaY < 0 ? 0.8 : 1 / 0.8; // 上スクロールで拡大
            let nRange = oRange * factor;
            nRange = Math.min(Math.max(nRange, MIN_SPAN), hi - lo);
            let nMin = xVal - leftPct * nRange;
            let nMax = nMin + nRange;
            [nMin, nMax] = clampRange(nMin, nMax, lo, hi);
            schedule(u, nMin, nMax);
        };
        over.addEventListener("wheel", onWheel, { passive: false });

        // --- ドラッグでパン ---
        let stopDrag = () => {};
        const onDown = (e: MouseEvent) => {
          if (e.button !== 0) return;
          const rect = over.getBoundingClientRect();
          if (!rect.width) return;
          stopDrag();
          e.preventDefault();
          const startX = e.clientX;
          const min0 = u.scales.x.min ?? lo;
          const max0 = u.scales.x.max ?? hi;
          const range0 = max0 - min0;
          over.style.cursor = "grabbing";

          const onMove = (ev: MouseEvent) => {
            const dxPct = (ev.clientX - startX) / rect.width;
            const dVal = dxPct * range0;
            const [nMin, nMax] = clampRange(min0 - dVal, max0 - dVal, lo, hi);
            schedule(u, nMin, nMax);
          };
          const onUp = () => {
            over.style.cursor = "grab";
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMove);
          window.addEventListener("mouseup", onUp);
          stopDrag = onUp;
        };
        over.addEventListener("mousedown", onDown);
        removeListeners = () => {
          stopDrag();
          over.removeEventListener("wheel", onWheel);
          over.removeEventListener("mousedown", onDown);
        };

        over.style.cursor = "grab";
      },
      destroy: () => {
        cancelAnimationFrame(frame);
        pending = null;
        removeListeners();
      },
    },
  };
}

export function BitrateChart({ series }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const viewportRef = useRef<{ series: BitrateSeries; min: number; max: number } | null>(null);
  const [themeRevision, setThemeRevision] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const modalWrapRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const [autoY, setAutoY] = useState(true);
  const autoYRef = useRef(true);
  const fullYRangeRef = useRef<{ min: number; max: number } | null>(null);
  // キーフレームが多すぎると見づらいので、既定は500本以下のときだけ表示
  const [showKeyframes, setShowKeyframes] = useState(
    series.keyframe_count > 0 && series.keyframe_count <= 500
  );
  // draw フックからは ref 経由で参照し、トグル時はチャートを作り直さず再描画する
  const showKfRef = useRef(showKeyframes);
  const t = useT();

  useEffect(() => {
    const observer = new MutationObserver(() => setThemeRevision(v => v + 1));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-style"] });
    return () => observer.disconnect();
  }, []);

  function toggleKeyframes() {
    const next = !showKfRef.current;
    showKfRef.current = next;
    setShowKeyframes(next);
    plotRef.current?.redraw();
  }

  function toggleAutoY() {
    const next = !autoYRef.current;
    autoYRef.current = next;
    setAutoY(next);
    const plot = plotRef.current;
    if (!next && fullYRangeRef.current) {
      // OFF always uses the whole-file range, not the currently zoomed range.
      plot?.setScale("y", fullYRangeRef.current);
    } else {
      plot?.redraw(true, true);
    }
  }

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || series.t.length === 0) return;

    const accent = cssVar("--accent", "#5b9dff");
    const ng = cssVar("--ng", "#f0883e");
    const muted = cssVar("--muted", "#8b93a3");
    const border = cssVar("--border", "#2a2f3a");
    const kfColor = cssVar("--ok", "#3fb950");

    const lo = series.t[0];
    const hi = series.t[series.t.length - 1];
    const data: uPlot.AlignedData = [series.t, series.bps];
    let minRate = Infinity;
    let maxRate = -Infinity;
    for (const value of series.bps) {
      if (Number.isFinite(value)) {
        minRate = Math.min(minRate, value);
        maxRate = Math.max(maxRate, value);
      }
    }
    const [fullMin, fullMax] = uPlot.rangeNum(
      Number.isFinite(minRate) ? minRate : 0,
      Number.isFinite(maxRate) ? maxRate : 1, 0.1, true
    );
    fullYRangeRef.current = { min: fullMin!, max: fullMax! };

    const opts: uPlot.Options = {
      width: wrap.clientWidth || 800,
      height: 280,
      legend: { show: true },
      // 既定の範囲選択ズームは無効化（ホイール/ドラッグで操作）
      cursor: { drag: { x: false, y: false } },
      scales: {
        x: { time: false,
          min: viewportRef.current?.series === series ? viewportRef.current.min : lo,
          max: viewportRef.current?.series === series ? viewportRef.current.max : hi },
        y: { auto: () => autoYRef.current },
      },
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
        { label: t("時刻", "Time"), value: (_u, v) => (v == null ? "—" : humanDuration(v)) },
        {
          label: t("ビットレート", "Bitrate"),
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
              ctx.beginPath();
              for (const kt of series.keyframes) {
                if (kt < (u.scales.x.min ?? lo) || kt > (u.scales.x.max ?? hi)) continue;
                const x = u.valToPos(kt, "x", true);
                ctx.moveTo(x, top);
                ctx.lineTo(x, bottom);
              }
              ctx.stroke();
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
    if (!autoYRef.current) plot.setScale("y", fullYRangeRef.current);

    const ro = new ResizeObserver(() => {
      if (expandedRef.current) return;
      const width = wrap.clientWidth;
      const height = 280;
      if (width > 0 && (plot.width !== width || plot.height !== height)) {
        plot.setSize({ width, height });
      }
    });
    ro.observe(wrap);

    return () => {
      viewportRef.current = { series, min: plot.scales.x.min ?? lo, max: plot.scales.x.max ?? hi };
      ro.disconnect();
      plot.destroy();
      plotRef.current = null;
    };
  }, [series, themeRevision, t]);

  useEffect(() => {
    if (!expanded) return;
    const dialog = dialogRef.current;
    const host = modalWrapRef.current;
    const plot = plotRef.current;
    const original = wrapRef.current;
    if (!dialog || !host || !plot || !original) return;
    dialog.showModal();
    // Move the existing plot, retaining zoom/pan and keyframe state.
    host.appendChild(plot.root);
    const resize = () => {
      if (host.clientWidth > 0 && host.clientHeight > 0) {
        const legendHeight = plot.root.querySelector<HTMLElement>(".u-legend")?.offsetHeight ?? 0;
        const height = Math.max(160, host.clientHeight - legendHeight);
        if (plot.width !== host.clientWidth || plot.height !== height) {
          plot.setSize({ width: host.clientWidth, height });
        }
      }
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    return () => {
      observer.disconnect();
      dialog.close();
      if (plotRef.current === plot) {
        original.appendChild(plot.root);
        if (original.clientWidth > 0) plot.setSize({ width: original.clientWidth, height: 280 });
      }
    };
  }, [expanded, series, themeRevision, t]);

  function resetZoom() {
    plotRef.current?.setScale("x", { min: series.t[0], max: series.t[series.t.length - 1] });
  }

  return (
    <div className="chart-outer">
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
          <button type="button" className={autoY ? "active" : ""} aria-pressed={autoY} onClick={toggleAutoY}
            title={t("オフにすると動画全体の縦軸範囲に戻して固定します", "Turn off to lock the Y-axis to the whole-file range")}>
            {t("縦軸自動", "Auto Y-axis")} {autoY ? "ON" : "OFF"}
          </button>
          {series.keyframe_count > 0 && (
            <button type="button" className={showKeyframes ? "active" : ""} onClick={toggleKeyframes}>
              {t("キーフレーム", "Keyframes")}
            </button>
          )}
          <button
            type="button"
            onClick={resetZoom}
          >
            {t("ズーム解除", "Reset zoom")}
          </button>
          <button type="button" onClick={() => setExpanded(true)}>
            <i className="bi bi-arrows-fullscreen" /> {t("拡大表示", "Enlarge")}
          </button>
        </div>
      </div>
      <div className="chart-wrap" ref={wrapRef} style={expanded ? { minHeight: 280 } : undefined} />
      <p className="chart-hint">
        {t(
          "ホイールで拡大／縮小（カーソル位置中心）、ドラッグで左右にパン、「ズーム解除」で全体に戻ります。",
          "Scroll to zoom (centered on cursor), drag to pan, “Reset zoom” to fit."
        )}
      </p>
      {expanded && createPortal(<dialog ref={dialogRef} className="bitrate-viewer" aria-label={t("ビットレートグラフ拡大表示", "Expanded bitrate chart")}
        onCancel={() => setExpanded(false)} onClick={e => {
          if (e.target !== e.currentTarget) return;
          const rect = e.currentTarget.getBoundingClientRect();
          if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) setExpanded(false);
        }}>
        <div className="modal-head">
          <h2>{t("ビットレート", "Bitrate")}</h2>
          <button type="button" className="icon-btn" autoFocus onClick={() => setExpanded(false)} aria-label={t("閉じる", "Close")}><i className="bi bi-x-lg" /></button>
        </div>
        <div className="bitrate-viewer-body">
          <div className="chart-toolbar">
            <span className="chart-stats">{t("ピーク", "Peak")} {fmtRate(series.peak)} / {t("平均", "Avg")} {fmtRate(series.avg)}</span>
            <div className="chart-buttons">
              <button type="button" className={autoY ? "active" : ""} aria-pressed={autoY} onClick={toggleAutoY}
                title={t("オフにすると動画全体の縦軸範囲に戻して固定します", "Turn off to lock the Y-axis to the whole-file range")}>
                {t("縦軸自動", "Auto Y-axis")} {autoY ? "ON" : "OFF"}
              </button>
              {series.keyframe_count > 0 && <button type="button" className={showKeyframes ? "active" : ""} aria-pressed={showKeyframes} onClick={toggleKeyframes}>{t("キーフレーム", "Keyframes")}</button>}
              <button type="button" onClick={resetZoom}>{t("ズーム解除", "Reset zoom")}</button>
            </div>
          </div>
          <div className="bitrate-viewer-plot" ref={modalWrapRef} />
          <p className="chart-hint">{t("ホイールでズーム、ドラッグで左右に移動できます。", "Scroll to zoom, drag to pan.")}</p>
        </div>
      </dialog>, document.body)}
    </div>
  );
}
