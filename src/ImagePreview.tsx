import { useEffect, useState } from "react";
import { thumbnail } from "./ffprobe";

const cache = new Map<string, string>();

/** 静止画のプレビュー表示（ffmpeg で1フレーム＝画像そのものを取得）。 */
export function ImagePreview({ path }: { path: string }) {
  const [src, setSrc] = useState<string | null>(() => cache.get(path) ?? null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (cache.has(path)) {
      setSrc(cache.get(path)!);
      return;
    }
    let active = true;
    thumbnail(path, 0, 1280)
      .then((url) => {
        cache.set(path, url);
        if (active) setSrc(url);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [path]);

  if (error) return null;
  return (
    <section className="image-preview">
      {src ? (
        <img src={src} alt="preview" draggable={false} />
      ) : (
        <div className="thumb-placeholder">
          <span className="spinner" />
        </div>
      )}
    </section>
  );
}
