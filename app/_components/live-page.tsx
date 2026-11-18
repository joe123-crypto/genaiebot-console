"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { liveFetch, useLivePoll } from "./use-live";
import type { LivePage, SyncStatus } from "@/src/lib/live-types";
import { displayStamp } from "@/src/lib/timezone";
import { useDisplayTimezone } from "@/app/_components/timezone-context";

export function SyncNotice({ sync, error }: { sync?: SyncStatus; error?: string | null }) {
  const zone = useDisplayTimezone();
  return error || sync?.stale ? <p className="banner" role="status">{error ?? (sync?.state === "awaiting-commit" ? "Waiting for saved changes to reach the display." : "Configuration is out of date.")}
    {sync?.syncedAt ? ` Last confirmed: ${displayStamp(sync.syncedAt, zone)}.` : " Synchronizing the display index…"}
    {" "}Your current data and drafts are kept.</p> : null;
}

export function useLivePage<T>(view: string, initial: LivePage<T> | null, query: string, rowKey: (row: T) => string,
  root: React.RefObject<HTMLElement | null>, initialError?: string, scrollRoot?: React.RefObject<HTMLElement | null>) {
  const [page, setPage] = useState(initial);
  const [rows, setRows] = useState<T[]>(initial?.rows ?? []);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [loading, setLoading] = useState(false);
  const state = useRef({ page, query, rows }); state.current = { page, query, rows };
  const epoch = useRef(0);
  const busy = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  const key = useRef(rowKey); key.current = rowKey;
  const initialQuery = useRef(query);
  const displayedQuery = useRef(query);
  const [refreshKey, setRefreshKey] = useState(0);
  const pendingScroll = useRef<{ element: HTMLElement; id?: string; top?: number; reset: boolean; generation: number } | null>(null);
  useLayoutEffect(() => {
    const pending = pendingScroll.current;
    pendingScroll.current = null;
    if (!pending || pending.generation !== epoch.current) return;
    if (pending.reset) { pending.element.scrollTop = 0; return; }
    const anchor = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-live-id]") ?? [])
      .find(row => row.dataset.liveId === pending.id);
    if (anchor && !anchor.closest("[hidden]") && pending.top !== undefined) pending.element.scrollTop += anchor.getBoundingClientRect().top - pending.top;
  }, [rows, root]);
  const request = useCallback(async (signal?: AbortSignal, more = false, reset = false) => {
    if (busy.current) return;
    busy.current = true; setLoading(true);
    const controller = new AbortController();
    inFlight.current = controller;
    const abort = () => controller.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) controller.abort();
    const generation = epoch.current;
    const current = state.current;
    const params = new URLSearchParams(current.query);
    const scroller = scrollRoot?.current;
    const queryChanged = displayedQuery.current !== current.query;
    // The cells are sticky; the thead itself scrolls out of view.
    const visibleTop = scroller ? Math.max(scroller.getBoundingClientRect().top, scroller.querySelector("thead th")?.getBoundingClientRect().bottom ?? 0) : 0;
    const visibleBottom = scroller?.getBoundingClientRect().bottom ?? Infinity;
    const anchor = root.current && !(scroller && queryChanged) ? Array.from(root.current.querySelectorAll<HTMLElement>("[data-live-id]"))
      .find(row => { const bounds = row.getBoundingClientRect(); return !row.closest("[hidden]") && bounds.bottom > visibleTop && bounds.top < visibleBottom; }) : undefined;
    const anchorId = anchor?.dataset.liveId;
    const anchorTop = anchor?.getBoundingClientRect().top;
    if (more && current.page?.nextCursor) params.set("cursor", current.page.nextCursor);
    else if (!reset) {
      if (current.page?.revision) params.set("since", current.page.revision);
      if (anchorId) params.set("anchor", anchorId);
    } else if (scroller && anchorId) params.set("anchor", anchorId);
    try {
      let data = await liveFetch<LivePage<T>>(view, params, controller.signal);
      if (data.reset) {
        const restart = new URLSearchParams(current.query);
        if (anchorId) restart.set("anchor", anchorId);
        data = await liveFetch<LivePage<T>>(view, restart, controller.signal);
      }
      if (controller.signal.aborted || generation !== epoch.current) return;
      setError(null);
      if (data.unchanged) { setPage(previous => previous ? { ...previous, sync: data.sync } : data); return; }
      displayedQuery.current = current.query;
      // Restore inside the committed DOM; a requestAnimationFrame can precede
      // React's concurrent update and measure the old rows.
      if (scroller && !more) pendingScroll.current = { element: scroller, id: anchorId, top: anchorTop, reset: queryChanged, generation };
      setPage(data);
      setRows(previous => more ? [...previous, ...(data.rows ?? []).filter(row => !previous.some(old => key.current(old) === key.current(row)))] : data.rows ?? []);
      if (!scroller && !more && !reset && anchorId && anchorTop !== undefined) requestAnimationFrame(() => {
        const next = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-live-id]") ?? []).find(row => row.dataset.liveId === anchorId);
        if (next) window.scrollBy(0, next.getBoundingClientRect().top - anchorTop);
      });
    } catch (reason) { if (!controller.signal.aborted && generation === epoch.current) setError(reason instanceof Error ? reason.message : "Updates unavailable."); }
    finally { signal?.removeEventListener("abort", abort); inFlight.current = null; busy.current = false; setLoading(false); }
  }, [view, root, scrollRoot]);
  useEffect(() => {
    const controller = new AbortController();
    epoch.current++;
    inFlight.current?.abort();
    if (initialQuery.current === query && refreshKey === 0 && initial?.rows) return;
    initialQuery.current = "\0";
    // Let a cancelled prior request release its slot before the new query runs.
    let disposed = false;
    async function run() {
      while (busy.current && !disposed) await new Promise(resolve => setTimeout(resolve, 10));
      if (!disposed) await request(controller.signal, false, true);
    }
    void run();
    return () => { disposed = true; controller.abort(); };
  }, [query, refreshKey, request]);
  useEffect(() => {
    function changed() { epoch.current++; inFlight.current?.abort(); setRefreshKey(value => value + 1); }
    window.addEventListener("genaie:changed", changed);
    return () => { epoch.current++; inFlight.current?.abort(); window.removeEventListener("genaie:changed", changed); };
  }, []);
  useLivePoll(signal => request(signal));
  return { page, rows, error, loading, loadMore: () => { if (page?.nextCursor) void request(undefined, true); },
    refresh: () => setRefreshKey(value => value + 1) };
}
