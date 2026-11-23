import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl } from "./load-ts-module.mjs";
const { DEFAULT_SPEC, evaluateDelivery, validateSpec } = await import(moduleUrl("../src/delivery.ts"));
const { beginAnalysis, completeAnalysis, trackAnalysis, getAnalyses, aiAnalysisAttachments, analysisNeedsReview } = await import(moduleUrl("../src/analysis-store.ts"));
const media = { streams: [
  { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001" },
  { index: 1, codec_type: "audio", codec_name: "aac", sample_rate: "48000", channels: 2 },
] };

test("delivery treats unmeasured loudness as unknown, never pass", () => {
  const verdicts = evaluateDelivery(media, DEFAULT_SPEC, []);
  assert.equal(verdicts.find(v => v.code === "lufs").status, "unknown");
  assert.equal(verdicts.find(v => v.code === "true_peak").status, "unknown");
  assert.equal(verdicts.find(v => v.code === "fps").status, "pass");
});
test("delivery uses measured tolerances and distinguishes stream results", () => {
  const records = [{ kind: "loudness", streamIndex: 1, status: "complete", summary: { input_i: -14.5, input_tp: -1.2 } }];
  assert.ok(evaluateDelivery(media, DEFAULT_SPEC, records).every(v => v.status === "pass"));
  const extra = { streams: [...media.streams, { index: 2, codec_type: "audio", codec_name: "pcm_s24le", sample_rate: "44100", channels: 1 }] };
  const results = evaluateDelivery(extra, DEFAULT_SPEC, records);
  assert.equal(results.find(v => v.code === "sample_rate" && v.stream === 2).status, "fail");
  assert.equal(results.find(v => v.code === "lufs" && v.stream === 2).status, "unknown");
});
test("fractional fps is not silently treated as integer fps; silent loudness fails", () => {
  const results = evaluateDelivery(media, { ...DEFAULT_SPEC, fps: "30" }, [{ kind: "loudness", streamIndex: 1, status: "complete", summary: { input_i: null, input_tp: null, silent: true, true_peak_negative_infinity: true } }]);
  assert.equal(results.find(v => v.code === "fps").status, "fail");
  assert.equal(results.find(v => v.code === "lufs").status, "fail");
  assert.equal(results.find(v => v.code === "true_peak").status, "pass");
  assert.equal(validateSpec({ ...DEFAULT_SPEC, fps: "0/0" }), "fps");
  assert.equal(validateSpec({ ...DEFAULT_SPEC, tolerance: -1 }), "tolerance");
});
test("missing required streams fail; unspecified criteria skip", () => {
  assert.equal(evaluateDelivery({ streams: [] }, DEFAULT_SPEC, [])[0].status, "fail");
  const results = evaluateDelivery(media, { ...DEFAULT_SPEC, fps: "", lufs: null, truePeak: null }, []);
  assert.equal(results.find(v => v.code === "fps").status, "skip");
  assert.equal(results.find(v => v.code === "lufs").status, "skip");
});
test("registry ignores stale completions and excludes logs from AI attachments", () => {
  const path = "test-registry";
  const old = beginAnalysis(path, "integrity");
  const current = beginAnalysis(path, "integrity");
  completeAnalysis(path, old, { ok: true, error_count: 0 });
  assert.equal(getAnalyses(path)[0].status, "running");
  completeAnalysis(path, current, { ok: false, error_count: 1, errors: ["private/path/file.mp4"] });
  const record = getAnalyses(path)[0];
  assert.equal(analysisNeedsReview(record), true);
  const injected = { ...record, summary: { ...record.summary, private_field: 123, log: "private-file" } };
  const safe = JSON.stringify(aiAnalysisAttachments([injected], [record.id]));
  assert.equal(safe.includes("private"), false);
  assert.ok(safe.includes('"error_count":1'));
  assert.equal(aiAnalysisAttachments([record], []).length, 0);
});
test("failed analyses cannot be attached as completed results", async () => {
  await assert.rejects(trackAnalysis("test-error", "bitrate", 0, async () => { throw new Error("private-path"); }));
  const result = getAnalyses("test-error");
  assert.equal(result[0].status, "error");
  assert.equal(aiAnalysisAttachments(result, [result[0].id]).length, 0);
});
