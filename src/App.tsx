import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import {
  basename,
  buildProbeCommand,
  checkFfmpeg,
  checkFfprobe,
  formatUnixTimestamp,
  humanBitrate,
  humanBytes,
  humanDuration,
  isStillImage,
  isUnixTimestamp,
  probeFile,
  bitrateSeries,
  setToolPaths,
  streamRows,
  typeIconClass,
  type BitrateSeries,
  type Chapter,
  type FfprobeData,
  type ProbeResult,
  type Stream,
} from "./ffprobe";
import { BitrateChart } from "./BitrateChart";
import { Logo } from "./Logo";
import { ColorPanel } from "./ColorPanel";
import { LoudnessTab } from "./LoudnessTab";
import { FrameStatsPanel } from "./FrameStatsPanel";
import { GopDetail } from "./GopDetail";
import { BatchView, type BatchItem } from "./BatchView";
import { SettingsModal, type Settings } from "./SettingsModal";
import { AboutModal } from "./AboutModal";
import { CommandRunner } from "./CommandRunner";
import { FramePicker } from "./FramePicker";
import { ContactSheet } from "./ContactSheet";
import { IntegrityCheck } from "./IntegrityCheck";
import { DetectPanel } from "./DetectPanel";
import { BitrateStats } from "./BitrateStats";
import { TimestampCheck } from "./TimestampCheck";
import { FileHashPanel } from "./FileHashPanel";
import { CompareExtras } from "./CompareExtras";
import { ImagePreview } from "./ImagePreview";
import { buildHtmlReport, buildPdf } from "./report";
import { saveBinary } from "./ffprobe";
import { ToastProvider } from "./toast";
import { detectWarnings } from "./warnings";
import { LangContext, makeT, useT } from "./i18n";
import "./App.css";

type Mode = "single" | "compare" | "batch" | "tools";
type Tab = "info" | "preview" | "bitrate" | "loudness" | "inspect" | "raw";
type Theme = "dark" | "light";

interface FileState {
  path: string;
  result: ProbeResult | null;
  error: string | null;
  loading: boolean;
}

const EMPTY: FileState = { path: "", result: null, error: null, loading: false };

// 解析結果のメモリキャッシュ。タブ/モード切替での再解析を防ぐ。
const seriesCache = new Map<string, BitrateSeries>();

// ---- 設定 / 履歴の永続化 ----
const DEFAULT_SETTINGS: Settings = { lang: "ja", thumbPercent: 10, ffprobePath: "", ffmpegPath: "" };

function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem("ffscope-settings") || "{}") };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem("ffscope-recent") || "[]");
  } catch {
    return [];
  }
}

function App() {
  const [mode, setMode] = useState<Mode>("single");
  const [ffprobePath, setFfprobePath] = useState<string | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(false);
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("ffscope-theme") as Theme) || "dark"
  );
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const t = makeT(settings.lang);

  // テーマを <html data-theme> に反映して永続化
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("ffscope-theme", theme);
  }, [theme]);

  // 起動時：ツールパス上書きを反映してから検出
  useEffect(() => {
    (async () => {
      await setToolPaths(settings.ffprobePath, settings.ffmpegPath).catch(() => {});
      checkFfprobe().then(setFfprobePath).catch(() => {});
      checkFfmpeg().then((p) => setFfmpegAvailable(!!p)).catch(() => {});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 単体解析
  const [single, setSingle] = useState<FileState>(EMPTY);
  const [tab, setTab] = useState<Tab>("info");

  // 比較（N ファイル）
  const [compareFiles, setCompareFiles] = useState<FileState[]>([]);
  const compareRef = useRef(compareFiles);
  compareRef.current = compareFiles;

  // バッチ
  const [batchFiles, setBatchFiles] = useState<BatchItem[]>([]);
  const batchRef = useRef(batchFiles);
  batchRef.current = batchFiles;

  const [dragOver, setDragOver] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  async function addComparePaths(paths: string[]) {
    const news = paths.filter((p) => !compareRef.current.some((f) => f.path === p));
    if (!news.length) return;
    setCompareFiles((prev) => [
      ...prev,
      ...news.map((p) => ({ path: p, result: null, error: null, loading: true })),
    ]);
    for (const p of news) {
      try {
        const res = await probeFile(p);
        addRecent(p);
        setFfprobePath(res.ffprobe_path);
        setCompareFiles((prev) => prev.map((f) => (f.path === p ? { ...f, result: res, loading: false } : f)));
      } catch (e) {
        setCompareFiles((prev) =>
          prev.map((f) => (f.path === p ? { ...f, error: String(e), loading: false } : f))
        );
      }
    }
  }

  async function pickCompare() {
    const selected = await open({ multiple: true, directory: false });
    if (Array.isArray(selected)) addComparePaths(selected);
    else if (typeof selected === "string") addComparePaths([selected]);
  }

  function addRecent(path: string) {
    setRecent((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)].slice(0, 10);
      localStorage.setItem("ffscope-recent", JSON.stringify(next));
      return next;
    });
  }

  // 共通の解析処理
  async function analyze(path: string, set: (f: FileState) => void) {
    set({ path, result: null, error: null, loading: true });
    try {
      const res = await probeFile(path);
      set({ path, result: res, error: null, loading: false });
      setFfprobePath(res.ffprobe_path);
      addRecent(path);
    } catch (e) {
      set({ path, result: null, error: String(e), loading: false });
    }
  }

  async function addBatchPaths(paths: string[]) {
    const news = paths.filter((p) => !batchRef.current.some((f) => f.path === p));
    if (!news.length) return;
    setBatchFiles((prev) => [
      ...prev,
      ...news.map((p) => ({ path: p, result: null, error: null, loading: true })),
    ]);
    for (const p of news) {
      try {
        const res = await probeFile(p);
        // バッチで開いたファイルは「最近開いたファイル」に含めない
        setBatchFiles((prev) => prev.map((f) => (f.path === p ? { ...f, result: res, loading: false } : f)));
      } catch (e) {
        setBatchFiles((prev) =>
          prev.map((f) => (f.path === p ? { ...f, error: String(e), loading: false } : f))
        );
      }
    }
  }

  function handleDroppedPaths(paths: string[]) {
    if (!paths.length) return;
    if (modeRef.current === "single") {
      setTab("info");
      analyze(paths[0], setSingle);
    } else if (modeRef.current === "compare") {
      addComparePaths(paths);
    } else if (modeRef.current === "batch") {
      addBatchPaths(paths);
    }
    // tools モードはドロップ対象なし
  }

  // Tauri ネイティブのドラッグ&ドロップ
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "over") setDragOver(true);
      else if (p.type === "drop") {
        setDragOver(false);
        if (p.paths?.length) handleDroppedPaths(p.paths);
      } else setDragOver(false);
    });
    return () => {
      unlisten.then((un) => un());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pickInto(set: (f: FileState) => void) {
    const selected = await open({ multiple: false, directory: false });
    if (typeof selected === "string") analyze(selected, set);
  }

  async function pickBatch() {
    const selected = await open({ multiple: true, directory: false });
    if (Array.isArray(selected)) addBatchPaths(selected);
    else if (typeof selected === "string") addBatchPaths([selected]);
  }

  // メニューバーからの操作を購読
  useEffect(() => {
    const unlisteners = [
      listen("menu:open", () => {
        if (modeRef.current === "single") pickInto(setSingle);
        else if (modeRef.current === "compare") pickCompare();
        else if (modeRef.current === "batch") pickBatch();
      }),
      listen("menu:toggle-theme", () => setTheme((th) => (th === "dark" ? "light" : "dark"))),
    ];
    return () => {
      unlisteners.forEach((u) => u.then((un) => un()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSettings(s: Settings) {
    setSettings(s);
    localStorage.setItem("ffscope-settings", JSON.stringify(s));
    setShowSettings(false);
    await setToolPaths(s.ffprobePath, s.ffmpegPath).catch(() => {});
    checkFfprobe().then(setFfprobePath).catch(() => {});
    checkFfmpeg().then((p) => setFfmpegAvailable(!!p)).catch(() => {});
  }

  return (
    <LangContext.Provider value={settings.lang}>
      <ToastProvider>
      <main className="app">
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark">
              <Logo className="brand-logo" />
            </span>
            <div>
              <h1>ffScope</h1>
            </div>
          </div>
          <div className="topbar-right">
            <div className="mode-switch">
              <button className={mode === "single" ? "active" : ""} onClick={() => setMode("single")}>
                {t("解析", "Analyze")}
              </button>
              <button className={mode === "compare" ? "active" : ""} onClick={() => setMode("compare")}>
                {t("比較", "Compare")}
              </button>
              <button className={mode === "batch" ? "active" : ""} onClick={() => setMode("batch")}>
                {t("バッチ", "Batch")}
              </button>
              <button className={mode === "tools" ? "active" : ""} onClick={() => setMode("tools")}>
                {t("コマンド", "Command")}
              </button>
            </div>
            <div className={`ffprobe-status ${ffprobePath ? "ok" : "ng"}`}>
              {ffprobePath ? (
                <span title={ffprobePath}>● ffprobe</span>
              ) : (
                <span>● {t("ffprobe 未検出", "ffprobe not found")}</span>
              )}
            </div>
            <button
              className="theme-toggle"
              title={theme === "dark" ? t("ライトテーマに切替", "Switch to light") : t("ダークテーマに切替", "Switch to dark")}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <i className={`bi ${theme === "dark" ? "bi-moon-stars-fill" : "bi-sun-fill"}`} />
            </button>
            <button className="theme-toggle" title={t("設定", "Settings")} onClick={() => setShowSettings(true)}>
              <i className="bi bi-gear-fill" />
            </button>
            <button className="theme-toggle" title={t("ffScope について", "About ffScope")} onClick={() => setShowAbout(true)}>
              <i className="bi bi-info-circle" />
            </button>
          </div>
        </header>

        {/* 各ビューを常時マウントし表示だけ切替 → 切替時の再解析を防ぐ */}
        <div style={{ display: mode === "single" ? "block" : "none" }}>
          <SingleView
            state={single}
            tab={tab}
            setTab={setTab}
            dragOver={dragOver}
            ffmpegAvailable={ffmpegAvailable}
            thumbPercent={settings.thumbPercent}
            recent={recent}
            onPick={() => {
              setTab("info");
              pickInto(setSingle);
            }}
            onPickRecent={(p) => {
              setTab("info");
              analyze(p, setSingle);
            }}
          />
        </div>
        <div style={{ display: mode === "compare" ? "block" : "none" }}>
          <CompareView
            files={compareFiles}
            onAdd={pickCompare}
            onRemove={(p) => setCompareFiles((prev) => prev.filter((f) => f.path !== p))}
          />
        </div>
        <div style={{ display: mode === "batch" ? "block" : "none" }}>
          <BatchView
            files={batchFiles}
            onAdd={pickBatch}
            onClear={() => setBatchFiles([])}
            onRemove={(p) => setBatchFiles((prev) => prev.filter((f) => f.path !== p))}
          />
        </div>
        <div style={{ display: mode === "tools" ? "block" : "none" }}>
          <CommandRunner initialPath={single.path || undefined} />
        </div>

        {showSettings && (
          <SettingsModal
            settings={settings}
            theme={theme}
            onChangeTheme={setTheme}
            onSave={saveSettings}
            onClose={() => setShowSettings(false)}
          />
        )}
        {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      </main>
      </ToastProvider>
    </LangContext.Provider>
  );
}

// ===================== 単体解析ビュー =====================
function SingleView({
  state,
  tab,
  setTab,
  dragOver,
  ffmpegAvailable,
  thumbPercent,
  recent,
  onPick,
  onPickRecent,
}: {
  state: FileState;
  tab: Tab;
  setTab: (t: Tab) => void;
  dragOver: boolean;
  ffmpegAvailable: boolean;
  thumbPercent: number;
  recent: string[];
  onPick: () => void;
  onPickRecent: (path: string) => void;
}) {
  const t = useT();
  const { path, result, error, loading } = state;
  const format = result?.data.format;
  const streams = result?.data.streams ?? [];
  const chapters = result?.data.chapters ?? [];
  const hasVideo = streams.some((s) => s.codec_type === "video");
  const isStill = result ? isStillImage(result.data) : false;

  return (
    <>
      <section className={`dropzone ${dragOver ? "dragover" : ""}`} onClick={onPick}>
        <div className="dropzone-inner">
          <span className="dz-icon">
            <i className={`bi ${loading ? "bi-hourglass-split" : "bi-folder2-open"}`} />
          </span>
          <p className="dz-title">
            {loading ? t("解析中…", "Analyzing…") : path ? basename(path) : t("ファイルをドラッグ&ドロップ", "Drag & drop a file")}
          </p>
          <p className="dz-hint">{path && !loading ? path : t("またはクリックして選択", "or click to select")}</p>
        </div>
      </section>

      {recent.length > 0 && (
        <div className="recent">
          <span className="recent-label">{t("最近開いたファイル", "Recent")}:</span>
          {recent.slice(0, 6).map((p) => (
            <button key={p} className="recent-chip" title={p} onClick={() => onPickRecent(p)}>
              <i className="bi bi-clock-history" /> {basename(p)}
            </button>
          ))}
        </div>
      )}

      {error && <ErrorBox error={error} />}

      {format && !loading && (
        // key={path} で新ファイル時のみパネルを作り直し、タブ切替では作り直さない
        // （＝別タブへ移っても進捗バー付きの処理が途切れず動き続ける）
        <div key={path}>
          <CommandBar path={path} data={result!.data} />

          <div className="tabs">
            <button className={tab === "info" ? "active" : ""} onClick={() => setTab("info")}>
              {t("情報", "Info")}
            </button>
            {!isStill && ffmpegAvailable && hasVideo && (
              <button className={tab === "preview" ? "active" : ""} onClick={() => setTab("preview")}>
                {t("プレビュー", "Preview")}
              </button>
            )}
            {!isStill && (
              <button className={tab === "bitrate" ? "active" : ""} onClick={() => setTab("bitrate")}>
                {t("ビットレート", "Bitrate")}
              </button>
            )}
            {!isStill && (
              <button className={tab === "loudness" ? "active" : ""} onClick={() => setTab("loudness")}>
                {t("ラウドネス", "Loudness")}
              </button>
            )}
            {!isStill && ffmpegAvailable && (
              <button className={tab === "inspect" ? "active" : ""} onClick={() => setTab("inspect")}>
                {t("検査", "Inspect")}
              </button>
            )}
            <button className={tab === "raw" ? "active" : ""} onClick={() => setTab("raw")}>
              {t("生 JSON", "Raw JSON")}
            </button>
          </div>

          <div style={{ display: tab === "info" ? "block" : "none" }}>
            <InfoTab data={result!.data} path={path} format={format} streams={streams} chapters={chapters} />
          </div>
          <div style={{ display: tab === "preview" ? "block" : "none" }}>
            <PreviewTab
              path={path}
              streams={streams}
              thumbPercent={thumbPercent}
              duration={format.duration ? parseFloat(format.duration) : 0}
            />
          </div>
          <div style={{ display: tab === "bitrate" ? "block" : "none" }}>
            <BitrateTab
              active={tab === "bitrate"}
              path={path}
              streams={streams}
              duration={format.duration ? parseFloat(format.duration) : 0}
            />
          </div>
          <div style={{ display: tab === "loudness" ? "block" : "none" }}>
            <LoudnessTab
              path={path}
              streams={streams}
              ffmpegAvailable={ffmpegAvailable}
              duration={format.duration ? parseFloat(format.duration) : 0}
            />
          </div>
          <div style={{ display: tab === "inspect" ? "block" : "none" }}>
            <InspectTab path={path} streams={streams} duration={format.duration ? parseFloat(format.duration) : 0} />
          </div>
          <div style={{ display: tab === "raw" ? "block" : "none" }}>
            <pre className="raw-json">{JSON.stringify(result!.data, null, 2)}</pre>
          </div>
        </div>
      )}
    </>
  );
}

function InfoTab({
  data,
  path,
  format,
  streams,
  chapters,
}: {
  data: FfprobeData;
  path: string;
  format: NonNullable<FfprobeData["format"]>;
  streams: Stream[];
  chapters: Chapter[];
}) {
  const t = useT();
  const warnings = detectWarnings(data, t);
  const still = isStillImage(data);

  return (
    <>
      {still && <ImagePreview path={path} />}

      {warnings.length > 0 && (
        <section className="warnings">
          {warnings.map((w, i) => (
            <div key={i} className={`warn warn-${w.level}`}>
              <span className="warn-icon">
                <i
                  className={`bi ${
                    w.level === "warning" ? "bi-exclamation-triangle-fill" : "bi-info-circle-fill"
                  }`}
                />
              </span>
              <div>
                <div className="warn-title">{w.title}</div>
                <div className="warn-detail">{w.detail}</div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="summary">
        <SummaryCard label={t("フォーマット", "Format")} value={format.format_long_name ?? format.format_name ?? "—"} />
        <SummaryCard label={t("再生時間", "Duration")} value={humanDuration(format.duration)} />
        <SummaryCard label={t("サイズ", "Size")} value={humanBytes(format.size)} />
        <SummaryCard label={t("総ビットレート", "Total bitrate")} value={humanBitrate(format.bit_rate)} />
        <SummaryCard label={t("ストリーム数", "Streams")} value={String(format.nb_streams ?? streams.length)} />
      </section>

      <ColorPanel path={path} streams={streams} />

      <section className="streams">
        <h2>{t("ストリーム", "Streams")}</h2>
        {streams.map((s) => (
          <StreamCard key={s.index} stream={s} />
        ))}
      </section>

      {chapters.length > 0 && (
        <section className="chapters">
          <h2>
            {t("チャプター", "Chapters")} ({chapters.length})
          </h2>
          <table className="kv chapters-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t("開始", "Start")}</th>
                <th>{t("終了", "End")}</th>
                <th>{t("タイトル", "Title")}</th>
              </tr>
            </thead>
            <tbody>
              {chapters.map((c, i) => (
                <tr key={c.id ?? i}>
                  <td>{i + 1}</td>
                  <td>{humanDuration(c.start_time)}</td>
                  <td>{humanDuration(c.end_time)}</td>
                  <td>{c.tags?.title ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {format.tags && Object.keys(format.tags).length > 0 && (
        <section className="tags-section">
          <h2>{t("メタデータ (タグ)", "Metadata (tags)")}</h2>
          <KeyValueTable obj={format.tags} />
        </section>
      )}

      <FileHashPanel path={path} />
    </>
  );
}

// プレビュー：フレームピッカー＋コンタクトシート
function PreviewTab({
  path,
  streams,
  thumbPercent,
  duration,
}: {
  path: string;
  streams: Stream[];
  thumbPercent: number;
  duration: number;
}) {
  const t = useT();
  const vstream = streams.find((s) => s.codec_type === "video");
  const fpsRate = vstream?.avg_frame_rate || vstream?.r_frame_rate;
  const videoFps = (() => {
    if (!fpsRate) return 0;
    const [n, d] = fpsRate.split("/").map(Number);
    return d ? n / d : 0;
  })();
  const thumbTime = duration > 0 ? Math.min((duration * thumbPercent) / 100, duration) : 1;

  if (!vstream) {
    return <p className="hint">{t("映像ストリームがありません。", "No video stream.")}</p>;
  }
  return (
    <>
      <FramePicker path={path} duration={duration} defaultTime={thumbTime} fps={videoFps} />
      {duration > 0 && <ContactSheet path={path} duration={duration} />}
    </>
  );
}

// 検査：整合性チェック＋検出（ブラック/無音/シーン/クロップ）
function InspectTab({
  path,
  streams,
  duration,
}: {
  path: string;
  streams: Stream[];
  duration: number;
}) {
  const hasVideo = streams.some((s) => s.codec_type === "video");
  const hasAudio = streams.some((s) => s.codec_type === "audio");
  return (
    <>
      <IntegrityCheck path={path} duration={duration} />
      {(hasVideo || hasAudio) && (
        <DetectPanel path={path} duration={duration} hasVideo={hasVideo} hasAudio={hasAudio} />
      )}
    </>
  );
}

function BitrateTab({
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
    const myReq = ++reqRef.current;
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
        <FrameStatsPanel path={path} streamIndex={streamIndex} duration={duration} />
      )}
      {!loading && series && (
        <TimestampCheck path={path} streamIndex={streamIndex} duration={duration} />
      )}
    </section>
  );
}

// ===================== 比較ビュー（N ファイル） =====================
const COMPARE_LABELS = "ABCDEFGH";

function CompareView({
  files,
  onAdd,
  onRemove,
}: {
  files: FileState[];
  onAdd: () => void;
  onRemove: (path: string) => void;
}) {
  const t = useT();
  const ready = files.filter((f) => f.result);
  const allDiff = (vals: string[]) => new Set(vals).size > 1;

  const summaryRows: { label: string; get: (f: FileState) => string }[] = [
    { label: t("フォーマット", "Format"), get: (f) => f.result?.data.format?.format_name ?? "—" },
    { label: t("再生時間", "Duration"), get: (f) => humanDuration(f.result?.data.format?.duration) },
    { label: t("サイズ", "Size"), get: (f) => humanBytes(f.result?.data.format?.size) },
    { label: t("総ビットレート", "Total bitrate"), get: (f) => humanBitrate(f.result?.data.format?.bit_rate) },
    { label: t("ストリーム数", "Streams"), get: (f) => String(f.result?.data.format?.nb_streams ?? "—") },
  ];

  return (
    <div className="compare">
      <div className="compare-slots">
        {files.map((f, i) => (
          <SlotPicker
            key={f.path || i}
            label={COMPARE_LABELS[i] ?? String(i + 1)}
            state={f}
            onRemove={() => onRemove(f.path)}
          />
        ))}
        <div className="slot slot-add" onClick={onAdd}>
          <i className="bi bi-plus-lg" /> {t("ファイルを追加", "Add file")}
        </div>
      </div>

      {ready.length >= 2 && (
        <>
          <section className="compare-table-wrap">
            <h2>{t("フォーマット比較", "Format comparison")}</h2>
            <div className="compare-scroll">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>{t("項目", "Item")}</th>
                    {ready.map((f, i) => (
                      <th key={i} title={f.path}>
                        {COMPARE_LABELS[i] ?? i + 1}: {basename(f.path)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((r) => {
                    const vals = ready.map((f) => r.get(f));
                    return (
                      <tr key={r.label} className={allDiff(vals) ? "diff" : ""}>
                        <td className="kv-k">{r.label}</td>
                        {vals.map((v, i) => (
                          <td key={i}>{v}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <StreamCompare files={ready} />

          {ready.length === 2 && (
            <CompareExtras
              pathA={ready[0].path}
              pathB={ready[1].path}
              durA={ready[0].result?.data.format?.duration ? parseFloat(ready[0].result.data.format.duration) : 0}
              durB={ready[1].result?.data.format?.duration ? parseFloat(ready[1].result.data.format.duration) : 0}
            />
          )}
        </>
      )}
    </div>
  );
}

function StreamCompare({ files }: { files: FileState[] }) {
  const t = useT();
  const streamsPer = files.map((f) => f.result?.data.streams ?? []);
  const count = Math.max(...streamsPer.map((s) => s.length), 0);
  return (
    <section className="compare-table-wrap">
      <h2>{t("ストリーム比較", "Stream comparison")}</h2>
      {Array.from({ length: count }).map((_, si) => {
        const rowMaps = streamsPer.map((streams) =>
          streams[si] ? Object.fromEntries(streamRows(streams[si], t)) : {}
        );
        const keys = Array.from(new Set(rowMaps.flatMap((m) => Object.keys(m))));
        const firstType = streamsPer.map((s) => s[si]?.codec_type).find(Boolean);
        return (
          <div key={si} className="card stream-compare-card">
            <div className="stream-head">
              <span className="stream-icon">
                <i className={`bi ${typeIconClass(firstType)}`} />
              </span>
              <span className="stream-type">
                #{si} {firstType ?? "—"}
              </span>
            </div>
            <div className="compare-scroll">
              <table className="compare-table">
                <thead>
                  <tr>
                    <th>{t("項目", "Item")}</th>
                    {files.map((_, i) => (
                      <th key={i}>{COMPARE_LABELS[i] ?? i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => {
                    const vals = rowMaps.map((m) => m[k] ?? "—");
                    return (
                      <tr key={k} className={new Set(vals).size > 1 ? "diff" : ""}>
                        <td className="kv-k">{k}</td>
                        {vals.map((v, i) => (
                          <td key={i}>{v}</td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
}

function SlotPicker({ label, state, onRemove }: { label: string; state: FileState; onRemove: () => void }) {
  const t = useT();
  return (
    <div className="slot">
      <button className="slot-remove" onClick={onRemove} title={t("削除", "Remove")}>
        <i className="bi bi-x" />
      </button>
      <div className="slot-badge">{label}</div>
      <div className="slot-body">
        {state.loading ? (
          <span>
            <i className="bi bi-hourglass-split" /> {t("解析中…", "Analyzing…")}
          </span>
        ) : state.path ? (
          <span title={state.path}>{basename(state.path)}</span>
        ) : (
          <span className="muted">{t("クリックで選択 / ドロップ", "Click or drop")}</span>
        )}
        {state.error && <div className="slot-error">{state.error}</div>}
      </div>
    </div>
  );
}

// ===================== 共通コンポーネント =====================
function CommandBar({ path, data }: { path: string; data: FfprobeData }) {
  const t = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const cmd = buildProbeCommand(path);

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(t("コピー不可", "Copy failed"));
      setTimeout(() => setCopied(null), 1500);
    }
  }

  async function exportJson() {
    const target = await save({
      title: t("JSON を保存", "Save JSON"),
      defaultPath: `${basename(path)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (target) {
      await invoke("save_text", { path: target, contents: JSON.stringify(data, null, 2) });
    }
  }

  async function exportReport() {
    const target = await save({
      title: t("HTML レポートを保存", "Save HTML report"),
      defaultPath: `${basename(path)}-report.html`,
      filters: [{ name: "HTML", extensions: ["html"] }],
    });
    if (target) {
      await invoke("save_text", { path: target, contents: buildHtmlReport(data, path, t) });
    }
  }

  async function exportPdf() {
    const target = await save({
      title: t("PDF レポートを保存", "Save PDF report"),
      defaultPath: `${basename(path)}-report.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (target) {
      await saveBinary(target, buildPdf(data, path));
    }
  }

  return (
    <section className="command-bar">
      <code className="command-text" title={cmd}>
        $ {cmd}
      </code>
      <div className="command-actions">
        <button onClick={() => copyText(cmd, t("コマンド", "Command"))}>
          {t("コマンドをコピー", "Copy command")}
        </button>
        <button onClick={() => copyText(JSON.stringify(data, null, 2), "JSON")}>
          {t("JSON をコピー", "Copy JSON")}
        </button>
        <button onClick={exportJson}>{t("JSON を保存", "Save JSON")}</button>
        <button onClick={exportReport}>{t("HTML レポート", "HTML report")}</button>
        <button onClick={exportPdf}>{t("PDF レポート", "PDF report")}</button>
        {copied && (
          <span className="copied">
            <i className="bi bi-check-lg" /> {copied}
          </span>
        )}
      </div>
    </section>
  );
}

function ErrorBox({ error }: { error: string }) {
  const t = useT();
  return (
    <section className="error-box">
      <strong>{t("エラー", "Error")}</strong>
      <pre>{error}</pre>
    </section>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card summary-card">
      <div className="card-label">{label}</div>
      <div className="card-value" title={value}>
        {value}
      </div>
    </div>
  );
}

function StreamCard({ stream: s }: { stream: Stream }) {
  const t = useT();
  const rows = streamRows(s, t);
  // 全 ffprobe フィールド（実行時オブジェクトには型に無いキーも含まれる）
  const allFields = Object.entries(s as unknown as Record<string, unknown>).map(([k, v]) => {
    const val =
      v !== null && typeof v === "object" ? JSON.stringify(v) : String(v);
    return [k, val] as [string, string];
  });
  return (
    <div className="card stream-card">
      <div className="stream-head">
        <span className="stream-icon">
          <i className={`bi ${typeIconClass(s.codec_type)}`} />
        </span>
        <span className="stream-type">
          #{s.index} {s.codec_type ?? "unknown"}
        </span>
        <span className="stream-codec">{s.codec_name ?? ""}</span>
      </div>
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
      <details className="all-fields">
        <summary>
          {t("全フィールド", "All fields")} ({allFields.length})
        </summary>
        <table className="kv">
          <tbody>
            {allFields.map(([k, v]) => (
              <tr key={k}>
                <td className="kv-k">{k}</td>
                <td className="kv-v">{v}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function KeyValueTable({ obj }: { obj: Record<string, string> }) {
  const t = useT();
  const [converted, setConverted] = useState<Record<string, boolean>>({});
  return (
    <table className="kv">
      <tbody>
        {Object.entries(obj).map(([k, v]) => {
          const val = String(v);
          const isTs = isUnixTimestamp(val);
          const show = converted[k];
          return (
            <tr key={k}>
              <td className="kv-k">{k}</td>
              <td className="kv-v">
                {isTs && show ? formatUnixTimestamp(val) : val}
                {isTs && (
                  <button
                    className="ts-btn"
                    title={show ? t("元の値に戻す", "Show raw value") : t("日時に変換", "Convert to date")}
                    onClick={() => setConverted((c) => ({ ...c, [k]: !c[k] }))}
                  >
                    <i className={`bi ${show ? "bi-arrow-counterclockwise" : "bi-clock"}`} />
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default App;
