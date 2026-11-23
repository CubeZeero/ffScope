import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { moduleUrl } from "./load-ts-module.mjs";

const i18n = moduleUrl("../src/i18n.tsx");
const { AiMarkdown } = await import(moduleUrl("../src/AiMarkdown.tsx", { "./i18n": i18n }));
const render = text => renderToStaticMarkup(createElement(AiMarkdown, { text }));

test("AI answers render headings, emphasis, lists, GFM tables and code blocks", () => {
  const html = render("## Result\n\n**Warning** and `h264`.\n\n- First\n- Second\n\n| Key | Value |\n| --- | --- |\n| FPS | 24 |\n\n```bash\nffmpeg -i input.mp4 output.mp4\n```\n");
  for (const tag of ["<h2>", "<strong>", "<ul>", "<table>", "<pre>", '<code class="language-bash">']) assert.ok(html.includes(tag), tag);
  assert.ok(html.includes("bi-clipboard"));
  assert.ok(html.includes("ffmpeg -i input.mp4 output.mp4"));
});

test("AI markup never executes HTML, loads remote images or links executable URLs", () => {
  const html = render('<script>alert(1)</script>\n\n<img src="https://example.com/raw.png" onerror="alert(1)">\n\n![tracking](https://example.com/pixel.png)\n\n[bad](javascript:alert%281%29)\n\n[credential](https://user:password@example.com)\n\n[good](https://example.com/docs)');
  assert.equal(html.includes("<script"), false);
  assert.equal(html.includes("<img"), false);
  assert.equal(html.includes("javascript:"), false);
  assert.equal(html.includes("onerror="), false);
  assert.equal(html.includes("user:password"), false);
  assert.ok(html.includes('href="https://example.com/docs"'));
});

test("unfinished streamed code fences still render readable code", () => {
  const html = render("```bash\nffmpeg -i input.mp4");
  assert.ok(html.includes("<pre>"));
  assert.ok(html.includes("ffmpeg -i input.mp4"));
});
