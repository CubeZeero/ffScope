import { Children, isValidElement, memo, useEffect, useState, type ReactNode } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT } from "./i18n";

function textOf(children: ReactNode): string {
  return Children.toArray(children).map(child => {
    if (typeof child === "string" || typeof child === "number") return String(child);
    return isValidElement<{ children?: ReactNode }>(child) ? textOf(child.props.children) : "";
  }).join("");
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const text = textOf(children);
  const child = Children.toArray(children)[0];
  const language = isValidElement<{ className?: string }>(child) ? child.props.className?.match(/(?:^|\s)language-([^\s]+)/)?.[1] : undefined;
  useEffect(() => { setCopied(false); }, [text]);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setError(false); }
    catch { setError(true); }
  }
  return <div className="ai-code-block">
    <div className="ai-code-toolbar"><span>{language || t("コード", "Code")}</span>
      <button type="button" className="icon-btn" onClick={copy}><i className={`bi ${copied ? "bi-check-lg" : "bi-clipboard"}`} /> {copied ? t("コピー済み", "Copied") : t("コピー", "Copy")}</button>
    </div>
    <pre>{children}</pre>
    {error && <span role="status" className="ai-error">{t("コピーできませんでした。テキストを選択してコピーしてください。", "Copy failed. Select and copy the text manually.")}</span>}
  </div>;
}

function ExternalLink({ href, children }: { href?: string; children?: ReactNode }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  let safe: string | undefined;
  try {
    const url = new URL(href ?? "");
    if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) safe = url.href;
  } catch { /* Relative, executable and malformed URLs are plain text. */ }
  if (!safe) return <span>{children}</span>;
  return <><a href={safe} rel="noopener noreferrer" onClick={e => {
    e.preventDefault();
    void openUrl(safe).catch(() => setFailed(true));
  }}>{children}</a>{failed && <span className="ai-error" role="status"> {t("リンクを開けませんでした", "Could not open link")}</span>}</>;
}

export const AiMarkdown = memo(function AiMarkdown({ text }: { text: string }) {
  return <div className="ai-markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
    a: ({ href, children }) => <ExternalLink href={href}>{children}</ExternalLink>,
    // Do not fetch remote images: even tracking pixels could leak request metadata.
    img: ({ alt }) => <span className="hint">[{alt || "Image"}]</span>,
    table: ({ children }) => <div className="ai-markdown-table"><table>{children}</table></div>,
  }}>{text}</Markdown></div>;
});
