import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl } from "./load-ts-module.mjs";

const { parseTheme, toggleTheme, isDarkTheme, themeStyle, composeTheme } = await import(moduleUrl("../src/theme.ts"));

test("existing theme preferences remain compatible", () => {
  assert.equal(parseTheme("dark"), "dark");
  assert.equal(parseTheme("light"), "light");
  assert.equal(parseTheme(null), "dark");
  assert.equal(parseTheme("invalid"), "dark");
});

test("light/dark toggles preserve the material style", () => {
  for (const [dark, light] of [["dark", "light"], ["glass-dark", "glass-light"], ["obsidian-dark", "obsidian-light"], ["matrix-dark", "matrix-light"]]) {
    assert.equal(toggleTheme(dark), light);
    assert.equal(toggleTheme(light), dark);
    assert.equal(isDarkTheme(dark), true);
    assert.equal(isDarkTheme(light), false);
    assert.equal(parseTheme(dark), dark);
    assert.equal(parseTheme(light), light);
  }
});

test("styles match both dark and light variants", () => {
  for (const theme of ["dark", "light"]) assert.equal(themeStyle(theme), "classic");
  for (const theme of ["glass-dark", "glass-light"]) assert.equal(themeStyle(theme), "glass");
  for (const theme of ["obsidian-dark", "obsidian-light"]) assert.equal(themeStyle(theme), "obsidian");
  for (const theme of ["matrix-dark", "matrix-light"]) assert.equal(themeStyle(theme), "matrix");
});

test("independent style and mode selections round-trip all themes", () => {
  for (const style of ["classic", "glass", "obsidian", "matrix"]) {
    for (const mode of ["dark", "light"]) {
      const theme = composeTheme(style, mode);
      assert.equal(themeStyle(theme), style);
      assert.equal(isDarkTheme(theme), mode === "dark");
      assert.equal(parseTheme(theme), theme);
    }
  }
});
