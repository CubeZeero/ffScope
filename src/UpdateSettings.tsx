import { useEffect, useState, useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useT } from "./i18n";
import { checkUpdates, getUpdateState, installUpdate, RELEASES_URL, restartUpdatedApp, subscribeUpdates, updateBusy } from "./updates";

export function UpdateSettings() {
  const t = useT();
  const state = useSyncExternalStore(subscribeUpdates, getUpdateState);
  const [version, setVersion] = useState("");
  const [linkError, setLinkError] = useState("");
  useEffect(() => { getVersion().then(setVersion).catch(() => {}); }, []);
  const messages = {
    idle: t("ボタンを押すとGitHub Releasesへ更新情報を問い合わせます。", "Check GitHub Releases for updates."),
    checking: t("更新を確認中…", "Checking for updates…"), latest: t("現在のバージョンは最新です。", "You are up to date."),
    available: t("新しいバージョンがあります。", "An update is available."), confirming: t("インストールの確認待ち…", "Waiting for confirmation…"),
    downloading: t("署名付き更新パッケージをダウンロード中…", "Downloading signed update…"), installing: t("検証・インストール中…", "Verifying and installing…"),
    installed: t("更新しました。再起動すると新しいバージョンになります。", "Installed. Restart to use the new version."),
    error: t("更新を確認・適用できませんでした。更新情報が未公開、対象OS未対応、通信・署名・書き込み権限などを確認してください。", "Update failed. Check release availability, platform, network, signature and installation permissions."),
    manual: t("この環境は手動更新です。Windowsポータブル版はZIPを更新するか、セットアップ版をインストールしてください。", "Manual updates are required here. Update the portable ZIP or install the Windows setup version."),
  };
  const percent = state.total ? Math.min(100, Math.round(state.downloaded / state.total * 100)) : null;
  return <section className="update-settings"><h3>{t("ソフトウェア更新", "Software updates")}</h3>
    <p>{t("現在のバージョン", "Current version")}: {version || "…"}</p>
    <p className="hint">{t("GitHubの安定版リリースを利用します。更新パッケージは内蔵公開鍵で署名を検証し、不正な更新はインストールしません。自動送信・自動インストールはしません。", "Uses stable GitHub releases. The embedded public key verifies packages before installation. No automatic checks or installation.")}</p>
    <p role="status">{messages[state.phase]}{state.version && ` (v${state.version})`}</p>
    <div className="qc-actions">
      <button type="button" className="primary-btn" disabled={updateBusy(state.phase) || state.phase === "installed"} onClick={checkUpdates}><i className="bi bi-arrow-repeat" /> {t("更新を確認", "Check for updates")}</button>
      {state.phase === "available" && <button type="button" className="primary-btn" onClick={() => installUpdate(t("更新をダウンロードしてインストールします。進行中の解析・AI生成を終了し、必要な結果を保存してください。Windowsではインストーラー起動時にアプリが終了します。続けますか？", "Download and install this update? Finish analyses and AI requests, and save needed results first. Windows exits when launching the installer."))}>{t("更新をインストール", "Install update")}</button>}
      {state.phase === "installed" && <button type="button" className="primary-btn" onClick={restartUpdatedApp}>{t("再起動", "Restart")}</button>}
      <button type="button" className="icon-btn" onClick={() => openUrl(RELEASES_URL).catch(e => setLinkError(String(e)))}><i className="bi bi-github" /> GitHub Releases</button>
    </div>
    {(state.phase === "downloading" || state.phase === "installing") && <div className="frame-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined}><div className="progress-track"><div className={`progress-fill ${percent === null ? "indeterminate" : ""}`} style={percent === null ? undefined : { width: `${percent}%` }} /></div><span>{percent === null ? `${(state.downloaded / 1048576).toFixed(1)} MB` : `${percent}%`}</span></div>}
    {state.notes && <details><summary>{t("リリースノート", "Release notes")}</summary><pre className="update-notes">{state.notes}</pre></details>}
    {(state.error || linkError) && <details><summary>{t("エラー詳細", "Error details")}</summary><pre className="ai-error">{state.error || linkError}</pre></details>}
    <p className="hint">{t("設定を閉じても更新処理は継続します。初回は更新対応版を手動インストールする必要があります。", "Updates continue if settings is closed. Install an updater-enabled version manually the first time.")}</p>
  </section>;
}
