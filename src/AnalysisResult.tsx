import { analysisNeedsReview, type AnalysisRecord, type Metric } from "./analysis-store";
import { analysisLabels } from "./analysis-labels";
import { useLang, useT } from "./i18n";

const metrics: Record<string, [string, string, string?]> = {
  error_count: ["デコードエラー数", "Decode errors"], checked: ["確認したパケット数", "Packets checked"], issues: ["タイムスタンプの指摘件数", "Timestamp issues"],
  avg: ["平均ビットレート", "Average bitrate", "bitrate"], peak: ["最大ビットレート", "Peak bitrate", "bitrate"], packet_count: ["集計したパケット数", "Packets analyzed"], keyframe_count: ["キーフレーム数", "Keyframes"],
  avg_gop_sec: ["平均GOP間隔", "Average GOP interval", "s"], gop_min_sec: ["最短GOP間隔", "Shortest GOP interval", "s"], gop_max_sec: ["最長GOP間隔", "Longest GOP interval", "s"],
  i: ["Iフレーム", "I-frames", "frames"], p: ["Pフレーム", "P-frames", "frames"], b: ["Bフレーム", "B-frames", "frames"], total: ["総フレーム数", "Total frames"],
  input_i: ["統合ラウドネス", "Integrated loudness", "LUFS"], input_tp: ["最大True Peak", "Maximum true peak", "dBTP"], input_lra: ["ラウドネスレンジ", "Loudness range", "LU"], input_thresh: ["測定しきい値", "Measurement threshold", "LUFS"],
  black_count: ["黒フレーム区間数", "Black intervals"], black_seconds: ["黒フレームの合計時間", "Total black duration", "s"], silence_count: ["無音区間数", "Silent intervals"], silence_seconds: ["無音の合計時間", "Total silence duration", "s"],
  frames: ["走査したフレーム数", "Frames scanned"], candidates: ["視覚的異常の候補数", "Visual anomaly candidates"], sensitivity: ["検出感度", "Sensitivity", "%"],
  pass: ["指定条件に適合", "Passed criteria"], fail: ["指定条件に不適合", "Failed criteria"], unknown: ["未測定・未確認", "Unmeasured/unknown"], skip: ["判定対象外", "Not specified"],
};

export function AnalysisResult({ record }: { record: AnalysisRecord }) {
  const t = useT();
  const lang = useLang();
  const number = (value: number, digits = 0) => value.toLocaleString(lang === "ja" ? "ja-JP" : "en-US", { maximumFractionDigits: digits });
  function format(key: string, value: Metric): string {
    const unit = metrics[key]?.[2];
    if ((key === "input_i" && record.summary.silent) || (key === "input_tp" && record.summary.true_peak_negative_infinity)) return `−∞ ${unit}`;
    if (typeof value !== "number" || !Number.isFinite(value)) return t("測定値なし", "Not available");
    if (unit === "bitrate") return value >= 1_000_000 ? `${number(value / 1_000_000, 2)} Mb/s` : `${number(value / 1000, 1)} kb/s`;
    if (unit === "%") return `${number(value * 100, 1)}%`;
    if (unit === "frames") {
      const total = Number(record.summary.total);
      return `${number(value)}${total > 0 ? ` (${number(value / total * 100, 1)}%)` : ""}`;
    }
    return `${number(value, unit ? 2 : 0)}${unit ? ` ${unit}` : ""}`;
  }
  const complete = record.status === "complete";
  const review = analysisNeedsReview(record);
  const badge = record.status === "running" ? t("実行中", "Running") : record.status === "error" ? t("実行失敗", "Failed") : review ? t("要確認", "Review needed") : t("測定完了", "Measured");
  const message = !complete ? record.status === "error" ? t("処理が失敗したため、正常・異常は判定できません。", "The analysis failed; no health verdict is available.") : t("結果を待っています。", "Waiting for results.")
    : record.kind === "integrity" ? record.summary.ok ? t("今回のデコードでエラーは検出されませんでした。", "No decode errors were detected in this run.") : t("デコード中にエラーを検出しました。検査タブで詳しく確認してください。", "Decode errors detected. Review the Inspect tab.")
    : record.kind === "timestamps" ? review ? t("タイムスタンプに指摘があります。ビットレートタブで時刻・種別を確認してください。", "Timestamp issues found. Review times and types in the Bitrate tab.") : t("今回の判定ではタイムスタンプの指摘はありません。", "No timestamp issues were flagged in this run.")
    : record.kind === "anomaly" ? t("あくまで異常候補です。フラッシュなど意図的な演出も含むため、画像での確認が必要です。", "These are candidates, not proven defects. Review images to rule out intentional flashes and effects.")
    : record.kind === "blackSilence" ? t("黒画面や無音は正常な演出の場合もあります。意図しない区間か確認してください。", "Black and silent intervals may be intentional. Review whether they are expected.")
    : record.kind === "delivery" ? t("指定した条件だけの判定です。未確認項目がある場合は納品適合を確定できません。", "Only your specified criteria are checked. Unknown items prevent a complete compliance verdict.")
    : record.kind === "loudness" ? t("音量の測定値です。指定LUFS・True Peakへの適合は納品仕様タブで確認できます。", "These are measured audio levels. Check target LUFS and True Peak in Delivery.")
    : t("測定値を以下にまとめました。測定完了は納品条件への適合を意味しません。", "Measurements are listed below. Completion does not imply delivery compliance.");
  const date = new Date(record.updatedAt);
  return <details className="qc-record"><summary><span className="qc-record-name">{t(...analysisLabels[record.kind])}{record.streamIndex !== null && <span className="qc-stream"> #{record.streamIndex}</span>}</span><span className={`qc-badge ${record.status === "error" ? "qc-error" : review ? "qc-unknown" : ""}`}>{badge}</span></summary>
    <div className="qc-record-body"><p className="hint">{message}</p>
      {complete && <dl className="qc-metrics">{Object.entries(record.summary).filter(([key]) => key in metrics).map(([key, value]) => <div key={key}><dt>{t(metrics[key][0], metrics[key][1])}</dt><dd>{format(key, value)}</dd></div>)}</dl>}
      {record.kind === "timestamps" && Number(record.summary.issues) >= Number(record.summary.display_limit) && <p className="hint">{t("指摘件数は表示上限までの件数です。実際にはさらに存在する可能性があります。", "Issue count is capped; additional issues may exist.")}</p>}
      {record.summary.truncated === true && <p className="qc-unknown">{t("候補数は保存上限に達しています。さらに候補がある可能性があります。", "Candidate storage limit reached; more candidates may exist.")}</p>}
      {!!record.points?.length && <><h4>{t("異常候補の抜粋（先頭12件まで）", "Candidate sample (first 12)")}</h4><div className="qc-table-wrap"><table className="qc-table"><thead><tr><th>{t("フレーム番号", "Frame")}</th><th>{t("時刻", "Time")}</th><th>{t("差異スコア", "Difference score")}</th></tr></thead><tbody>{record.points.map((point, i) => <tr key={i}><td>#{number(point.frame)}</td><td>{number(point.time, 3)} s</td><td>{number(point.score * 100, 1)}</td></tr>)}</tbody></table></div></>}
      {Number.isFinite(date.getTime()) && <p className="qc-measured-at">{t("更新日時", "Updated")}: <time dateTime={record.updatedAt}>{date.toLocaleString(lang === "ja" ? "ja-JP" : "en-US")}</time></p>}
    </div>
  </details>;
}
