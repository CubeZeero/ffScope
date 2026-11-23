import { memo, useMemo, useState } from "react";
import { ColorPanel } from "./ColorPanel";
import { FileHashPanel } from "./FileHashPanel";
import { ImagePreview } from "./ImagePreview";
import { detectWarnings } from "./warnings";
import { useT } from "./i18n";
import { formatUnixTimestamp, humanBitrate, humanBytes, humanDuration, isStillImage, isUnixTimestamp, streamRows, typeIconClass, type FfprobeData, type Stream } from "./ffprobe";

export const InfoTab = memo(function InfoTab({ data, path }: { data: FfprobeData; path: string }) {
  const format = data.format!;
  const streams = data.streams ?? [];
  const chapters = data.chapters ?? [];
  const t = useT();
  const warnings = useMemo(() => detectWarnings(data, t), [data, t]);
  const still = isStillImage(data);

  return (
    <>
      {still && <ImagePreview path={path} />}

      {warnings.length > 0 && (
        <section className="warnings">
          {warnings.map((w, i) => (
            <div key={i} className={`warn warn-${w.level}`}>
              <span className="warn-icon">
                <i
                  className={`bi ${
                    w.level === "warning" ? "bi-exclamation-triangle-fill" : "bi-info-circle-fill"
                  }`}
                />
              </span>
              <div>
                <div className="warn-title">{w.title}</div>
                <div className="warn-detail">{w.detail}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="summary">
        <SummaryCard label={t("フォーマット", "Format")} value={format.format_long_name ?? format.format_name ?? "—"} />
        <SummaryCard label={t("再生時間", "Duration")} value={humanDuration(format.duration)} />
        <SummaryCard label={t("サイズ", "Size")} value={humanBytes(format.size)} />
        <SummaryCard label={t("総ビットレート", "Total bitrate")} value={humanBitrate(format.bit_rate)} />
        <SummaryCard label={t("ストリーム数", "Streams")} value={String(format.nb_streams ?? streams.length)} />
      </section>

      <ColorPanel path={path} streams={streams} />

      <section className="streams">
        <h2>{t("ストリーム", "Streams")}</h2>
        {streams.map((s) => (
          <StreamCard key={s.index} stream={s} />
        ))}
      </section>

      {chapters.length > 0 && (
        <section className="chapters">
          <h2>
            {t("チャプター", "Chapters")} ({chapters.length})
          </h2>
          <table className="kv chapters-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t("開始", "Start")}</th>
                <th>{t("終了", "End")}</th>
                <th>{t("タイトル", "Title")}</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((c, i) => (
                <tr key={c.id ?? i}>
                  <td>{i + 1}</td>
                  <td>{humanDuration(c.start_time)}</td>
                  <td>{humanDuration(c.end_time)}</td>
                  <td>{c.tags?.title ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {format.tags && Object.keys(format.tags).length > 0 && (
        <section className="tags-section">
          <h2>{t("メタデータ (タグ)", "Metadata (tags)")}</h2>
          <KeyValueTable obj={format.tags} />
        </section>
      )}

      <FileHashPanel path={path} />
    </>
  );
});

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card summary-card">
      <div className="card-label">{label}</div>
      <div className="card-value" title={value}>
        {value}
      </div>
    </div>
  );
}

function StreamCard({ stream: s }: { stream: Stream }) {
  const t = useT();
  const rows = streamRows(s, t);
  // 全 ffprobe フィールド（実行時オブジェクトには型に無いキーも含まれる）
  const allFields = Object.entries(s as unknown as Record<string, unknown>).map(([k, v]) => {
    const val =
      v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
    return [k, val] as [string, string];
  });
  return (
    <div className="card stream-card">
      <div className="stream-head">
        <span className="stream-icon">
          <i className={`bi ${typeIconClass(s.codec_type)}`} />
        </span>
        <span className="stream-type">
          #{s.index} {s.codec_type ?? "unknown"}
        </span>
        <span className="stream-codec">{s.codec_name ?? ""}</span>
      </div>
      <table className="kv">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="kv-k">{k}</td>
              <td className="kv-v">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details className="all-fields">
        <summary>
          {t("全フィールド", "All fields")} ({allFields.length})
        </summary>
        <table className="kv">
          <tbody>
            {allFields.map(([k, v]) => (
              <tr key={k}>
                <td className="kv-k">{k}</td>
                <td className="kv-v">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function KeyValueTable({ obj }: { obj: Record<string, string> }) {
  const t = useT();
  const [converted, setConverted] = useState<Record<string, boolean>>({});
  return (
    <table className="kv">
      <tbody>
        {Object.entries(obj).map(([k, v]) => {
          const val = String(v);
          const isTs = isUnixTimestamp(val);
          const show = converted[k];
          return (
            <tr key={k}>
              <td className="kv-k">{k}</td>
              <td className="kv-v">
                {isTs && show ? formatUnixTimestamp(val) : val}
                {isTs && (
                  <button
                    className="ts-btn"
                    title={show ? t("元の値に戻す", "Show raw value") : t("日時に変換", "Convert to date")}
                    onClick={() => setConverted((c) => ({ ...c, [k]: !c[k] }))}
                  >
                    <i className={`bi ${show ? "bi-arrow-counterclockwise" : "bi-clock"}`} />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
