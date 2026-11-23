import { useMemo } from "react";
import type { BitrateSeries } from "./ffprobe";
import { useT } from "./i18n";

function fmt(bps: number): string {
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mb/s`;
  return `${(bps / 1000).toFixed(0)} kb/s`;
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function BitrateStats({ series }: { series: BitrateSeries }) {
  const t = useT();
  const sorted = useMemo(() => [...series.bps].sort((a, b) => a - b), [series.bps]);
  const median = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const min = sorted[0] ?? 0;
  // ピーク/平均比（変動の大きさの目安）
  const crest = series.avg > 0 ? series.peak / series.avg : 0;

  return (
    <section className="bitrate-stats">
      <h3>{t("ビットレート統計", "Bitrate statistics")}</h3>
      <div className="summary">
        <Stat label={t("中央値 (p50)", "Median (p50)")} value={fmt(median)} />
        <Stat label="p95" value={fmt(p95)} />
        <Stat label="p99" value={fmt(p99)} />
        <Stat label={t("最小", "Min")} value={fmt(min)} />
        <Stat label={t("ピーク/平均比", "Peak/avg")} value={`${crest.toFixed(2)}×`} />
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
