import { lazy, memo, useMemo, Suspense } from "react";
import { RetainedTab } from "./RetainedTab";
import { ErrorBox } from "./ErrorBox";
import { DeliveryPanel } from "./DeliveryPanel";
import { basename, isStillImage } from "./ffprobe";
import { useT } from "./i18n";
import { CommandBar } from "./CommandBar";
import { InfoTab } from "./InfoTab";
import { PreviewTab, InspectTab } from "./MediaTabs";
import type { FileState, Tab } from "./file-state";

const BitrateTab = lazy(() => import("./BitrateTab").then(module => ({ default: module.BitrateTab })));
const OverallCheck = lazy(() => import("./OverallCheck").then(module => ({ default: module.OverallCheck })));
const LoudnessTab = lazy(() => import("./LoudnessTab").then(module => ({ default: module.LoudnessTab })));

export function SingleView({
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
  const hasVideo = streams.some((s) => s.codec_type === "video");
  const isStill = result ? isStillImage(result.data) : false;
  const duration = Number(format?.duration) || 0;

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
            <button className={tab === "delivery" ? "active" : ""} onClick={() => setTab("delivery")}>{t("納品仕様", "Delivery")}</button>
            <button className={tab === "overall" ? "active" : ""} onClick={() => setTab("overall")}>{t("総合チェック", "Overall check")}</button>
            <button className={tab === "raw" ? "active" : ""} onClick={() => setTab("raw")}>
              {t("生 JSON", "Raw JSON")}
            </button>
          </div>

          <RetainedTab active={tab === "info"}><Suspense fallback={<p className="hint">{t("読み込み中…", "Loading…")}</p>}>
            <InfoTab data={result!.data} path={path} />
          </Suspense></RetainedTab>
          <RetainedTab active={tab === "preview"}><Suspense fallback={<p className="hint">{t("読み込み中…", "Loading…")}</p>}>
            <PreviewTab
              path={path}
              streams={streams}
              thumbPercent={thumbPercent}
              duration={duration}
            />
          </Suspense></RetainedTab>
          <RetainedTab active={tab === "bitrate"}><Suspense fallback={<p className="hint">{t("読み込み中…", "Loading…")}</p>}>
            <BitrateTab
              active={tab === "bitrate"}
              path={path}
              streams={streams}
              duration={duration}
            />
          </Suspense></RetainedTab>
          <RetainedTab active={tab === "loudness"}><Suspense fallback={<p className="hint">{t("読み込み中…", "Loading…")}</p>}>
            <LoudnessTab
              path={path}
              streams={streams}
              ffmpegAvailable={ffmpegAvailable}
              duration={duration}
            />
          </Suspense></RetainedTab>
          <RetainedTab active={tab === "inspect"}><Suspense fallback={<p className="hint">{t("読み込み中…", "Loading…")}</p>}>
            <InspectTab path={path} streams={streams} duration={duration} />
          </Suspense></RetainedTab>
          <RetainedTab active={tab === "delivery"}><Suspense fallback={<p className="hint">{t("読み込み中…", "Loading…")}</p>}><DeliveryPanel path={path} data={result!.data} /></Suspense></RetainedTab>
          <RetainedTab active={tab === "overall"}><Suspense fallback={<p className="hint">{t("読み込み中…", "Loading…")}</p>}><OverallCheck path={path} data={result!.data} ffmpegAvailable={ffmpegAvailable} /></Suspense></RetainedTab>
          <RetainedTab active={tab === "raw"}><Suspense fallback={<p className="hint">{t("読み込み中…", "Loading…")}</p>}>
            <RawJson data={result!.data} />
          </Suspense></RetainedTab>
        </div>
      )}
    </>
  );
}

const RawJson = memo(function RawJson({ data }: { data: unknown }) {
  const json = useMemo(() => JSON.stringify(data, null, 2), [data]);
  return <pre className="raw-json">{json}</pre>;
});
