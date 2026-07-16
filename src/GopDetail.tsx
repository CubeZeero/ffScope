import type { BitrateSeries } from "./ffprobe";
import { useT } from "./i18n";

export function GopDetail({ series }: { series: BitrateSeries }) {
  const t = useT();
  if (series.keyframe_count < 2) return null;

  const maxCount = Math.max(...series.gop_hist, 1);
  const bin = series.gop_hist_bin_sec;

  return (
    <section className="gop-detail">
      <h3>{t("GOP 構造", "GOP structure")}</h3>
      <div className="summary">
        <Stat label={t("キーフレーム数", "Keyframes")} value={String(series.keyframe_count)} />
        <Stat label={t("平均 GOP", "Avg GOP")} value={`${series.avg_gop_sec.toFixed(2)} s`} />
        <Stat label={t("最短 GOP", "Min GOP")} value={`${series.gop_min_sec.toFixed(2)} s`} />
        <Stat label={t("最長 GOP", "Max GOP")} value={`${series.gop_max_sec.toFixed(2)} s`} />
      </div>

      <div className="gop-hist" title={t("GOP長の分布", "GOP length distribution")}>
        {series.gop_hist.map((c, i) => (
          <div
            key={i}
            className="gop-bar"
            style={{ height: `${(c / maxCount) * 100}%` }}
            title={`${(i * bin).toFixed(2)}–${((i + 1) * bin).toFixed(2)}s: ${c}`}
          />
        ))}
      </div>
      <div className="gop-axis">
        <span>0s</span>
        <span>{t("GOP長 →", "GOP length →")}</span>
        <span>{series.gop_max_sec.toFixed(1)}s</span>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card summary-card">
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
    </div>
  );
}
