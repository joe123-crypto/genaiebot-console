"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { liveFetch, useLivePoll } from "./use-live";
import type { LivePage, SyncStatus } from "@/src/lib/live-types";

export function SyncNotice({ sync, error }: { sync?: SyncStatus; error?: string | null }) {
  return error || sync?.stale ? <p className="banner" role="status">{error ?? "Configuration is out of date."}
    {sync?.syncedAt ? ` Last confirmed: ${new Date(sync.syncedAt).toLocaleString()}.` : " Synchronizing the display index…"}
    {" "}Your current data and drafts are kept.</p> : null;
}

export function useLivePage<T>(view: string, initial: LivePage<T> | null, query: string, rowKey: (row: T) => string,
  root: React.RefObject<HTMLElement | null>, initialError?: string) {
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
  const [refreshKey, setRefreshKey] = useState(0);
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
    const anchor = root.current ? Array.from(root.current.querySelectorAll<HTMLElement>("[data-live-id]"))
      .find(row => row.getBoundingClientRect().bottom > 0) : undefined;
    const anchorId = anchor?.dataset.liveId;
    const anchorTop = anchor?.getBoundingClientRect().top;
    if (more && current.page?.nextCursor) params.set("cursor", current.page.nextCursor);
    else if (!reset) {
      if (current.page?.revision) params.set("since", current.page.revision);
      if (anchorId) params.set("anchor", anchorId);
    }
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
      setPage(data);
      setRows(previous => more ? [...previous, ...(data.rows ?? []).filter(row => !previous.some(old => key.current(old) === key.current(row)))] : data.rows ?? []);
      if (!more && !reset && anchorId && anchorTop !== undefined) requestAnimationFrame(() => {
        const next = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-live-id]") ?? []).find(row => row.dataset.liveId === anchorId);
        if (next) window.scrollBy(0, next.getBoundingClientRect().top - anchorTop);
      });
    } catch (reason) { if (!controller.signal.aborted && generation === epoch.current) setError(reason instanceof Error ? reason.message : "Updates unavailable."); }
    finally { signal?.removeEventListener("abort", abort); inFlight.current = null; busy.current = false; setLoading(false); }
  }, [view, root]);
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
