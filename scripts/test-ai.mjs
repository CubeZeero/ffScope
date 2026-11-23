import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl } from "./load-ts-module.mjs";

const { sanitizeAiMetadata } = await import(moduleUrl("../src/ai-context.ts"));

test("AI attachment excludes file paths, tags, titles and non-allowlisted fields", () => {
  const input = {
    format: { filename: "/private/secret.mp4", format_name: "mov,mp4", duration: "12", tags: { title: "private-title" } },
    streams: [{ index: 0, codec_type: "video", codec_name: "h264", width: 1920,
      tags: { title: "private-stream-title" }, extra_data: "private-data" }],
    chapters: [{ tags: { title: "private-chapter" } }], programs: [{ filename: "private-program" }],
  };
  const safe = sanitizeAiMetadata(input);
  assert.equal(safe.format.format_name, "mov,mp4");
  assert.equal(safe.streams[0].codec_name, "h264");
  assert.equal(safe.streams[0].width, 1920);
  assert.equal(JSON.stringify(safe).includes("private"), false);
  assert.equal(input.format.filename, "/private/secret.mp4");
});

test("AI attachment bounds stream count and free-form field lengths", () => {
  const safe = sanitizeAiMetadata({ streams: Array.from({ length: 100 }, (_, index) => ({ index, codec_name: "x".repeat(2000), width: Infinity })) });
  assert.equal(safe.streams.length, 64);
  assert.equal(safe.streams[0].codec_name.length, 120);
  assert.equal(safe.streams[0].width, undefined);
});
