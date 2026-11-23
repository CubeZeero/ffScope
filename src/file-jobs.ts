import type { FileState } from "./file-state";
import type { ProbeResult } from "./ffprobe";

interface Job { path: string; state: FileState }

/** Bounded probing queue. Removed/replaced jobs can finish but cannot publish stale results. */
export function createFileJobs(
  probe: (path: string) => Promise<ProbeResult>,
  onSuccess?: (path: string, result: ProbeResult) => void,
  concurrency = 2,
) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency");
  const jobs = new Map<string, Job>();
  const listeners = new Set<() => void>();
  let queue: Job[] = [];
  let active = 0;
  let snapshot: FileState[] = [];
  function publish() {
    snapshot = Array.from(jobs.values(), job => job.state);
    listeners.forEach(listener => listener());
  }
  function current(job: Job) { return jobs.get(job.path) === job; }
  async function execute(job: Job) {
    try {
      const result = await probe(job.path);
      if (current(job)) {
        job.state = { path: job.path, result, error: null, loading: false };
        publish();
        onSuccess?.(job.path, result);
      }
    } catch (error) {
      if (current(job)) {
        job.state = { path: job.path, result: null, error: String(error), loading: false };
        publish();
      }
    } finally {
      active--;
      pump();
    }
  }
  function pump() {
    while (active < concurrency && queue.length) {
      const job = queue.shift()!;
      if (!current(job)) continue;
      active++;
      void execute(job);
    }
  }
  function add(paths: string[]) {
    let changed = false;
    for (const path of paths) {
      if (!path || jobs.has(path)) continue;
      const job: Job = { path, state: { path, result: null, error: null, loading: true } };
      jobs.set(path, job);
      queue.push(job);
      changed = true;
    }
    if (changed) { publish(); pump(); }
  }
  function clear() { jobs.clear(); queue = []; publish(); }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    add,
    replace(path: string) { jobs.clear(); queue = []; add([path]); },
    remove(path: string) {
      if (!jobs.delete(path)) return;
      queue = queue.filter(job => current(job));
      publish();
    },
    clear,
  };
}
