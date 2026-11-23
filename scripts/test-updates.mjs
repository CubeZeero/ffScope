import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";
import ts from "typescript";
import { generateManifest } from "./generate-update-manifest.mjs";

let sequence = 0;
async function service(mock) {
  globalThis.__ffscopeUpdateMocks = mock;
  const stubs = `
    export const check = async () => { const m=globalThis.__ffscopeUpdateMocks; m.calls++; if(m.error) throw m.error; return m.update ?? null; };
    export const invoke = async () => globalThis.__ffscopeUpdateMocks.platform ?? "macos";
    export const ask = async () => globalThis.__ffscopeUpdateMocks.approved ?? false;
    export const relaunch = async () => { globalThis.__ffscopeUpdateMocks.restarts++; };
  `;
  const stubUrl = `data:text/javascript;base64,${Buffer.from(stubs).toString("base64")}`;
  const { outputText } = ts.transpileModule(readFileSync(new URL("../src/updates.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText.replace(/from "[^"]+"/g, `from "${stubUrl}"`)).toString("base64")}#${++sequence}`);
}

test("portable ZIP uses manual updates and never calls the update API", async () => {
  const mock = { platform: "windows-portable", calls: 0, restarts: 0 };
  const api = await service(mock);
  await api.checkUpdates();
  assert.equal(api.getUpdateState().phase, "manual");
  assert.equal(mock.calls, 0);
});

test("installation requires approval and restart is a separate action", async () => {
  let installs = 0;
  const mock = { calls: 0, restarts: 0, approved: false, update: {
    version: "1.1.0", body: "Release notes", close: async () => {},
    downloadAndInstall: async cb => { installs++; cb({ event: "Started", data: { contentLength: 10 } }); cb({ event: "Progress", data: { chunkLength: 10 } }); cb({ event: "Finished" }); },
  } };
  const api = await service(mock);
  assert.equal(mock.calls, 0);
  await api.checkUpdates();
  assert.equal(api.getUpdateState().phase, "available");
  await api.installUpdate("Install?");
  assert.equal(installs, 0);
  mock.approved = true;
  await api.installUpdate("Install?");
  assert.equal(api.getUpdateState().phase, "installed");
  assert.equal(installs, 1);
  assert.equal(mock.restarts, 0);
  await api.restartUpdatedApp();
  assert.equal(mock.restarts, 1);
});

test("signature or download failure is not treated as installed", async () => {
  const mock = { calls: 0, restarts: 0, approved: true, update: { version: "1.1.0", close: async () => {}, downloadAndInstall: async () => { throw new Error("signature verification failed"); } } };
  const api = await service(mock);
  await api.checkUpdates(); await api.installUpdate("Install?");
  assert.equal(api.getUpdateState().phase, "error");
  await api.restartUpdatedApp();
  assert.equal(mock.restarts, 0);
});

test("manifest requires both platform assets, signatures and matching versions", () => {
  const directory = mkdtempSync(join(tmpdir(), "ffscope-manifest-test-"));
  try {
    for (const name of ["ffScope_v1.2.3_macos_arm64.app.tar.gz", "ffScope_v1.2.3_windows_x64_setup.exe"]) {
      writeFileSync(join(directory, name), "test artifact");
      writeFileSync(join(directory, `${name}.sig`), Buffer.from("test signature").toString("base64"));
    }
    const args = { directory, tag: "v1.2.3", repository: "CubeZeero/ffScope", version: "1.2.3", pubDate: "2026-11-23T00:00:00Z" };
    const manifest = generateManifest(args);
    assert.equal(manifest.version, "1.2.3");
    assert.ok(manifest.platforms["darwin-aarch64"].url.includes("/releases/download/v1.2.3/"));
    assert.ok(manifest.platforms["windows-x86_64"].url.endsWith("_setup.exe"));
    assert.throws(() => generateManifest({ ...args, version: "1.2.4" }));
    assert.throws(() => generateManifest({ ...args, tag: "v1.2.3-beta" }));
    writeFileSync(join(directory, "ffScope_v1.2.3_windows_x64_setup.exe.sig"), "");
    assert.throws(() => generateManifest(args));
  } finally { rmSync(directory, { recursive: true }); }
});
