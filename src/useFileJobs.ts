import { useRef, useState, useSyncExternalStore } from "react";
import { createFileJobs } from "./file-jobs";
import { probeFile, type ProbeResult } from "./ffprobe";

export function useFileJobs(onSuccess?: (path: string, result: ProbeResult) => void) {
  const callback = useRef(onSuccess);
  callback.current = onSuccess;
  const [jobs] = useState(() => createFileJobs(probeFile, (path, result) => callback.current?.(path, result)));
  const files = useSyncExternalStore(jobs.subscribe, jobs.getSnapshot);
  return { ...jobs, files };
}
