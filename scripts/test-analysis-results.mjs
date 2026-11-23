import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moduleUrl } from "./load-ts-module.mjs";

const { AnalysisResult } = await import(moduleUrl("../src/AnalysisResult.tsx", {
  "./i18n": moduleUrl("../src/i18n.tsx"),
  "./analysis-store": moduleUrl("../src/analysis-store.ts"),
  "./analysis-labels": moduleUrl("../src/analysis-labels.ts"),
}));
const render = (kind, summary, extra = {}) => renderToStaticMarkup(createElement(AnalysisResult, {
  record: { id: kind, kind, summary, status: "complete", streamIndex: 0, generation: 1, updatedAt: "2026-11-23T00:00:00Z", ...extra },
}));

test("overall results use readable labels and units, not JSON keys", () => {
  const html = render("bitrate", { avg: 6_000_000, peak: 12_000_000, packet_count: 2500 });
  assert.ok(html.includes("平均ビットレート"));
  assert.ok(html.includes("6 Mb/s"));
  assert.ok(html.includes("12 Mb/s"));
  assert.ok(html.includes("2,500"));
  assert.equal(html.includes("packet_count"), false);
  assert.equal(html.includes("<pre>"), false);
});

test("frame distribution includes percentages and audio displays negative infinity safely", () => {
  assert.ok(render("frames", { i: 25, p: 50, b: 25, total: 100 }).includes("25 (25%)"));
  const audio = render("loudness", { input_i: null, input_tp: null, silent: true, true_peak_negative_infinity: true });
  assert.ok(audio.includes("−∞ LUFS"));
  assert.ok(audio.includes("−∞ dBTP"));
  assert.equal(audio.includes("NaN"), false);
});

test("errors and capped candidate samples are not presented as a clean scan", () => {
  const failure = render("integrity", {}, { status: "error" });
  assert.ok(failure.includes("実行失敗"));
  assert.ok(failure.includes("判定できません"));
  const anomaly = render("anomaly", { candidates: 2000, truncated: true }, { points: [{ frame: 24, time: 1, score: 0.2 }] });
  assert.ok(anomaly.includes("要確認"));
  assert.ok(anomaly.includes("保存上限"));
  assert.ok(anomaly.includes("#24"));
  assert.ok(anomaly.includes("<table"));
});
