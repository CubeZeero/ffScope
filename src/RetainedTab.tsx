import { useEffect, useState, type ReactNode } from "react";

/** Start panels on first visit, then retain their work/state while hidden. */
export function RetainedTab({ active, children }: { active: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(active);
  useEffect(() => { if (active) setVisited(true); }, [active]);
  return <div style={{ display: active ? "block" : "none" }}>{(active || visited) && children}</div>;
}
