import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl } from "./load-ts-module.mjs";

const { LruCache } = await import(moduleUrl("../src/cache.ts"));

test("evicts the least recently used entry", () => {
  const cache = new LruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.get("a"), 1);
  cache.set("c", 3);
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
});

test("replacing an entry refreshes recency without evicting another", () => {
  const cache = new LruCache(2);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("a", 3);
  assert.equal(cache.get("b"), 2);
  assert.equal(cache.get("a"), 3);
});

test("retains falsy values and rejects invalid capacities", () => {
  const cache = new LruCache(2);
  cache.set("zero", 0);
  cache.set("empty", "");
  assert.equal(cache.get("zero"), 0);
  assert.equal(cache.get("empty"), "");
  assert.equal(cache.has("missing"), false);
  for (const capacity of [0, -1, 1.5, NaN]) assert.throws(() => new LruCache(capacity));
});
