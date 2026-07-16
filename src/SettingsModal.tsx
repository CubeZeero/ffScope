import { useState } from "react";
import { useT, type Lang } from "./i18n";

export interface Settings {
  lang: Lang;
  thumbPercent: number;
  ffprobePath: string;
  ffmpegPath: string;
}

export function SettingsModal({
  settings,
  theme,
  onChangeTheme,
  onSave,
  onClose,
}: {
  settings: Settings;
  theme: "dark" | "light";
  onChangeTheme: (t: "dark" | "light") => void;
  onSave: (s: Settings) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<Settings>(settings);

  const upd = (patch: Partial<Settings>) => setDraft((d) => ({ ...d, ...patch }));

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{t("設定", "Settings")}</h2>
          <button className="icon-btn" onClick={onClose} title={t("閉じる", "Close")}>
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <div className="modal-body">
          <label className="field">
            <span>{t("言語", "Language")}</span>
            <select value={draft.lang} onChange={(e) => upd({ lang: e.target.value as Lang })}>
              <option value="ja">日本語</option>
              <option value="en">English</option>
            </select>
          </label>

          <label className="field">
            <span>{t("テーマ", "Theme")}</span>
            <select value={theme} onChange={(e) => onChangeTheme(e.target.value as "dark" | "light")}>
              <option value="dark">{t("ダーク", "Dark")}</option>
              <option value="light">{t("ライト", "Light")}</option>
            </select>
          </label>

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
        </div>

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
