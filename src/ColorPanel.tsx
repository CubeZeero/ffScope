import { useState } from "react";
import { colorRows, detectHdr } from "./color";
import { hdrMetadata, type Stream } from "./ffprobe";
import { useT } from "./i18n";

function HdrMetaButton({ path, index }: { path: string; index: number }) {
  const t = useT();
  const [rows, setRows] = useState<[string, string][] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await hdrMetadata(path, index);
      setRows(r);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  if (rows) {
    if (!rows.length) {
      return <p className="hint">{t("HDR 詳細メタデータは見つかりませんでした。", "No HDR metadata found.")}</p>;
    }
    return (
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
    );
  }

  return (
    <>
      <button className="preset-chip" onClick={load} disabled={loading}>
        {loading
          ? t("取得中…", "Loading…")
          : t("HDR 詳細メタデータを取得", "Load HDR metadata (MaxCLL/MaxFALL…)")}
      </button>
      {error && <p className="hint">{error}</p>}
    </>
  );
}

export function ColorPanel({ path, streams }: { path: string; streams: Stream[] }) {
  const t = useT();
  const videos = streams.filter((s) => s.codec_type === "video");
  const withColor = videos.filter(
    (v) => v.color_transfer || v.color_primaries || v.color_space || v.pix_fmt
  );
  if (!withColor.length) return null;

  return (
    <section className="color-panel">
      <h2>{t("カラー / HDR", "Color / HDR")}</h2>
      {withColor.map((v) => {
        const hdr = detectHdr(v);
        const rows = colorRows(v, t);
        const isHdr = hdr === "HDR10" || hdr === "HLG";
        return (
          <div key={v.index} className="card color-card">
            <div className="stream-head">
              <span className="stream-icon">
                <i className="bi bi-palette-fill" />
              </span>
              <span className="stream-type">
                #{v.index} {v.codec_name ?? ""}
              </span>
              <span className={`hdr-badge hdr-${hdr.toLowerCase()}`}>{hdr}</span>
            </div>
            <table className="kv">
              <tbody>
                {rows.map(([k, val]) => (
                  <tr key={k}>
                    <td className="kv-k">{k}</td>
                    <td className="kv-v">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {isHdr && (
              <div className="hdr-meta">
                <HdrMetaButton path={path} index={v.index} />
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
