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

  const pct = Math.round(Math.max(progress, 0) * 100);
  const indet = progress < 0;

  return (
    <section className="ts-check">
      <h3>{t("タイムスタンプ不連続チェック", "Timestamp discontinuity check")}</h3>
      {!result && !loading && (
        <button className="primary-btn" onClick={run}>
          {t("チェックを実行", "Run check")}
        </button>
      )}
      {loading && (
        <div className="frame-progress">
          <div className="progress-track">
            <div
              className={`progress-fill ${indet ? "indeterminate" : ""}`}
              style={indet ? undefined : { width: `${pct}%` }}
            />
          </div>
          <span className="progress-label">{indet ? t("チェック中…", "Checking…") : `${pct}%`}</span>
        </div>
      )}
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
