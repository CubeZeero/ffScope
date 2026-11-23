import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { save } from "@tauri-apps/plugin-dialog";
import { humanDuration, saveFrame, thumbnail } from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";
import { runPool } from "./shared-task";

const COUNT = 12;
type SaveFormat = "jpg" | "png" | "tiff";

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
  const [viewer, setViewer] = useState<{ index: number | null } | null>(null);

  const reqRef = useRef(0);

  async function generate() {
    if (duration <= 0 || loading) return;
    setLoading(true);
    setDone(0);
    const my = ++reqRef.current;
    // ランダムな時刻を 12 個（昇順）
    const times = Array.from({ length: COUNT }, () => Math.random() * duration).sort((a, b) => a - b);
    setCells(times.map((tm) => ({ time: tm, src: null })));
    // Two decoders in parallel; preserve timestamp order and update per completed image.
    await runPool(times, 2, async (time, i) => {
      if (my !== reqRef.current) return;
      try {
        const url = await thumbnail(path, time, 320);
        if (my === reqRef.current) {
          setCells((prev) => (prev ? prev.map((c, idx) => (idx === i ? { ...c, src: url } : c)) : prev));
        }
      } catch {
        /* 個別失敗は無視 */
      }
      if (my === reqRef.current) setDone(completed => completed + 1);
    });
    if (my === reqRef.current) setLoading(false);
  }

  async function saveCell(tm: number, format: SaveFormat) {
    const target = await save({
      title: t("フレームを保存", "Save frame"),
      defaultPath: `frame_${tm.toFixed(2)}s.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: format === "tiff" ? ["tiff", "tif"] : format === "jpg" ? ["jpg", "jpeg"] : ["png"] }],
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
              <button type="button"
                className="cs-cell"
                key={i}
                disabled={!c.src}
                onClick={() => setViewer({ index: i })}
                title={t("クリックで拡大", "Click to enlarge")}
                aria-label={`${t("フレームを拡大", "Enlarge frame")} ${humanDuration(c.time)}`}
              >
                {c.src ? (
                  <img src={c.src} alt="" draggable={false} />
                ) : (
                  <div className="cs-ph">
                    <span className="spinner" />
                  </div>
                )}
                <span className="cs-time">{humanDuration(c.time)}</span>
              </button>
            ))}
          </div>
          <button type="button" className="icon-btn" disabled={!cells.some(c => c.src)} onClick={() => setViewer({ index: null })}>
            <i className="bi bi-arrows-fullscreen" /> {t("シートを拡大", "Enlarge sheet")}
          </button>
          {!loading && (
            <button className="icon-btn" onClick={generate}>
              <i className="bi bi-arrow-clockwise" /> {t("再生成", "Regenerate")}
            </button>
          )}
        </>
      )}
      {viewer && cells && <ContactSheetViewer path={path} cells={cells} initialIndex={viewer.index} generating={loading} done={done} onRegenerate={generate} onClose={() => setViewer(null)} onSave={saveCell} />}
    </section>
  );
}

function ContactSheetViewer({ path, cells, initialIndex, generating, done, onRegenerate, onClose, onSave }: {
  path: string; cells: Cell[]; initialIndex: number | null; onClose: () => void; onSave: (time: number, format: SaveFormat) => Promise<void>;
  generating: boolean; done: number; onRegenerate: () => Promise<void>;
}) {
  const t = useT();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(initialIndex);
  const [format, setFormat] = useState<SaveFormat>("jpg");
  const [image, setImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const selected = index === null ? null : cells[index];
  const time = selected?.time;

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => { dialog?.close(); };
  }, []);

  useEffect(() => {
    setImage(null);
    setError(false);
    if (time === undefined) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    thumbnail(path, time, 1920).then(url => { if (active) setImage(url); })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, time]);

  return createPortal(<dialog ref={dialogRef} className={`cs-viewer ${selected ? "cs-viewer-frame" : ""}`} aria-label={t("コンタクトシート拡大表示", "Contact sheet viewer")}
    onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) {
      const rect = e.currentTarget.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) onClose();
    } }}>
    <div className="modal-head">
      <h2>{t("コンタクトシート", "Contact sheet")}{selected && ` — ${humanDuration(selected.time)}`}</h2>
      <div className="cs-viewer-actions">
        {!selected && <button type="button" className="icon-btn" disabled={generating} onClick={onRegenerate}>
          <i className={`bi ${generating ? "bi-hourglass-split" : "bi-arrow-clockwise"}`} /> {generating ? t("生成中…", "Generating…") : t("再生成", "Regenerate")}
        </button>}
        {selected && <>
          <button type="button" className="icon-btn" onClick={() => setIndex(null)}>{t("一覧へ", "All frames")}</button>
          <select aria-label={t("保存形式", "Save format")} value={format} onChange={e => setFormat(e.target.value as SaveFormat)}>
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
            <option value="tiff">TIFF</option>
          </select>
          <button type="button" className="icon-btn" onClick={() => onSave(selected.time, format)}><i className="bi bi-download" /> {t("保存", "Save")}</button>
        </>}
        <button type="button" className="icon-btn" autoFocus onClick={onClose} aria-label={t("閉じる", "Close")}><i className="bi bi-x-lg" /></button>
      </div>
    </div>
    <div className="cs-viewer-body">
      {!selected && generating && <div className="frame-progress" role="progressbar" aria-label={t("コンタクトシート生成", "Contact sheet generation")} aria-valuemin={0} aria-valuemax={cells.length} aria-valuenow={done}>
        <div className="progress-track"><div className="progress-fill" style={{ width: `${Math.round(done / cells.length * 100)}%` }} /></div>
        <span className="progress-label">{done}/{cells.length}</span>
      </div>}
      {selected ? <>
        <div className="cs-viewer-image">
          <img src={image || selected.src || undefined} alt={humanDuration(selected.time)} draggable={false} />
          {loading && <span className="cs-viewer-loading"><span className="spinner" /> {t("高解像度画像を読み込み中…", "Loading high-resolution image…")}</span>}
        </div>
        {error && <p className="hint" role="status">{t("高解像度画像を取得できなかったため、サムネイルを表示しています。", "High-resolution preview unavailable; showing thumbnail.")}</p>}
        <div className="cs-viewer-nav">
          <button type="button" className="cs-nav-button" disabled={index === 0} onClick={() => setIndex(i => Math.max(0, (i ?? 0) - 1))}><i className="bi bi-chevron-left" aria-hidden="true" /> {t("前の画像", "Previous")}</button>
          <span className="cs-nav-count" aria-live="polite">{(index ?? 0) + 1}<span> / {cells.length}</span></span>
          <button type="button" className="cs-nav-button" disabled={index === cells.length - 1} onClick={() => setIndex(i => Math.min(cells.length - 1, (i ?? 0) + 1))}>{t("次の画像", "Next")} <i className="bi bi-chevron-right" aria-hidden="true" /></button>
        </div>
      </> : <div className="cs-grid cs-viewer-grid">{cells.map((cell, i) => <button type="button" key={i} className="cs-cell" disabled={!cell.src} onClick={() => setIndex(i)} aria-label={`${t("フレームを拡大", "Enlarge frame")} ${humanDuration(cell.time)}`}>
        {cell.src ? <img src={cell.src} alt="" draggable={false} /> : <div className="cs-ph">{generating ? <span className="spinner" /> : "…"}</div>}
        <span className="cs-time">{humanDuration(cell.time)}</span>
      </button>)}</div>}
    </div>
  </dialog>, document.body);
}
