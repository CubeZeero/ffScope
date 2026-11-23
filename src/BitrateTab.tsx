import { useEffect, useRef, useState } from "react";
import { LruCache } from "./cache";
import { bitrateSeries, typeIconClass, type BitrateSeries, type Stream } from "./ffprobe";
import { BitrateChart } from "./BitrateChart";
import { BitrateStats } from "./BitrateStats";
import { FrameStatsPanel } from "./FrameStatsPanel";
import { GopDetail } from "./GopDetail";
import { TimestampCheck } from "./TimestampCheck";
import { ErrorBox } from "./ErrorBox";
import { useT } from "./i18n";

// Keep recent analysis across tab/mode changes, with bounded retention.
const seriesCache = new LruCache<string, BitrateSeries>(24);

export function BitrateTab({
  active,
  path,
  streams,
  duration,
}: {
  active: boolean;
  path: string;
  streams: Stream[];
  duration: number;
}) {
  const t = useT();
  const selectable = streams.filter((s) => s.codec_type === "video" || s.codec_type === "audio");
  const defaultIndex =
    selectable.find((s) => s.codec_type === "video")?.index ?? selectable[0]?.index ?? 0;
  const [streamIndex, setStreamIndex] = useState<number>(defaultIndex);
  const [series, setSeries] = useState<BitrateSeries | null>(
    () => seriesCache.get(`${path}#${defaultIndex}`) ?? null
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  async function load(idx: number) {
    const myReq = ++reqRef.current;
    setStreamIndex(idx);
    setError(null);
    const key = `${path}#${idx}`;
    const cached = seriesCache.get(key);
    if (cached) {
      setSeries(cached);
      setLoading(false);
      return;
    }
    setSeries(null);
    setLoading(true);
    try {
      const s = await bitrateSeries(path, idx);
      seriesCache.set(key, s);
      if (myReq === reqRef.current) setSeries(s);
    } catch (e) {
      if (myReq === reqRef.current) setError(String(e));
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }

  // タブが表示された時点で、選択中ストリームを自動解析（常時マウントのため active で判定）
  useEffect(() => {
    if (active && selectable.length && !series && !loading && !error) load(streamIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  if (!selectable.length) {
    return (
      <section className="bitrate-tab">
        <p className="hint">
          {t("ビットレートを解析できる映像/音声ストリームがありません。", "No video/audio stream to analyze.")}
        </p>
      </section>
    );
  }

  const isVideo = selectable.find((s) => s.index === streamIndex)?.codec_type === "video";

  return (
    <section className="bitrate-tab">
      <div className="stream-picker">
        {selectable.map((s) => (
          <button
            key={s.index}
            className={s.index === streamIndex ? "active" : ""}
            onClick={() => load(s.index)}
          >
            <i className={`bi ${typeIconClass(s.codec_type)}`} /> #{s.index} {s.codec_name}
          </button>
        ))}
      </div>

      {loading && (
        <div className="chart-loading">
          <span className="spinner" /> {t("パケットを解析中…", "Analyzing packets…")}
        </div>
      )}
      {error && <ErrorBox error={error} />}
      {!loading && series && <BitrateChart series={series} />}
      {!loading && series && <BitrateStats series={series} />}
      {!loading && series && isVideo && <GopDetail series={series} />}
      {!loading && series && isVideo && (
        <FrameStatsPanel key={`frames:${path}#${streamIndex}`} path={path} streamIndex={streamIndex} duration={duration} />
      )}
      {!loading && series && (
        <TimestampCheck key={`timestamps:${path}#${streamIndex}`} path={path} streamIndex={streamIndex} duration={duration} />
      )}
    </section>
  );
}
