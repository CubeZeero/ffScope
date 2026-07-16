import { useRef, useState } from "react";
import { fileHash, type FileHash } from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

const cache = new Map<string, FileHash>();

export function FileHashPanel({ path }: { path: string }) {
  const t = useT();
  const { notify } = useToast();
  const [hash, setHash] = useState<FileHash | null>(() => cache.get(path) ?? null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  async function run() {
    setError(null);
    setLoading(true);
    setProgress(0);
    const my = ++reqRef.current;
    try {
      const h = await fileHash(path, (p) => {
        if (my === reqRef.current) setProgress(p);
      });
      cache.set(path, h);
      if (my === reqRef.current) {
        setHash(h);
        notify(t("ハッシュを計算しました", "Hash computed"), "success");
      }
    } catch (e) {
      if (my === reqRef.current) setError(String(e));
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }

  const pct = Math.round(Math.max(progress, 0) * 100);
  const indet = progress < 0;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      notify(t("コピーしました", "Copied"), "success");
    } catch {
      /* ignore */
    }
  }

  return (
    <section className="hash-panel">
      <h2>{t("ファイルハッシュ", "File hash")}</h2>
      {!hash && !loading && (
        <button className="primary-btn" onClick={run}>
          {t("MD5 / SHA-256 を計算", "Compute MD5 / SHA-256")}
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
          <span className="progress-label">{indet ? t("計算中…", "Hashing…") : `${pct}%`}</span>
        </div>
      )}
      {error && <p className="hint">{error}</p>}
      {hash && (
        <table className="kv">
          <tbody>
            <tr>
              <td className="kv-k">MD5</td>
              <td className="kv-v hash-val" onClick={() => copy(hash.md5)} title={t("クリックでコピー", "Click to copy")}>
                {hash.md5}
              </td>
            </tr>
            <tr>
              <td className="kv-k">SHA-256</td>
              <td className="kv-v hash-val" onClick={() => copy(hash.sha256)} title={t("クリックでコピー", "Click to copy")}>
                {hash.sha256}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}
