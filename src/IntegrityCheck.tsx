import { useRef, useState } from "react";
import { integrityCheck, type Integrity } from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

const cache = new Map<string, Integrity>();

export function IntegrityCheck({ path, duration }: { path: string; duration: number }) {
  const t = useT();
  const { notify } = useToast();
  const [result, setResult] = useState<Integrity | null>(() => cache.get(path) ?? null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  async function run() {
    setError(null);
    setResult(null);
    setLoading(true);
    setProgress(0);
    const myReq = ++reqRef.current;
    try {
      const r = await integrityCheck(path, duration, (p) => {
        if (myReq === reqRef.current) setProgress(p);
      });
      cache.set(path, r);
      if (myReq === reqRef.current) {
        setResult(r);
        notify(
          r.ok
            ? t("整合性チェック: 問題なし", "Integrity: no problems")
            : t(`整合性チェック: ${r.error_count} 件のエラー`, `Integrity: ${r.error_count} errors`),
          r.ok ? "success" : "error"
        );
      }
    } catch (e) {
      if (myReq === reqRef.current) setError(String(e));
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }

  const pct = Math.round(Math.max(progress, 0) * 100);
  const indeterminate = progress < 0;

  return (
    <section className="integrity">
      <h2>{t("整合性チェック", "Integrity check")}</h2>

      {!result && !loading && (
        <div className="panel-intro">
          <p className="hint">
            {t(
              "ファイル全体をデコードして破損・デコードエラーを検出します（長いファイルは時間がかかります）。",
              "Decodes the whole file to detect corruption / decode errors (may take a while for long files)."
            )}
          </p>
          <button className="primary-btn" onClick={run}>
            {t("チェックを実行", "Run check")}
          </button>
        </div>
      )}

      {loading && (
        <div className="frame-progress">
          <div className="progress-track">
            <div
              className={`progress-fill ${indeterminate ? "indeterminate" : ""}`}
              style={indeterminate ? undefined : { width: `${pct}%` }}
            />
          </div>
          <span className="progress-label">
            {indeterminate ? t("チェック中…", "Checking…") : `${pct}%`}
          </span>
        </div>
      )}

      {error && (
        <section className="error-box">
          <strong>{t("エラー", "Error")}</strong>
          <pre>{error}</pre>
        </section>
      )}

      {result && !loading && (
        <>
          {result.ok ? (
            <div className="integ-badge integ-ok">
              <i className="bi bi-check-circle-fill" /> {t("問題は見つかりませんでした", "No problems found")}
            </div>
          ) : (
            <div className="integ-result">
              <div className="integ-badge integ-bad">
                <i className="bi bi-exclamation-octagon-fill" />{" "}
                {t(`${result.error_count} 件のエラー / 破損を検出`, `${result.error_count} errors detected`)}
              </div>
              <pre className="integ-errors">{result.errors.join("\n")}</pre>
            </div>
          )}
          <button className="icon-btn integ-rerun" onClick={run} title={t("再チェック", "Re-run")}>
            <i className="bi bi-arrow-clockwise" /> {t("再チェック", "Re-run")}
          </button>
        </>
      )}
    </section>
  );
}
