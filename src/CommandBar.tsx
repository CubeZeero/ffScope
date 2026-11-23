import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { basename, buildProbeCommand, saveBinary, type FfprobeData } from "./ffprobe";
import { buildHtmlReport, buildPdf } from "./report";
import { useT } from "./i18n";

export function CommandBar({ path, data }: { path: string; data: FfprobeData }) {
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
      await saveBinary(target, await buildPdf(data, path));
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
