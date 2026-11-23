import { useState } from "react";
import { AiSettings } from "./AiSettings";
import { UpdateSettings } from "./UpdateSettings";
import { useT, type Lang } from "./i18n";
import type { Settings } from "./preferences";
export type { Settings } from "./preferences";
import { composeTheme, isDarkTheme, themeStyle, type Theme, type ThemeMode, type ThemeStyle } from "./theme";

export function SettingsModal({
  settings,
  theme,
  onChangeTheme,
  onSave,
  onClose,
}: {
  settings: Settings;
  theme: Theme;
  onChangeTheme: (t: Theme) => void;
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Settings>(settings);
  const [section, setSection] = useState<"general" | "ai" | "updates">("general");
  const style = themeStyle(theme);
  const mode: ThemeMode = isDarkTheme(theme) ? "dark" : "light";

  const upd = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t("設定", "Settings")}</h2>
          <button className="icon-btn" onClick={onClose} title={t("閉じる", "Close")}>
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <div className="settings-sections" role="tablist" aria-label={t("設定項目", "Settings sections")}>
          <button type="button" role="tab" id="settings-general-tab" aria-selected={section === "general"} aria-controls="settings-general-panel" className={section === "general" ? "active" : ""} onClick={() => setSection("general")}>{t("一般", "General")}</button>
          <button type="button" role="tab" id="settings-ai-tab" aria-selected={section === "ai"} aria-controls="settings-ai-panel" className={section === "ai" ? "active" : ""} onClick={() => setSection("ai")}><i className="bi bi-key" /> {t("AI・APIキー", "AI & API keys")}</button>
          <button type="button" role="tab" id="settings-updates-tab" aria-selected={section === "updates"} aria-controls="settings-updates-panel" className={section === "updates" ? "active" : ""} onClick={() => setSection("updates")}><i className="bi bi-arrow-repeat" /> {t("更新", "Updates")}</button>
        </div>
        {section === "general" && <div className="modal-body" role="tabpanel" id="settings-general-panel" aria-labelledby="settings-general-tab">
          <label className="field">
            <span>{t("言語", "Language")}</span>
            <span className="settings-select-wrap"><select value={draft.lang} onChange={(e) => upd({ lang: e.target.value as Lang })}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select></span>
          </label>

          <label className="field">
            <span>{t("テーマ", "Theme")}</span>
            <span className="settings-select-wrap"><select value={style} onChange={(e) => onChangeTheme(composeTheme(e.target.value as ThemeStyle, mode))}>
              <option value="classic">{t("クラシック", "Classic")}</option>
              <option value="glass">Liquid Glass</option>
              <option value="obsidian">Obsidian</option>
              <option value="matrix">Dot Matrix</option>
            </select></span>
          </label>
          <label className="field">
            <span>{t("カラーモード", "Color mode")}</span>
            <span className="settings-select-wrap"><select value={mode} onChange={(e) => onChangeTheme(composeTheme(style, e.target.value as ThemeMode))}>
              <option value="dark">{t("ダーク", "Dark")}</option>
              <option value="light">{t("ライト", "Light")}</option>
            </select></span>
          </label>
          <p className="hint">{t("テーマは即時反映されます。上部の切替ボタンは、選択したスタイルのダーク／ライトを切り替えます。", "Themes apply immediately. The top bar button switches dark/light within the selected style.")}</p>

          <label className="field">
            <span>{t("サムネイル位置", "Thumbnail position")}</span>
            <span className="field-inline">
              <input
                type="range"
                min={0}
                max={100}
                value={draft.thumbPercent}
                onChange={(e) => upd({ thumbPercent: Number(e.target.value) })}
              />
              <span className="field-num">{draft.thumbPercent}%</span>
            </span>
          </label>

          <label className="field">
            <span>{t("ffprobe パス（上書き）", "ffprobe path (override)")}</span>
            <input
              type="text"
              placeholder={t("自動検出", "auto-detect")}
              value={draft.ffprobePath}
              onChange={(e) => upd({ ffprobePath: e.target.value })}
            />
          </label>

          <label className="field">
            <span>{t("ffmpeg パス（上書き）", "ffmpeg path (override)")}</span>
            <input
              type="text"
              placeholder={t("自動検出", "auto-detect")}
              value={draft.ffmpegPath}
              onChange={(e) => upd({ ffmpegPath: e.target.value })}
            />
          </label>
          <p className="hint">
            {t(
              "パスを空にすると自動検出に戻ります。変更は次の解析から反映されます。",
              "Leave a path empty to fall back to auto-detect. Changes apply to the next analysis."
            )}
          </p>
        </div>}

        {section === "ai" && <div className="modal-body" role="tabpanel" id="settings-ai-panel" aria-labelledby="settings-ai-tab"><AiSettings /></div>}
        {section === "updates" && <div className="modal-body" role="tabpanel" id="settings-updates-panel" aria-labelledby="settings-updates-tab"><UpdateSettings /></div>}
        <div className="modal-foot">
          <button onClick={onClose}>{t("キャンセル", "Cancel")}</button>
          <button className="primary-btn" onClick={() => onSave(draft)}>
            {t("保存", "Save")}
          </button>
        </div>
      </div>
    </div>
  );
}
