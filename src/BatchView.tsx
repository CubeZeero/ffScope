import {
  basename,
  humanBitrate,
  humanBytes,
  humanDuration,
  type FfprobeData,
} from "./ffprobe";
import { useT } from "./i18n";

import type { FileState } from "./file-state";
export type BatchItem = FileState;

function videoStream(d: FfprobeData) {
  return (d.streams ?? []).find((s) => s.codec_type === "video");
}
function audioStream(d: FfprobeData) {
  return (d.streams ?? []).find((s) => s.codec_type === "audio");
}

export function BatchView({
  files,
  onAdd,
  onClear,
  onRemove,
}: {
  files: BatchItem[];
  onAdd: () => void;
  onClear: () => void;
  onRemove: (path: string) => void;
}) {
  const t = useT();

  return (
    <div className="batch">
      <div className="batch-toolbar">
        <button className="primary-btn" onClick={onAdd}>
          <i className="bi bi-plus-lg" /> {t("ファイルを追加", "Add files")}
        </button>
        {files.length > 0 && (
          <button onClick={onClear}>
            <i className="bi bi-trash" /> {t("クリア", "Clear")}
          </button>
        )}
        <span className="muted">{t("複数ファイルをドロップして一括解析", "Drop multiple files to batch-analyze")}</span>
      </div>

      {files.length === 0 ? (
        <section className="dropzone" onClick={onAdd}>
          <div className="dropzone-inner">
            <span className="dz-icon">
              <i className="bi bi-collection" />
            </span>
            <p className="dz-title">{t("複数ファイルをドラッグ&ドロップ", "Drag & drop multiple files")}</p>
            <p className="dz-hint">{t("またはクリックして選択", "or click to select")}</p>
          </div>
        </section>
      ) : (
        <div className="batch-table-wrap">
          <table className="batch-table">
            <thead>
              <tr>
                <th>{t("ファイル", "File")}</th>
                <th>{t("形式", "Format")}</th>
                <th>{t("再生時間", "Duration")}</th>
                <th>{t("解像度", "Resolution")}</th>
                <th>{t("映像", "Video")}</th>
                <th>{t("音声", "Audio")}</th>
                <th>{t("ビットレート", "Bitrate")}</th>
                <th>{t("サイズ", "Size")}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {files.map((f) => {
                const d = f.result?.data;
                const v = d ? videoStream(d) : undefined;
                const a = d ? audioStream(d) : undefined;
                return (
                  <tr key={f.path}>
                    <td className="batch-name" title={f.path}>
                      {basename(f.path)}
                    </td>
                    {f.loading ? (
                      <td colSpan={7} className="muted">
                        <i className="bi bi-hourglass-split" /> {t("解析中…", "Analyzing…")}
                      </td>
                    ) : f.error ? (
                      <td colSpan={7} className="batch-error">
                        {f.error}
                      </td>
                    ) : d ? (
                      <>
                        <td>{d.format?.format_name ?? "—"}</td>
                        <td>{humanDuration(d.format?.duration)}</td>
                        <td>{v?.width && v?.height ? `${v.width}×${v.height}` : "—"}</td>
                        <td>{v?.codec_name ?? "—"}</td>
                        <td>{a?.codec_name ?? "—"}</td>
                        <td>{humanBitrate(d.format?.bit_rate)}</td>
                        <td>{humanBytes(d.format?.size)}</td>
                      </>
                    ) : (
                      <td colSpan={7} />
                    )}
                    <td>
                      <button className="icon-btn" onClick={() => onRemove(f.path)} title={t("削除", "Remove")}>
                        <i className="bi bi-x" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
