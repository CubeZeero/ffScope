import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moduleUrl } from "./load-ts-module.mjs";

const sharedUrl = moduleUrl("../src/shared-task.ts");
const { createSharedTask, runPool } = await import(sharedUrl);
const { RetainedTab } = await import(moduleUrl("../src/RetainedTab.tsx"));
const settle = () => new Promise(resolve => setImmediate(resolve));

test("concurrent consumers share work, receive progress and do not cache completed jobs", async () => {
  const run = createSharedTask();
  let calls = 0, emit, finish;
  const start = callback => { calls++; emit = callback; return new Promise(resolve => { finish = resolve; }); };
  const firstProgress = [], secondProgress = [];
  const first = run("same", start, value => firstProgress.push(value));
  await settle();
  emit(0.4);
  const second = run("same", start, value => secondProgress.push(value));
  assert.equal(first, second);
  assert.deepEqual(secondProgress, [0.4]);
  emit(1);
  finish("result");
  assert.deepEqual(await Promise.all([first, second]), ["result", "result"]);
  assert.equal(calls, 1);
  assert.deepEqual(firstProgress, [0.4, 1]);
  assert.deepEqual(secondProgress, [0.4, 1]);
  assert.equal(await run("same", async () => { calls++; return "new result"; }), "new result");
  assert.equal(calls, 2);
});

test("failed shared work can be retried; different parameters run independently", async () => {
  const run = createSharedTask();
  const failure = new Error("native failure");
  await assert.rejects(run("bad", () => Promise.reject(failure)), /native failure/);
  assert.equal(await run("bad", async () => "retry"), "retry");
  assert.deepEqual(await Promise.all([run("stream:0", async () => 0), run("stream:1", async () => 1)]), [0, 1]);
});

test("thumbnail pool bounds work and preserves each completion's original index", async () => {
  let active = 0, peak = 0;
  const results = [];
  const completed = [];
  await runPool([30, 1, 5, 1], 2, async (delay, index) => {
    active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, delay));
    results[index] = index;
    completed.push(index);
    active--;
  });
  assert.equal(peak, 2);
  assert.deepEqual(results, [0, 1, 2, 3]);
  assert.equal(completed[0], 1);
  assert.equal(completed.length, 4);
  await assert.rejects(runPool([], 0, async () => {}), /Invalid concurrency/);
});

test("unvisited tabs do not render or start their panel", () => {
  let mounts = 0;
  function Panel() { mounts++; return createElement("p", null, "panel"); }
  const render = active => renderToStaticMarkup(createElement(RetainedTab, { active }, createElement(Panel)));
  assert.equal(render(false).includes("panel"), false);
  assert.equal(mounts, 0);
  assert.equal(render(true).includes("panel"), true);
  assert.equal(mounts, 1);
});

const nativeStub = `data:text/javascript;base64,${Buffer.from('export class Channel {} export function invoke(command, args) { return globalThis.__performanceInvoke(command, args); }').toString("base64")}`;
const api = await import(moduleUrl("../src/ffprobe.ts", {
  "@tauri-apps/api/core": nativeStub,
  "./shared-task": sharedUrl,
  "./analysis-store": moduleUrl("../src/analysis-store.ts"),
  "./media-format": moduleUrl("../src/media-format.ts"),
}));

test("individual and overall loudness requests use one native process and share progress", async () => {
  const calls = [];
  let finish;
  globalThis.__performanceInvoke = (command, args) => {
    calls.push({ command, args });
    return new Promise(resolve => { finish = resolve; });
  };
  const firstProgress = [], overallProgress = [];
  const a = api.loudness("file.mp4", 1, 20, value => firstProgress.push(value));
  const b = api.loudness("file.mp4", 1, 20, value => overallProgress.push(value));
  await settle();
  assert.equal(calls.length, 1);
  calls[0].args.onProgress.onmessage(0.6);
  const result = { input_i: "-14", input_tp: "-1", input_lra: "2", input_thresh: "-24" };
  finish(result);
  assert.deepEqual(await Promise.all([a, b]), [result, result]);
  assert.deepEqual(firstProgress, [0.6]);
  assert.deepEqual(overallProgress, [0.6]);
});
