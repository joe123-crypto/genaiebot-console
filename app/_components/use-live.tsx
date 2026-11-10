"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export const LIVE_INTERVAL = 30_000;
export function useLivePoll(read: (signal: AbortSignal) => Promise<void>, enabled = true) {
  const callback = useRef(read);
  callback.current = read;
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout>;
    let active: AbortController | undefined;
    let disposed = false;
    let rerun = false;
    const available = () => document.visibilityState === "visible" && navigator.onLine;
    function schedule() { clearTimeout(timer); if (!disposed && available()) timer = setTimeout(run, LIVE_INTERVAL); }
    async function run() {
      clearTimeout(timer);
      if (disposed || !available() || active) return;
      active = new AbortController();
      try { await callback.current(active.signal); } catch { /* The resource owns its failure state. */ }
      finally { active = undefined; if (rerun && !disposed) { rerun = false; void run(); } else schedule(); }
    }
    function availability() {
      clearTimeout(timer);
      if (!available()) active?.abort(); else void run();
    }
    function changed() { if (active) { rerun = true; active.abort(); } else void run(); }
    schedule();
    document.addEventListener("visibilitychange", availability);
    window.addEventListener("online", availability);
    window.addEventListener("offline", availability);
    window.addEventListener("genaie:changed", changed);
    return () => { disposed = true; clearTimeout(timer); active?.abort();
      document.removeEventListener("visibilitychange", availability);
      window.removeEventListener("online", availability); window.removeEventListener("offline", availability);
      window.removeEventListener("genaie:changed", changed); };
  }, [enabled]);
}
export function useDebounced<T>(value: T, delay: number) {
  const [settled, setSettled] = useState(value);
  useEffect(() => { const timer = setTimeout(() => setSettled(value), delay); return () => clearTimeout(timer); }, [value, delay]);
  return settled;
}
export async function liveFetch<T>(view: string, query: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/live/${view}?${query}`, { cache: "no-store", signal });
  if (!response.ok) { const data = await response.json(); throw new Error(data.error || "Live updates unavailable."); }
  return response.json();
}
export function notifyLiveChange() { window.dispatchEvent(new Event("genaie:changed")); }

export function useVisibleIds(root: React.RefObject<HTMLElement | null>, key: string) {
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const rows = Array.from(element.querySelectorAll<HTMLElement>("[data-live-id]"));
    const visible = new Set<string>();
    if (typeof IntersectionObserver === "undefined") { setIds(rows.slice(0, 10).map(row => row.dataset.liveId!)); return; }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) { const id = (entry.target as HTMLElement).dataset.liveId!;
        if (entry.isIntersecting) visible.add(id); else visible.delete(id); }
      setIds([...visible]);
    });
    rows.forEach(row => observer.observe(row));
    return () => observer.disconnect();
  }, [root, key]);
  return ids;
}

export function LoadMore({ next, loading, load }: { next: string | null | undefined; loading: boolean; load: () => void }) {
  const sentinel = useRef<HTMLDivElement>(null);
  const callback = useRef(load); callback.current = load;
  useEffect(() => {
    if (!next || loading || !sentinel.current || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) callback.current(); }, { rootMargin: "100px" });
    observer.observe(sentinel.current); return () => observer.disconnect();
  }, [next, loading]);
  return <div ref={sentinel} className="card-pad">{next ? <button className="btn" disabled={loading} onClick={load}>{loading ? "Loading…" : "Load more"}</button> : null}</div>;
}
