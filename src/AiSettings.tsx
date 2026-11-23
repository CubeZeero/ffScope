import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useT } from "./i18n";
import { AI_PREFERENCES_EVENT, loadAiPreferences, saveAiPreferences, type AiProvider } from "./ai";

export function useAiPreferences() {
  const [preferences, setPreferences] = useState(loadAiPreferences);
  useEffect(() => {
    const update = () => setPreferences(loadAiPreferences());
    window.addEventListener(AI_PREFERENCES_EVENT, update);
    return () => window.removeEventListener(AI_PREFERENCES_EVENT, update);
  }, []);
  return preferences;
}

export function AiSettings() {
  const t = useT();
  const preferences = useAiPreferences();
  const provider = preferences.provider;
  const [key, setKey] = useState("");
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    setKey(""); setError(""); setNotice(""); setRegistered(null);
    invoke<boolean | null>("ai_key_status", { provider })
      .then(value => { if (active) setRegistered(value); })
      .catch(e => { if (active) setError(String(e)); });
    return () => { active = false; };
  }, [provider]);

  async function changeKey(remove: boolean) {
    setBusy(true); setError(""); setNotice("");
    try {
      if (remove) await invoke("ai_delete_key", { provider });
      else await invoke("ai_save_key", { provider, key: key.trim() });
      setKey(""); setRegistered(!remove);
      setNotice(remove ? t("キーを削除しました", "Key deleted") : t("キーを保存しました（接続は未確認）", "Key saved (connection not tested)"));
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  }

  return <section className="ai-settings">
    <h3>{t("AIアシスタント設定", "AI assistant settings")}</h3>
    <p className="hint">{t("利用者自身のAPIキーが必要です。API料金は各サービスで別途発生します。設定は即時反映されます。", "Bring your own API key. Provider API charges apply separately. Changes apply immediately.")}</p>
    <label className="field"><span>{t("プロバイダー", "Provider")}</span>
      <span className="settings-select-wrap"><select value={provider} disabled={busy} onChange={e => saveAiPreferences({ ...preferences, provider: e.target.value as AiProvider })}>
        <option value="openai">OpenAI</option><option value="anthropic">Claude (Anthropic)</option>
      </select></span>
    </label>
    <label className="field"><span>{t("モデルID", "Model ID")}</span>
      <input type="text" value={preferences.models[provider]} maxLength={200} disabled={busy} placeholder={t("利用可能なモデルIDを入力", "Enter an available model ID")}
        onChange={e => saveAiPreferences({ ...preferences, models: { ...preferences.models, [provider]: e.target.value } })} />
    </label>
    <p className="hint">{t("契約で利用可能な正確なモデルIDを指定してください。ChatGPT／Claudeのチャット契約とは別のAPI契約・残高が必要な場合があります。", "Use an exact model ID available to your account. API billing is separate from chat subscriptions.")}</p>
    <label className="field"><span>API {t("キー", "key")}</span>
      <input type="password" value={key} onChange={e => setKey(e.target.value)} disabled={busy} autoComplete="off" spellCheck={false}
        maxLength={4096} placeholder={registered === true ? t("登録済み（変更するときだけ入力）", "Saved (enter only to replace)") : registered === null ? t("登録済みなら再入力不要・変更時だけ入力", "No re-entry needed if already saved") : t("APIキーを入力", "Enter API key")} />
    </label>
    <div className="ai-settings-actions">
      <button type="button" className="icon-btn" disabled={busy || !key.trim()} onClick={() => changeKey(false)}>{t("キーを保存", "Save key")}</button>
      <button type="button" className="icon-btn" disabled={busy || registered === false} onClick={() => changeKey(true)}>{t("キーを削除", "Delete key")}</button>
      <span className="hint">{busy ? t("処理中…", "Working…") : registered === null ? t("保存状態は初回送信時に確認", "Saved key checked on first send") : registered ? t("起動中は読み込み済み", "Available this session") : t("未登録", "Not saved")}</span>
    </div>
    <p className="hint">{t("キーはOSの資格情報ストアに保存します。初回送信時のみ読み込み、起動中はメモリで保持します。設定を開くだけではキーを読みません。再起動・アプリ更新後にはOSの確認が出る場合があります。平文ファイルには保存しません。", "Keys stay in the OS credential store. First send loads the key into session memory; opening settings does not read it. OS approval may be needed after restarting or updating. No plaintext files.")}</p>
    {notice && <p className="hint" role="status">{notice}</p>}
    {error && <p className="ai-error" role="alert">{error}</p>}
  </section>;
}
