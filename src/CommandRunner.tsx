import { useState } from "react";
import { runFfprobe } from "./ffprobe";
import { useT } from "./i18n";
import { useToast } from "./toast";

// 簡易的な引数分割（"..." / '...' のクォートに対応）
function splitArgs(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    out.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return out;
}

const PRESETS: { label: string; args: string }[] = [
  { label: "streams (json)", args: "-v error -show_streams -of json INPUT" },
  { label: "format (json)", args: "-v error -show_format -of json INPUT" },
  { label: "keyframes", args: "-v error -select_streams v:0 -show_entries frame=key_frame,pkt_pts_time -of csv INPUT" },
  { label: "packets count", args: "-v error -count_packets -show_entries stream=nb_read_packets -of csv INPUT" },
];

interface SavedPreset {
  name: string;
  args: string;
}
function loadSaved(): SavedPreset[] {
  try {
    return JSON.parse(localStorage.getItem("ffscope-cmd-presets") || "[]");
  } catch {
    return [];
  }
}
function storeSaved(list: SavedPreset[]) {
  localStorage.setItem("ffscope-cmd-presets", JSON.stringify(list));
}

export function CommandRunner({ initialPath }: { initialPath?: string }) {
  const t = useT();
  const { notify } = useToast();
  const [argStr, setArgStr] = useState(
    initialPath
      ? `-v error -show_format -show_streams -of json "${initialPath}"`
      : "-v error -show_format -show_streams -of json INPUT"
  );
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState<SavedPreset[]>(loadSaved);
  const [presetName, setPresetName] = useState("");

  function savePreset() {
    const name = presetName.trim();
    if (!name) return;
    const next = [...saved.filter((p) => p.name !== name), { name, args: argStr }];
    setSaved(next);
    storeSaved(next);
    setPresetName("");
  }
  function deletePreset(name: string) {
    const next = saved.filter((p) => p.name !== name);
    setSaved(next);
    storeSaved(next);
  }

  async function run() {
    setLoading(true);
    setErr(null);
    setOut(null);
    try {
      const args = splitArgs(argStr);
      const res = await runFfprobe(args);
      setOut(res.stdout);
      setErr(res.stderr || null);
      notify(
        res.code === 0 ? t("実行が完了しました", "Command finished") : t(`終了コード ${res.code}`, `Exit code ${res.code}`),
        res.code === 0 ? "success" : "error"
      );
    } catch (e) {
      setErr(String(e));
      notify(t("実行に失敗しました", "Command failed"), "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="command-runner">
      <p className="hint">
        {t(
          "ffprobe に渡す引数を編集して実行できます（先頭の ffprobe は不要、シェルは介しません）。",
          "Edit ffprobe arguments and run (omit the leading ffprobe; no shell involved)."
        )}
      </p>
      <div className="preset-row">
        {PRESETS.map((p) => (
          <button key={p.label} className="preset-chip" onClick={() => setArgStr(p.args)}>
            {p.label}
          </button>
        ))}
      </div>

      {saved.length > 0 && (
        <div className="preset-row">
          {saved.map((p) => (
            <span key={p.name} className="preset-chip saved-preset">
              <span onClick={() => setArgStr(p.args)}>★ {p.name}</span>
              <i className="bi bi-x" onClick={() => deletePreset(p.name)} title={t("削除", "Delete")} />
            </span>
          ))}
        </div>
      )}
      <textarea
        className="cmd-input"
        rows={3}
        value={argStr}
        onChange={(e) => setArgStr(e.target.value)}
        spellCheck={false}
      />
      <div className="cmd-actions">
        <button className="primary-btn" onClick={run} disabled={loading}>
          {loading ? t("実行中…", "Running…") : t("実行", "Run")}
        </button>
        <input
          type="text"
          className="preset-name"
          placeholder={t("プリセット名", "Preset name")}
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
        />
        <button onClick={savePreset} disabled={!presetName.trim()}>
          {t("プリセット保存", "Save preset")}
        </button>
      </div>
      <p className="hint">
        {t("INPUT は解析対象ファイルのパスに置き換えてください。", "Replace INPUT with your file path.")}
      </p>

      {out !== null && (
        <>
          <h3>{t("標準出力", "stdout")}</h3>
          <pre className="raw-json">{out || t("（出力なし）", "(no output)")}</pre>
        </>
      )}
      {err && (
        <>
          <h3>{t("標準エラー", "stderr")}</h3>
          <pre className="cmd-stderr">{err}</pre>
        </>
      )}
    </div>
  );
}
