import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { RetainedTab } from "./RetainedTab";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { listen } from "@tauri-apps/api/event";
import { checkFfmpeg, checkFfprobe, setToolPaths } from "./ffprobe";
import { Logo } from "./Logo";
import { BatchView } from "./BatchView";
import { SettingsModal, type Settings } from "./SettingsModal";
import { AboutModal } from "./AboutModal";
import { ToastProvider } from "./toast";
import { LangContext, makeT } from "./i18n";
import { SingleView } from "./SingleView";
import { CompareView } from "./CompareView";
import { EMPTY_FILE, type Mode, type Tab } from "./file-state";
import { useFileJobs } from "./useFileJobs";
import { loadSettings, loadRecent, readPreference, writePreference } from "./preferences";
import "./App.css";
import "./glass.css";
import "./obsidian.css";
import "./matrix.css";
import "./ai.css";
import "./checks.css";
import { isDarkTheme, parseTheme, themeStyle, toggleTheme, type Theme } from "./theme";


const AiChat = lazy(() => import("./AiChat").then(module => ({ default: module.AiChat })));
const CommandRunner = lazy(() => import("./CommandRunner").then(module => ({ default: module.CommandRunner })));

function App() {
  const [mode, setMode] = useState<Mode>("single");
  const [ffprobePath, setFfprobePath] = useState<string | null>(null);
  const [ffmpegAvailable, setFfmpegAvailable] = useState(false);
  const [theme, setTheme] = useState<Theme>(
    () => parseTheme(readPreference("ffscope-theme"))
  );
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const t = makeT(settings.lang);

  // テーマを <html data-theme> に反映して永続化
  useEffect(() => {
    document.documentElement.dataset.theme = isDarkTheme(theme) ? "dark" : "light";
    document.documentElement.dataset.style = themeStyle(theme);
    document.documentElement.style.colorScheme = isDarkTheme(theme) ? "dark" : "light";
    writePreference("ffscope-theme", theme);
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

  const [tab, setTab] = useState<Tab>("info");
  function rememberProbe(path: string, result: { ffprobe_path: string }) {
    setFfprobePath(result.ffprobe_path);
    addRecent(path);
  }
  const singleJobs = useFileJobs(rememberProbe);
  const compareJobs = useFileJobs(rememberProbe);
  // Batch probes deliberately do not contribute to recent files.
  const batchJobs = useFileJobs();
  const single = singleJobs.files[0] ?? EMPTY_FILE;
  const { add: addComparePaths } = compareJobs;
  const { add: addBatchPaths } = batchJobs;
  const [dragOver, setDragOver] = useState(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  async function pickFiles(multiple: boolean): Promise<string[]> {
    const selected = await open({ multiple, directory: false });
    return Array.isArray(selected) ? selected : typeof selected === "string" ? [selected] : [];
  }
  async function pickCompare() { addComparePaths(await pickFiles(true)); }
  async function pickBatch() { addBatchPaths(await pickFiles(true)); }
  async function pickSingle() {
    const [path] = await pickFiles(false);
    if (path) singleJobs.replace(path);
  }

  function addRecent(path: string) {
    setRecent((prev) => {
      const next = [path, ...prev.filter((p) => p !== path)].slice(0, 10);
      writePreference("ffscope-recent", JSON.stringify(next));
      return next;
    });
  }

  function handleDroppedPaths(paths: string[]) {
    if (!paths.length) return;
    if (modeRef.current === "single") {
      setTab("info");
      singleJobs.replace(paths[0]);
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

  // メニューバーからの操作を購読
  useEffect(() => {
    const unlisteners = [
      listen("menu:open", () => {
        if (modeRef.current === "single") pickSingle();
        else if (modeRef.current === "compare") pickCompare();
        else if (modeRef.current === "batch") pickBatch();
      }),
      listen("menu:toggle-theme", () => setTheme(toggleTheme)),
    ];
    return () => {
      unlisteners.forEach((u) => u.then((un) => un()));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveSettings(s: Settings) {
    setSettings(s);
    writePreference("ffscope-settings", JSON.stringify(s));
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
              <button className={mode === "ai" ? "active" : ""} onClick={() => setMode("ai")}>
                <i className="bi bi-chat-left-text" /> AI
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
              title={isDarkTheme(theme) ? t("ライトテーマに切替", "Switch to light") : t("ダークテーマに切替", "Switch to dark")}
              onClick={() => setTheme(toggleTheme)}
            >
              <i className={`bi ${isDarkTheme(theme) ? "bi-moon-stars-fill" : "bi-sun-fill"}`} />
            </button>
            <button className="theme-toggle" title={t("設定", "Settings")} onClick={() => setShowSettings(true)}>
              <i className="bi bi-gear-fill" />
            </button>
            <button className="theme-toggle" title={t("ffScope について", "About ffScope")} onClick={() => setShowAbout(true)}>
              <i className="bi bi-info-circle" />
            </button>
          </div>
        </header>
        <RetainedTab key={single.path} active={mode === "ai"}><Suspense fallback={null}><AiChat open={mode === "ai"} data={single.result?.data ?? null} path={single.path} /></Suspense></RetainedTab>

        {/* 各ビューを常時マウントし表示だけ切替 → 切替時の再解析を防ぐ */}
        <RetainedTab active={mode === "single"}><Suspense fallback={null}>
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
              pickSingle();
            }}
            onPickRecent={(p) => {
              setTab("info");
              singleJobs.replace(p);
            }}
          />
        </Suspense></RetainedTab>
        <RetainedTab active={mode === "compare"}><Suspense fallback={null}>
          <CompareView
            files={compareJobs.files}
            onAdd={pickCompare}
            onRemove={compareJobs.remove}
          />
        </Suspense></RetainedTab>
        <RetainedTab active={mode === "batch"}><Suspense fallback={null}>
          <BatchView
            files={batchJobs.files}
            onAdd={pickBatch}
            onClear={batchJobs.clear}
            onRemove={batchJobs.remove}
          />
        </Suspense></RetainedTab>
        <RetainedTab active={mode === "tools"}><Suspense fallback={null}>
          <CommandRunner initialPath={single.path || undefined} />
        </Suspense></RetainedTab>

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

export default App;
