import { basename, humanBitrate, humanBytes, humanDuration, streamRows, typeIconClass } from "./ffprobe";
import { CompareExtras } from "./CompareExtras";
import { useT } from "./i18n";
import type { FileState } from "./file-state";

const COMPARE_LABELS = "ABCDEFGH";

export function CompareView({
  files,
  onAdd,
  onRemove,
}: {
  files: FileState[];
  onAdd: () => void;
  onRemove: (path: string) => void;
}) {
  const t = useT();
  const ready = files.filter((f) => f.result);
  const allDiff = (vals: string[]) => new Set(vals).size > 1;

  const summaryRows: { label: string; get: (f: FileState) => string }[] = [
    { label: t("フォーマット", "Format"), get: (f) => f.result?.data.format?.format_name ?? "—" },
    { label: t("再生時間", "Duration"), get: (f) => humanDuration(f.result?.data.format?.duration) },
    { label: t("サイズ", "Size"), get: (f) => humanBytes(f.result?.data.format?.size) },
    { label: t("総ビットレート", "Total bitrate"), get: (f) => humanBitrate(f.result?.data.format?.bit_rate) },
    { label: t("ストリーム数", "Streams"), get: (f) => String(f.result?.data.format?.nb_streams ?? "—") },
  ];

  return (
    <div className="compare">
      <div className="compare-slots">
        {files.map((f, i) => (
          <SlotPicker
            key={f.path || i}
            label={COMPARE_LABELS[i] ?? String(i + 1)}
            state={f}
            onRemove={() => onRemove(f.path)}
          />
        ))}
        <div className="slot slot-add" onClick={onAdd}>
          <i className="bi bi-plus-lg" /> {t("ファイルを追加", "Add file")}
        </div>
      </div>

      {ready.length >= 2 && (
        <>
          <section className="compare-table-wrap">
            <h2>{t("フォーマット比較", "Format comparison")}</h2>
            <div className="compare-scroll">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>{t("項目", "Item")}</th>
                    {ready.map((f, i) => (
                      <th key={i} title={f.path}>
                        {COMPARE_LABELS[i] ?? i + 1}: {basename(f.path)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((r) => {
                    const vals = ready.map((f) => r.get(f));
                    return (
                      <tr key={r.label} className={allDiff(vals) ? "diff" : ""}>
                        <td className="kv-k">{r.label}</td>
                        {vals.map((v, i) => (
                          <td key={i}>{v}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <StreamCompare files={ready} />

          {ready.length === 2 && (
            <CompareExtras
              pathA={ready[0].path}
              pathB={ready[1].path}
              durA={ready[0].result?.data.format?.duration ? parseFloat(ready[0].result.data.format.duration) : 0}
              durB={ready[1].result?.data.format?.duration ? parseFloat(ready[1].result.data.format.duration) : 0}
            />
          )}
        </>
      )}
    </div>
  );
}

function StreamCompare({ files }: { files: FileState[] }) {
  const t = useT();
  const streamsPer = files.map((f) => f.result?.data.streams ?? []);
  const count = Math.max(...streamsPer.map((s) => s.length), 0);
  return (
    <section className="compare-table-wrap">
      <h2>{t("ストリーム比較", "Stream comparison")}</h2>
      {Array.from({ length: count }).map((_, si) => {
        const rowMaps = streamsPer.map((streams) =>
          streams[si] ? Object.fromEntries(streamRows(streams[si], t)) : {}
        );
        const keys = Array.from(new Set(rowMaps.flatMap((m) => Object.keys(m))));
        const firstType = streamsPer.map((s) => s[si]?.codec_type).find(Boolean);
        return (
          <div key={si} className="card stream-compare-card">
            <div className="stream-head">
              <span className="stream-icon">
                <i className={`bi ${typeIconClass(firstType)}`} />
              </span>
              <span className="stream-type">
                #{si} {firstType ?? "—"}
              </span>
            </div>
            <div className="compare-scroll">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>{t("項目", "Item")}</th>
                    {files.map((_, i) => (
                      <th key={i}>{COMPARE_LABELS[i] ?? i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => {
                    const vals = rowMaps.map((m) => m[k] ?? "—");
                    return (
                      <tr key={k} className={new Set(vals).size > 1 ? "diff" : ""}>
                        <td className="kv-k">{k}</td>
                        {vals.map((v, i) => (
                          <td key={i}>{v}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function SlotPicker({ label, state, onRemove }: { label: string; state: FileState; onRemove: () => void }) {
  const t = useT();
  return (
    <div className="slot">
      <button className="slot-remove" onClick={onRemove} title={t("削除", "Remove")}>
        <i className="bi bi-x" />
      </button>
      <div className="slot-badge">{label}</div>
      <div className="slot-body">
        {state.loading ? (
          <span>
            <i className="bi bi-hourglass-split" /> {t("解析中…", "Analyzing…")}
          </span>
        ) : state.path ? (
          <span title={state.path}>{basename(state.path)}</span>
        ) : (
          <span className="muted">{t("クリックで選択 / ドロップ", "Click or drop")}</span>
        )}
        {state.error && <div className="slot-error">{state.error}</div>}
      </div>
    </div>
  );
}
