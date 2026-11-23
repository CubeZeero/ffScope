import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { AiSettings, useAiPreferences } from "./AiSettings";
import { buildAiContext, type ChatMessage } from "./ai";
import type { FfprobeData } from "./ffprobe";
import { useT } from "./i18n";
import { useAnalyses } from "./useAnalyses";
import { analysisLabels } from "./analysis-labels";
const AiMarkdown = lazy(() => import("./AiMarkdown").then(module => ({ default: module.AiMarkdown })));

export function AiChat({ open, data, path }: { open: boolean; data: FfprobeData | null; path: string }) {
  const t = useT();
  const preferences = useAiPreferences();
  const records = useAnalyses(path);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [consent, setConsent] = useState(false);
  const [attach, setAttach] = useState(false);
  const [selectedResults, setSelectedResults] = useState<string[]>([]);
  const context = useMemo(() => buildAiContext(attach ? data : null, t, records, selectedResults), [data, t, records, selectedResults, attach]);
  const attachmentRef = useRef<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showConnection, setShowConnection] = useState(false);
  const [showData, setShowData] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const activeRef = useRef<string | null>(null);
  const replyRef = useRef("");
  const frameRef = useRef(0);
  const endRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);

  useEffect(() => () => {
    cancelAnimationFrame(frameRef.current);
    if (activeRef.current) void invoke("ai_cancel", { id: activeRef.current }).catch(() => {});
    activeRef.current = null;
  }, []);
  // Provider/model changes start a fresh conversation, avoiding accidental cross-vendor sharing.
  const providerModel = `${preferences.provider}:${preferences.models[preferences.provider]}`;
  useEffect(() => {
    if (activeRef.current) void invoke("ai_cancel", { id: activeRef.current }).catch(() => {});
    activeRef.current = null;
    cancelAnimationFrame(frameRef.current); frameRef.current = 0;
    setMessages([]); setBusy(false); setError(""); setConsent(false); setAttach(false); setSelectedResults([]); attachmentRef.current = null;
  }, [providerModel]);
  useEffect(() => {
    if (open && followRef.current) endRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages, open]);

  function flush() {
    const content = replyRef.current;
    setMessages(previous => previous.map((m, i) => i === previous.length - 1 && m.role === "assistant" ? { ...m, content } : m));
  }

  async function send() {
    if (activeRef.current || busy || !consent || !question.trim()) return;
    const model = preferences.models[preferences.provider].trim();
    if (!model) { setError(t("モデルIDを設定してください。", "Set a model ID first.")); return; }
    const history = messages.filter(m => m.content.trim());
    if (history.length >= 38) { setError(t("会話をクリアして新しく開始してください。", "Clear chat to start a new conversation.")); return; }
    const id = crypto.randomUUID();
    if (!history.length) attachmentRef.current = context;
    activeRef.current = id;
    const outgoing: ChatMessage[] = [...history, { role: "user", content: question.trim() }];
    setMessages([...outgoing, { role: "assistant", content: "" }]);
    setQuestion(""); setBusy(true); setError(""); replyRef.current = ""; followRef.current = true;
    const channel = new Channel<string>();
    channel.onmessage = text => {
      if (activeRef.current !== id) return;
      replyRef.current += text;
      if (!frameRef.current) frameRef.current = requestAnimationFrame(() => { frameRef.current = 0; if (activeRef.current === id) flush(); });
    };
    try {
      await invoke("ai_chat", { request: { id, provider: preferences.provider, model,
        messages: outgoing, context: attachmentRef.current }, onDelta: channel });
    } catch (e) { if (activeRef.current === id) setError(String(e)); }
    finally {
      if (activeRef.current === id) {
        cancelAnimationFrame(frameRef.current); frameRef.current = 0;
        flush(); activeRef.current = null; setBusy(false);
      }
    }
  }

  async function stop() {
    const id = activeRef.current;
    if (id) {
      try { await invoke("ai_cancel", { id }); }
      catch (e) { setError(String(e)); }
    }
  }

  if (!open) return null;
  return <section className="ai-chat" aria-label={t("AIアシスタント", "AI assistant")}>
    <div className="ai-chat-head">
      <div className="ai-chat-heading"><h2><i className="bi bi-chat-left-text" /> {t("AIアシスタント", "AI assistant")}</h2>
        <span className="ai-model-label" title={preferences.models[preferences.provider]}>{preferences.provider === "openai" ? "OpenAI" : "Claude"} · {preferences.models[preferences.provider] || t("モデル未設定", "No model selected")}</span>
      </div>
      <div className="ai-head-actions">
        {busy && <span className="hint" role="status"><span className="spinner" /> {t("生成中…", "Generating…")}</span>}
        <button type="button" className="icon-btn" aria-expanded={showConnection} onClick={() => setShowConnection(v => !v)} title={t("接続設定・APIキー", "Connection settings & API key")}><i className="bi bi-gear" /> {t("接続設定", "Connection")}</button>
      </div>
    </div>
    <div className="ai-chat-options">
      {showConnection && <div className="ai-connection-panel"><AiSettings /></div>}
      <div className="ai-options-toolbar">
        <label className="ai-checkbox"><input type="checkbox" checked={attach} disabled={busy || !data || messages.length > 0} onChange={e => setAttach(e.target.checked)} />{t("技術情報・警告を添付", "Attach metadata & warnings")}</label>
        <label className="ai-checkbox"><input type="checkbox" checked={consent} disabled={busy} onChange={e => setConsent(e.target.checked)} />{t("外部送信・API料金に同意", "Allow external sending & API charges")}</label>
        <div className="ai-option-buttons">
          <button type="button" className="ai-option-toggle" aria-expanded={showData} aria-controls="ai-data-panel" onClick={() => setShowData(v => !v)}><i className={`bi ${showData ? "bi-caret-down-fill" : "bi-caret-right-fill"}`} aria-hidden="true" />{t("送信内容・注意点", "Data & privacy")}</button>
          <button type="button" className="ai-option-toggle" aria-expanded={showResults} aria-controls="ai-results-panel" onClick={() => setShowResults(v => !v)}><i className={`bi ${showResults ? "bi-caret-down-fill" : "bi-caret-right-fill"}`} aria-hidden="true" />{t("解析結果を選択", "Select analysis results")} <span className="ai-selected-count">({selectedResults.length})</span></button>
        </div>
      </div>
      {showData && <div id="ai-data-panel" className="ai-option-panel">
          <p className="hint">{t("質問・会話履歴と、選択した技術情報・警告をプロバイダーへ送信します。動画・音声・画像・ファイル名・パス・タグは自動送信しません。履歴はメモリ内のみ。添付の変更は会話をクリアしてから行ってください。ファイル切替時は新しい会話になります。", "Questions, conversation history and selected technical metadata & warnings are sent to the provider. No automatic upload of media, filenames, paths or tags. History stays in memory. Clear chat to change attachment; changing files starts a new chat.")}</p>
          <p className="hint">{t("添付内容は会話開始時に固定されます。新しい測定結果を使う場合は会話をクリアしてください。", "Attachments are frozen at conversation start. Clear chat to use new measurements.")}</p>
          {(messages.length ? attachmentRef.current : context) && <pre className="ai-context">{messages.length ? attachmentRef.current : context}</pre>}
      </div>}
      {showResults && <div id="ai-results-panel" className="ai-option-panel ai-analysis-picker">
          <p className="hint">{t("完了した結果だけ添付できます（最大24項目）。ログ・画像・ファイル名は含めません。", "Select completed results only (up to 24). No logs, images or filenames.")}</p>
          {records.filter(r => r.status === "complete").map(r => <label className="ai-checkbox" key={r.id}><input type="checkbox" checked={selectedResults.includes(r.id)} disabled={busy || messages.length > 0 || (!selectedResults.includes(r.id) && selectedResults.length >= 24)} onChange={e => setSelectedResults(ids => e.target.checked ? [...ids, r.id] : ids.filter(id => id !== r.id))} />{t(...analysisLabels[r.kind])}{r.streamIndex !== null && ` #${r.streamIndex}`}</label>)}
          {!records.some(r => r.status === "complete") && <p className="hint">{t("解析・総合チェックを先に実行してください。", "Run an analysis or overall check first.")}</p>}
      </div>}
    </div>
    <div className="ai-transcript" ref={transcriptRef} role="log" aria-label={t("会話", "Conversation")}
      onScroll={() => { const el = transcriptRef.current; if (el) followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      {!messages.length && <p className="hint">{t("例：「VFRの警告はどういう意味？」「この動画の形式を説明して」", "Try: “Explain the VFR warning” or “Explain this video's format”.")}</p>}
      {messages.map((m, i) => <article key={i} className={`ai-message ai-message-${m.role}`}><strong className="ai-message-role">{m.role === "user" ? t("あなた", "You") : "AI"}</strong>
        {m.role === "assistant" && m.content ? <Suspense fallback={<div className="ai-message-text">{m.content}</div>}><AiMarkdown text={m.content} /></Suspense> : <div className="ai-message-text">{m.content || (busy ? t("回答を待っています…", "Waiting for a reply…") : t("回答なし", "No reply"))}</div>}
      </article>)}
      <div ref={endRef} />
    </div>
    <div className="ai-compose">
      {error && <p className="ai-error" role="alert">{error}</p>}
      <p className="hint">{t("回答は誤る場合があります。生成されたコマンドは自動実行しません。", "AI can make mistakes. Suggested commands are never executed automatically.")}</p>
      <textarea value={question} onChange={e => setQuestion(e.target.value)} maxLength={8000} rows={3} disabled={busy}
        aria-label={t("質問", "Question")} placeholder={t("質問を入力（Ctrl／⌘＋Enterで送信）", "Ask a question (Ctrl/⌘+Enter to send)")}
        onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); } }} />
      <div className="ai-compose-actions">
        <button type="button" className="icon-btn" disabled={busy} onClick={() => { setMessages([]); setError(""); }}>{t("会話をクリア", "Clear chat")}</button>
        {busy ? <button type="button" className="icon-btn" onClick={stop}><i className="bi bi-stop-fill" /> {t("停止", "Stop")}</button>
          : <button type="button" className="primary-btn" disabled={!consent || !question.trim() || !preferences.models[preferences.provider].trim()} onClick={send}><i className="bi bi-send" /> {t("送信", "Send")}</button>}
      </div>
    </div>
  </section>;
}
