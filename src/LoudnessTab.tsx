import { useEffect, useRef, useState } from "react";
import { loudness, spectrogram, waveform, type Loudness, type Stream } from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

// path#index → 測定結果 のキャッシュ（測定は重いので再実行を避ける）
const loudnessCache = new Map<string, Loudness>();
const waveformCache = new Map<string, string>();
const spectrogramCache = new Map<string, string>();

function num(s: string): number {
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

export function LoudnessTab({
  path,
  streams,
  ffmpegAvailable,
  duration,
}: {
  path: string;
  streams: Stream[];
  ffmpegAvailable: boolean;
  duration: number;
}) {
  const t = useT();
  const { notify } = useToast();
  const audio = streams.filter((s) => s.codec_type === "audio");
  const defaultIndex = audio[0]?.index ?? 0;
  const [streamIndex, setStreamIndex] = useState(defaultIndex);
  const [result, setResult] = useState<Loudness | null>(
    () => loudnessCache.get(`${path}#${defaultIndex}`) ?? null
  );
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const reqRef = useRef(0);

  async function measure(idx: number) {
    setStreamIndex(idx);
    setError(null);
    const key = `${path}#${idx}`;
    const cached = loudnessCache.get(key);
    if (cached) {
      setResult(cached);
      return;
    }
    setResult(null);
    setLoading(true);
    setProgress(0);
    const myReq = ++reqRef.current;
    try {
      const r = await loudness(path, idx, duration, (p) => {
        if (myReq === reqRef.current) setProgress(p);
      });
      loudnessCache.set(key, r);
      if (myReq === reqRef.current) {
        setResult(r);
        notify(t("ラウドネス測定が完了しました", "Loudness measurement complete"), "success");
      }
    } catch (e) {
      if (myReq === reqRef.current) setError(String(e));
    } finally {
      if (myReq === reqRef.current) setLoading(false);
    }
  }

  if (!ffmpegAvailable) {
    return (
      <section className="loudness-tab">
        <p className="hint">
          {t(
            "ラウドネス測定には ffmpeg が必要です（未検出）。",
            "Loudness measurement requires ffmpeg (not found)."
          )}
        </p>
      </section>
    );
  }
  if (!audio.length) {
    return (
      <section className="loudness-tab">
        <p className="hint">{t("音声ストリームがありません。", "No audio stream.")}</p>
      </section>
    );
  }

  const integrated = result ? num(result.input_i) : NaN;

  return (
    <section className="loudness-tab">
      <div className="stream-picker">
        {audio.map((s) => (
          <button
            key={s.index}
            className={s.index === streamIndex ? "active" : ""}
            onClick={() => measure(s.index)}
          >
            <i className="bi bi-music-note-beamed" /> #{s.index} {s.codec_name}
          </button>
        ))}
      </div>

      {!result && !loading && !error && (
        <button className="primary-btn" onClick={() => measure(streamIndex)}>
          {t("ラウドネスを測定", "Measure loudness")}
        </button>
      )}

      {loading && (
        <div className="frame-progress">
          <div className="progress-track">
            <div
              className={`progress-fill ${progress < 0 ? "indeterminate" : ""}`}
              style={progress < 0 ? undefined : { width: `${Math.round(Math.max(progress, 0) * 100)}%` }}
            />
          </div>
          <span className="progress-label">
            {progress < 0
              ? t("測定中…", "Measuring…")
              : `${Math.round(Math.max(progress, 0) * 100)}%`}
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
          <div className="summary">
            <Metric label={t("統合ラウドネス", "Integrated")} value={`${result.input_i} LUFS`} big />
            <Metric label={t("トゥルーピーク", "True Peak")} value={`${result.input_tp} dBTP`} />
            <Metric label={t("ラウドネスレンジ", "Loudness Range")} value={`${result.input_lra} LU`} />
            <Metric label={t("しきい値", "Threshold")} value={`${result.input_thresh} LUFS`} />
          </div>

          {!isNaN(integrated) && (
            <div className="loudness-targets">
              <TargetRow label={t("放送 (EBU R128)", "Broadcast (EBU R128)")} target={-23} value={integrated} t={t} />
              <TargetRow label={t("配信 (YouTube/Spotify)", "Streaming (YouTube/Spotify)")} target={-14} value={integrated} t={t} />
            </div>
          )}
        </>
      )}

      <Waveform path={path} streamIndex={streamIndex} />
      <Spectrogram path={path} streamIndex={streamIndex} />
    </section>
  );
}

function Metric({ label, value, big }: { label: string; value: string; big?: boolean }) {
  return (
    <div className={`card summary-card ${big ? "metric-big" : ""}`}>
      <div className="card-label">{label}</div>
      <div className="card-value">{value}</div>
    </div>
  );
}

function TargetRow({
  label,
  target,
  value,
  t,
}: {
  label: string;
  target: number;
  value: number;
  t: (ja: string, en: string) => string;
}) {
  const delta = value - target;
  const within = Math.abs(delta) <= 1;
  const sign = delta >= 0 ? "+" : "";
  return (
    <div className={`target-row ${within ? "ok" : "off"}`}>
      <span className="target-label">{label}</span>
      <span className="target-value">
        {target} LUFS → {sign}
        {delta.toFixed(1)} LU{" "}
        {within ? t("（基準内）", "(within target)") : t("（要調整）", "(needs adjustment)")}
      </span>
    </div>
  );
}

function Waveform({ path, streamIndex }: { path: string; streamIndex: number }) {
  const t = useT();
  const key = `${path}#${streamIndex}`;
  const [src, setSrc] = useState<string | null>(() => waveformCache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ストリーム切替でリセット（キャッシュがあれば復元）
  useEffect(() => {
    setSrc(waveformCache.get(key) ?? null);
    setError(null);
  }, [key]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const url = await waveform(path, streamIndex);
      waveformCache.set(key, url);
      setSrc(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="waveform">
      <h3>{t("波形", "Waveform")}</h3>
      {src ? (
        <img src={src} alt="waveform" draggable={false} className="waveform-img" />
      ) : loading ? (
        <div className="chart-loading">
          <span className="spinner" /> {t("波形を生成中…", "Generating waveform…")}
        </div>
      ) : (
        <button className="preset-chip" onClick={load}>
          {t("波形を表示", "Show waveform")}
        </button>
      )}
      {error && <p className="hint">{error}</p>}
    </div>
  );
}

function Spectrogram({ path, streamIndex }: { path: string; streamIndex: number }) {
  const t = useT();
  const key = `${path}#${streamIndex}`;
  const [src, setSrc] = useState<string | null>(() => spectrogramCache.get(key) ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSrc(spectrogramCache.get(key) ?? null);
    setError(null);
  }, [key]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const url = await spectrogram(path, streamIndex);
      spectrogramCache.set(key, url);
      setSrc(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="waveform">
      <h3>{t("スペクトログラム", "Spectrogram")}</h3>
      {src ? (
        <img src={src} alt="spectrogram" draggable={false} className="waveform-img" />
      ) : loading ? (
        <div className="chart-loading">
          <span className="spinner" /> {t("生成中…", "Generating…")}
        </div>
      ) : (
        <button className="preset-chip" onClick={load}>
          {t("スペクトログラムを表示", "Show spectrogram")}
        </button>
      )}
      {error && <p className="hint">{error}</p>}
    </div>
  );
}
