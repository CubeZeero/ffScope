import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moduleUrl } from "./load-ts-module.mjs";

const { loadSettings, loadRecent, writePreference } = await import(moduleUrl("../src/preferences.ts"));
const { ProgressBar } = await import(moduleUrl("../src/ProgressBar.tsx"));
const { humanBytes, humanDuration, humanBitrate, isStillImage } = await import(moduleUrl("../src/media-format.ts"));

test("malformed preferences cannot break startup or recent file rendering", () => {
  const values = new Map();
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  for (const raw of ["broken{", "null", "42", '"text"']) {
    values.set("ffscope-settings", raw);
    assert.equal(loadSettings().lang, "ja");
    values.set("ffscope-recent", raw);
    assert.deepEqual(loadRecent(), []);
  }
  values.set("ffscope-settings", JSON.stringify({ lang: "bad", thumbPercent: 150, ffprobePath: 12, ffmpegPath: "custom" }));
  assert.deepEqual(loadSettings(), { lang: "ja", thumbPercent: 100, ffprobePath: "", ffmpegPath: "custom" });
  values.set("ffscope-recent", JSON.stringify(["a", null, 123, "a", "", "b"]));
  assert.deepEqual(loadRecent(), ["a", "b"]);
});

test("unavailable storage keeps default/session settings usable", () => {
  globalThis.localStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); } };
  assert.equal(loadSettings().thumbPercent, 10);
  assert.deepEqual(loadRecent(), []);
  assert.doesNotThrow(() => writePreference("ffscope-theme", "dark"));
});

test("progress is clamped and unknown durations use accessible indeterminate bars", () => {
  const render = progress => renderToStaticMarkup(createElement(ProgressBar, { progress, label: "Scanning" }));
  assert.match(render(1.2), /aria-valuenow="100"/);
  assert.match(render(0.25), /width:25%/);
  for (const value of [-1, NaN, Infinity]) {
    assert.match(render(value), /indeterminate/);
    assert.doesNotMatch(render(value), /aria-valuenow|NaN|Infinity/);
  }
});

test("pure media formatting preserves duration and media classifications", () => {
  assert.equal(humanDuration(65.5), "1:05.500");
  assert.ok(humanBytes(1024).includes("KB"));
  assert.equal(humanBitrate(1_000_000), "1.00 Mb/s");
  assert.equal(isStillImage({ format: { format_name: "image2" }, streams: [{ index: 0, codec_type: "video", codec_name: "png" }] }), true);
  assert.equal(isStillImage({ format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "10" } }), false);
});
