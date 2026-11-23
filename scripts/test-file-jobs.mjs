import assert from "node:assert/strict";
import { test } from "node:test";
import { moduleUrl } from "./load-ts-module.mjs";

const { createFileJobs } = await import(moduleUrl("../src/file-jobs.ts"));
const result = name => ({ data: { format: { filename: name } }, ffprobe_path: "ffprobe" });
const settle = () => new Promise(resolve => setImmediate(resolve));
function controlled() {
  const calls = [];
  const requests = [];
  return {
    calls, requests,
    probe(path) {
      calls.push(path);
      return new Promise((resolve, reject) => requests.push({ path, resolve, reject }));
    },
  };
}

test("file queues deduplicate pending/active paths and bound concurrent work", async () => {
  const work = controlled();
  const queue = createFileJobs(work.probe);
  queue.add(["a", "a", "b", "c"]);
  queue.add(["a", "c"]);
  assert.deepEqual(work.calls, ["a", "b"]);
  assert.equal(queue.getSnapshot().length, 3);
  work.requests[0].resolve(result("a"));
  await settle();
  assert.deepEqual(work.calls, ["a", "b", "c"]);
  work.requests[1].resolve(result("b"));
  work.requests[2].resolve(result("c"));
  await settle();
  assert.ok(queue.getSnapshot().every(file => !file.loading && file.result));
});

test("new single selection ignores older successes and errors", async () => {
  const work = controlled();
  const recent = [];
  const queue = createFileJobs(work.probe, path => recent.push(path));
  queue.replace("old");
  queue.replace("new");
  work.requests[1].resolve(result("new"));
  await settle();
  work.requests[0].reject(new Error("stale failure"));
  await settle();
  assert.equal(queue.getSnapshot()[0].path, "new");
  assert.equal(queue.getSnapshot()[0].error, null);
  assert.deepEqual(recent, ["new"]);
});

test("remove and re-add cannot publish a previous job for the same path", async () => {
  const work = controlled();
  const queue = createFileJobs(work.probe);
  queue.add(["same"]);
  queue.remove("same");
  queue.add(["same"]);
  work.requests[0].resolve(result("obsolete"));
  await settle();
  assert.equal(queue.getSnapshot()[0].loading, true);
  work.requests[1].resolve(result("current"));
  await settle();
  assert.equal(queue.getSnapshot()[0].result.data.format.filename, "current");
});

test("clear drops queued work and does not restore completed active work", async () => {
  const work = controlled();
  const queue = createFileJobs(work.probe, undefined, 1);
  queue.add(["active", "queued"]);
  queue.clear();
  work.requests[0].resolve(result("active"));
  await settle();
  assert.deepEqual(work.calls, ["active"]);
  assert.deepEqual(queue.getSnapshot(), []);
});

test("failed jobs release capacity; snapshots remain stable between mutations", async () => {
  const work = controlled();
  const queue = createFileJobs(work.probe, undefined, 1);
  let notifications = 0;
  const unsubscribe = queue.subscribe(() => notifications++);
  queue.add(["bad", "good"]);
  const initial = queue.getSnapshot();
  assert.equal(queue.getSnapshot(), initial);
  work.requests[0].reject(new Error("failure"));
  await settle();
  assert.equal(initial[0].loading, true);
  assert.equal(queue.getSnapshot()[0].error, "Error: failure");
  assert.deepEqual(work.calls, ["bad", "good"]);
  unsubscribe();
  const before = notifications;
  work.requests[1].resolve(result("good"));
  await settle();
  assert.equal(notifications, before);
});
