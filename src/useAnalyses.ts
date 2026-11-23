import { useSyncExternalStore } from "react";
import { getAnalyses, subscribeAnalyses } from "./analysis-store";
export function useAnalyses(path: string) {
  return useSyncExternalStore(subscribeAnalyses, () => getAnalyses(path));
}
