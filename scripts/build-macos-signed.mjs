import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

if (process.platform !== "darwin") throw new Error("This build command requires macOS.");
const root = fileURLToPath(new URL("../", import.meta.url));
const localKey = fileURLToPath(new URL("../.signing/updater.key", import.meta.url));
const key = process.env.TAURI_SIGNING_PRIVATE_KEY || (existsSync(localKey) ? localKey : "");
if (!key) throw new Error("Updater signing key missing. Configure TAURI_SIGNING_PRIVATE_KEY; do not generate a replacement key for an existing release.");
const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/@tauri-apps/cli/tauri.js", import.meta.url)), "build", "--config", "src-tauri/tauri.macos-signed.conf.json", ...process.argv.slice(2)], {
  cwd: root, stdio: "inherit", env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
