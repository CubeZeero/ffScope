import { ProgressBar } from "./ProgressBar";
import { useRef, useState } from "react";
import { timestampCheck, humanDuration, type TsResult } from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

export function TimestampCheck({
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
  const [result, setResult] = useState<TsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const reqRef = useRef(0);

  async function run() {
    setLoading(true);
    setProgress(0);
    setResult(null);
    const my = ++reqRef.current;
    try {
      const r = await timestampCheck(path, streamIndex, duration, (p) => {
        if (my === reqRef.current) setProgress(p);
      });
      if (my === reqRef.current) {
        setResult(r);
        notify(
          r.issues.length === 0
            ? t("タイムスタンプ: 問題なし", "Timestamps: OK")
            : t(`タイムスタンプ: ${r.issues.length} 件`, `Timestamps: ${r.issues.length} issues`),
          r.issues.length === 0 ? "success" : "error"
        );
      }
    } catch (e) {
      if (my === reqRef.current) notify(String(e), "error");
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }


  return (
    <section className="ts-check">
      <h3>{t("タイムスタンプ不連続チェック", "Timestamp discontinuity check")}</h3>
      <p className="hint">{t(
        "DTSの巻き戻りと、表示順・パケットの継続時間を考慮した大きな空白を確認します。BフレームによるPTSの前後や先頭の負のDTSは異常扱いしません。継続時間が不明な区間は空白を判定できません。",
        "Checks DTS reversals and large uncovered gaps in presentation order using packet durations. B-frame PTS reordering and negative initial DTS are normal. Gaps cannot be assessed where durations are unknown."
      )}</p>
      {!result && !loading && (
        <button className="primary-btn" onClick={run}>
          {t("チェックを実行", "Run check")}
        </button>
      )}
      {loading && <ProgressBar progress={progress} label={t("チェック中…", "Checking…")} />}
      {result && !loading && (
        <>
          {result.issues.length === 0 ? (
            <div className="integ-badge integ-ok">
              <i className="bi bi-check-circle-fill" />{" "}
              {t(`問題なし（${result.checked} パケット確認）`, `No issues (${result.checked} packets)`)}
            </div>
          ) : (
            <>
              <div className="integ-badge integ-bad">
                <i className="bi bi-exclamation-octagon-fill" />{" "}
                {t(`${result.issues.length} 件の不連続を検出`, `${result.issues.length} discontinuities`)}
              </div>
              <div className="ts-table-wrap">
                <table className="kv ts-table">
                  <thead>
                    <tr>
                      <th>{t("時刻", "Time")}</th>
                      <th>{t("種別", "Type")}</th>
                      <th>{t("詳細", "Detail")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.issues.map((it, i) => (
                      <tr key={i}>
                        <td>{humanDuration(it.time)}</td>
                        <td className="ts-kind">{it.kind}</td>
                        <td>{it.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.issues.length >= 200 && <p className="hint">{t("結果の表示は最大200件です。", "Results are limited to 200 issues.")}</p>}
            </>
          )}
          <button className="icon-btn ts-rerun" onClick={run}>
            <i className="bi bi-arrow-clockwise" /> {t("再チェック", "Re-run")}
          </button>
        </>
      )}
    </section>
  );
}
