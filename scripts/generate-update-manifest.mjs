import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function generateManifest({ directory, tag, repository, version, pubDate = new Date().toISOString() }) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag) || tag.slice(1) !== version) throw new Error("Release tag must match the app's stable version (vX.Y.Z).");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error("Invalid GitHub repository");
  const platforms = {};
  for (const [platform, asset] of [
    ["darwin-aarch64", `ffScope_${tag}_macos_arm64.app.tar.gz`],
    ["windows-x86_64", `ffScope_${tag}_windows_x64_setup.exe`],
  ]) {
    if (basename(asset) !== asset || !existsSync(join(directory, asset))) throw new Error(`Missing update asset: ${asset}`);
    const signature = readFileSync(join(directory, `${asset}.sig`), "utf8").trim();
    if (!signature || !/^[A-Za-z0-9+/=\r\n]+$/.test(signature)) throw new Error(`Missing or malformed signature: ${asset}`);
    platforms[platform] = { signature, url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(asset)}` };
  }
  return { version, pub_date: pubDate, notes: `ffScope ${tag}\nSee GitHub Releases for details.`, platforms };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = resolve(process.argv[2] || "dist");
  const root = new URL("../", import.meta.url);
  const pkg = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const config = JSON.parse(readFileSync(new URL("src-tauri/tauri.conf.json", root), "utf8"));
  const cargo = readFileSync(new URL("src-tauri/Cargo.toml", root), "utf8");
  const cargoVersion = cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (pkg.version !== config.version || pkg.version !== cargoVersion) throw new Error("package.json, tauri.conf.json and Cargo.toml versions must match.");
  const manifest = generateManifest({ directory, tag: process.env.GITHUB_REF_NAME || "", repository: process.env.GITHUB_REPOSITORY || "CubeZeero/ffScope", version: pkg.version });
  writeFileSync(join(directory, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Created latest.json for ${manifest.version}`);
}
