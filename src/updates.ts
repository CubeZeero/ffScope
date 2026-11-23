import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";

export const RELEASES_URL = "https://github.com/CubeZeero/ffScope/releases/latest";
type Phase = "idle" | "checking" | "latest" | "available" | "confirming" | "downloading" | "installing" | "installed" | "error" | "manual";
export interface UpdateState { phase: Phase; version?: string; notes?: string; downloaded: number; total?: number; error?: string }
let state: UpdateState = { phase: "idle", downloaded: 0 };
let pending: Update | null = null;
const listeners = new Set<() => void>();
export const getUpdateState = () => state;
export function subscribeUpdates(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function set(patch: Partial<UpdateState>) { state = { ...state, ...patch }; listeners.forEach(fn => fn()); }
export const updateBusy = (phase: Phase) => ["checking", "confirming", "downloading", "installing"].includes(phase);

export async function checkUpdates() {
  if (updateBusy(state.phase) || state.phase === "installed") return;
  set({ phase: "checking", error: undefined, version: undefined, notes: undefined, downloaded: 0, total: undefined });
  try {
    if (pending) { await pending.close(); pending = null; }
    const platform = await invoke<string>("update_platform");
    if (platform === "windows-portable" || platform === "unsupported") { set({ phase: "manual" }); return; }
    pending = await check({ timeout: 20_000 });
    set(pending ? { phase: "available", version: pending.version, notes: pending.body } : { phase: "latest" });
  } catch (e) { set({ phase: "error", error: String(e).slice(0, 600) }); }
}

export async function installUpdate(prompt: string) {
  if (state.phase !== "available" || !pending) return;
  set({ phase: "confirming" });
  try {
    const approved = await ask(prompt, { title: "ffScope", kind: "warning" });
    if (!approved) { set({ phase: "available" }); return; }
    const update = pending;
    set({ phase: "downloading", downloaded: 0, total: undefined, error: undefined });
    await update.downloadAndInstall(event => {
      if (event.event === "Started") set({ total: event.data.contentLength });
      if (event.event === "Progress") set({ downloaded: state.downloaded + event.data.chunkLength });
      if (event.event === "Finished") set({ phase: "installing" });
    }, { timeout: 180_000 });
    set({ phase: "installed" });
    pending = null;
    await update.close().catch(() => {});
  } catch (e) {
    if (pending) { await pending.close().catch(() => {}); pending = null; }
    set({ phase: "error", error: String(e).slice(0, 600) });
  }
}

export async function restartUpdatedApp() {
  if (state.phase !== "installed") return;
  try { await relaunch(); }
  catch (e) { set({ error: String(e).slice(0, 600) }); }
}
