import { useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { humanDuration, saveFrame, thumbnail } from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

const COUNT = 12;

interface Cell {
  time: number;
  src: string | null;
}

export function ContactSheet({ path, duration }: { path: string; duration: number }) {
  const t = useT();
  const { notify } = useToast();
  const [cells, setCells] = useState<Cell[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(0);

  const reqRef = useRef(0);

  async function generate() {
    if (duration <= 0) return;
    setLoading(true);
    setDone(0);
    const my = ++reqRef.current;
    // ランダムな時刻を 12 個（昇順）
    const times = Array.from({ length: COUNT }, () => Math.random() * duration).sort((a, b) => a - b);
    setCells(times.map((tm) => ({ time: tm, src: null })));
    // 順次読み込みで進捗を 1 枚ずつ可視化
    for (let i = 0; i < times.length; i++) {
      if (my !== reqRef.current) return;
      try {
        const url = await thumbnail(path, times[i], 320);
        if (my === reqRef.current) {
          setCells((prev) => (prev ? prev.map((c, idx) => (idx === i ? { ...c, src: url } : c)) : prev));
        }
      } catch {
        /* 個別失敗は無視 */
      }
      if (my === reqRef.current) setDone(i + 1);
    }
    if (my === reqRef.current) setLoading(false);
  }

  async function saveCell(tm: number) {
    const target = await save({
      title: t("フレームを保存", "Save frame"),
      defaultPath: `frame_${tm.toFixed(2)}s.jpg`,
      filters: [{ name: "JPG", extensions: ["jpg"] }],
    });
    if (!target) return;
    try {
      await saveFrame(path, tm, target);
      notify(t("フレームを保存しました", "Frame saved"), "success");
    } catch (e) {
      notify(String(e), "error");
    }
  }

  return (
    <section className="contact-sheet">
      <h2>{t("コンタクトシート", "Contact sheet")}</h2>
      {!cells ? (
        <div className="panel-intro">
          <p className="hint">
            {t(
              "ランダムな時刻から 12 枚のサムネイルを生成します。",
              "Generate 12 thumbnails from random timestamps."
            )}
          </p>
          <button className="primary-btn" onClick={generate} disabled={duration <= 0}>
            {t("生成", "Generate")}
          </button>
        </div>
      ) : (
        <>
          {loading && (
            <div className="frame-progress">
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${Math.round((done / COUNT) * 100)}%` }} />
              </div>
              <span className="progress-label">
                {done}/{COUNT}
              </span>
            </div>
          )}
          <div className="cs-grid">
            {cells.map((c, i) => (
              <div
                className="cs-cell"
                key={i}
                onClick={() => saveCell(c.time)}
                title={t("クリックで保存", "Click to save")}
              >
                {c.src ? (
                  <img src={c.src} alt="" draggable={false} />
                ) : (
                  <div className="cs-ph">
                    <span className="spinner" />
                  </div>
                )}
                <span className="cs-time">{humanDuration(c.time)}</span>
              </div>
            ))}
          </div>
          {!loading && (
            <button className="icon-btn" onClick={generate}>
              <i className="bi bi-arrow-clockwise" /> {t("再生成", "Regenerate")}
            </button>
          )}
        </>
      )}
    </section>
  );
}
