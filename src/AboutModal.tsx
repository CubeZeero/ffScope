import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { Logo } from "./Logo";
import { toolInfo, type ToolInfo } from "./ffprobe";
import { useT } from "./i18n";

const REPO_URL = "https://github.com/CubeZeero/ffScope";

export function AboutModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [version, setVersion] = useState("1.0.0");
  const [tools, setTools] = useState<ToolInfo | null>(null);

  useEffect(() => {
    getVersion().then(setVersion).catch(() => {});
    toolInfo().then(setTools).catch(() => {});
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal about-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t("ffScope について", "About ffScope")}</h2>
          <button className="icon-btn" onClick={onClose} title={t("閉じる", "Close")}>
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <div className="modal-body about-body">
          <div className="about-brand">
            <span className="about-logo">
              <Logo />
            </span>
            <div>
              <div className="about-name">ffScope</div>
              <div className="about-version">v{version}</div>
            </div>
          </div>

          <p className="about-desc">
            {t(
              "ffprobe / ffmpeg を使ったメディア解析 GUI。フォーマット・ストリーム・ビットレート・ラウドネス・HDR などを可視化します。",
              "A media analysis GUI powered by ffprobe / ffmpeg — visualizes format, streams, bitrate, loudness, HDR and more."
            )}
          </p>

          <table className="kv about-kv">
            <tbody>
              <tr>
                <td className="kv-k">{t("開発者", "Developer")}</td>
                <td className="kv-v">CubeZeero</td>
              </tr>
              <tr>
                <td className="kv-k">{t("ライセンス", "License")}</td>
                <td className="kv-v">MIT — © 2026 CubeZeero</td>
              </tr>
              <tr>
                <td className="kv-k">{t("リポジトリ", "Repository")}</td>
                <td className="kv-v">
                  <button className="link-btn" onClick={() => invoke("open_repo")}>
                    <i className="bi bi-github" /> {REPO_URL}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>

          {tools && (
            <table className="kv about-kv">
              <tbody>
                <tr>
                  <td className="kv-k">ffmpeg</td>
                  <td className="kv-v">{tools.ffmpeg_version}</td>
                </tr>
                <tr>
                  <td className="kv-k">ffprobe</td>
                  <td className="kv-v">{tools.ffprobe_version}</td>
                </tr>
              </tbody>
            </table>
          )}

          <p className="about-credits">
            {t("使用技術", "Built with")}: Tauri · React · uPlot · Bootstrap Icons ·{" "}
            {t("解析エンジン", "engine")}: FFmpeg / ffprobe
          </p>
        </div>

        <div className="modal-foot">
          <button className="primary-btn" onClick={onClose}>
            {t("閉じる", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
