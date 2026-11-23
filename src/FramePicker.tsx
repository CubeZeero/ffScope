import { useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { humanDuration, saveFrame, thumbnail } from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

export function FramePicker({
  path,
  duration,
  defaultTime,
  fps,
}: {
  path: string;
  duration: number;
  defaultTime: number;
  fps: number;
}) {
  const t = useT();
  const { notify } = useToast();
  const [time, setTime] = useState(defaultTime);
  const frameDur = fps > 0 ? 1 / fps : 0;
  const clampTime = (v: number) => Math.max(0, duration > 0 ? Math.min(v, duration) : v);
  const stepFrame = (dir: number) => setTime((tm) => clampTime(tm + dir * frameDur));
  const [src, setSrc] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [fmt, setFmt] = useState<"jpg" | "png">("jpg");
  const [saving, setSaving] = useState(false);
  const reqRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const previewWork = useRef<Promise<void>>(Promise.resolve());

  // スライダー操作に追従してプレビューを更新（デバウンス）
  useEffect(() => {
    const myReq = ++reqRef.current;
    setPreviewLoading(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      // Keep one decoder active. Queued obsolete slider positions are skipped before spawning.
      previewWork.current = previewWork.current.then(async () => {
        if (myReq !== reqRef.current) return;
        await thumbnail(path, time, 640)
        .then((url) => {
          if (myReq === reqRef.current) setSrc(url);
        })
        .catch(() => {})
        .finally(() => {
          if (myReq === reqRef.current) setPreviewLoading(false);
        });
      });
    }, 80);
    return () => {
      clearTimeout(timerRef.current);
      ++reqRef.current;
    };
  }, [path, time]);

  async function doSave() {
    const target = await save({
      title: t("フレームを保存", "Save frame"),
      defaultPath: `frame_${time.toFixed(2)}s.${fmt}`,
      filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }],
    });
    if (!target) return;
    setSaving(true);
    try {
      await saveFrame(path, time, target);
      notify(t("フレームを保存しました", "Frame saved"), "success");
    } catch (e) {
      notify(String(e), "error");
    } finally {
      setSaving(false);
    }
  }

  const max = duration > 0 ? duration : 1;
  const step = Math.max(duration / 2000, 0.01);

  return (
    <section className="frame-picker">
      <div className="fp-preview">
        {src && <img src={src} alt="frame" draggable={false} />}
        {previewLoading && (
          <div className="fp-overlay">
            <span className="spinner" />
          </div>
        )}
        <span className="fp-time-badge">{humanDuration(time)}</span>
      </div>

      <input
        type="range"
        className="fp-slider"
        min={0}
        max={max}
        step={step}
        value={time}
        onChange={(e) => setTime(Number(e.target.value))}
      />

      <div className="fp-controls">
        {frameDur > 0 && (
          <span className="fp-step">
            <button className="icon-btn" onClick={() => stepFrame(-1)} title={t("前のフレーム", "Prev frame")}>
              <i className="bi bi-skip-start-fill" />
            </button>
            <button className="icon-btn" onClick={() => stepFrame(1)} title={t("次のフレーム", "Next frame")}>
              <i className="bi bi-skip-end-fill" />
            </button>
          </span>
        )}
        <span className="muted">{t("位置", "Position")}</span>
        <input
          type="number"
          className="fs-time"
          min={0}
          max={duration > 0 ? duration : undefined}
          step={0.1}
          value={Number(time.toFixed(2))}
          onChange={(e) => setTime(Number(e.target.value))}
        />
        <span className="muted">s</span>
        <select value={fmt} onChange={(e) => setFmt(e.target.value as "jpg" | "png")}>
          <option value="jpg">JPG</option>
          <option value="png">PNG</option>
        </select>
        <button className="primary-btn" onClick={doSave} disabled={saving}>
          <i className="bi bi-download" /> {saving ? t("保存中…", "Saving…") : t("このフレームを保存", "Save this frame")}
        </button>
      </div>
    </section>
  );
}
