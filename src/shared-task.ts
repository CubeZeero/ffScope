/** Share only in-flight work. Completed measurements are never silently reused here. */
export function createSharedTask<T, P = never>() {
  const pending = new Map<string, { promise: Promise<T>; listeners: Set<(value: P) => void>; last?: P; hasProgress: boolean }>();
  return (key: string, start: (emit: (value: P) => void) => Promise<T>, onProgress?: (value: P) => void): Promise<T> => {
    const existing = pending.get(key);
    if (existing) {
      if (onProgress) {
        existing.listeners.add(onProgress);
        if (existing.hasProgress) onProgress(existing.last!);
      }
      return existing.promise;
    }
    const listeners = new Set<(value: P) => void>(onProgress ? [onProgress] : []);
    const job = { promise: null as unknown as Promise<T>, listeners, last: undefined as P | undefined, hasProgress: false };
    // Defer invocation so even synchronous progress/reentrant calls see the registered task.
    job.promise = Promise.resolve().then(() => start(value => {
      job.last = value;
      job.hasProgress = true;
      listeners.forEach(listener => listener(value));
    })).finally(() => { pending.delete(key); listeners.clear(); });
    pending.set(key, job);
    return job.promise;
  };
}

/** Independent items run concurrently, with a fixed upper bound on external processes. */
export async function runPool<T>(items: readonly T[], concurrency: number, task: (item: T, index: number) => Promise<void>) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Invalid concurrency");
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index], index);
    }
  }));
}
