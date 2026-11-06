"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

const REFRESH_INTERVAL_MS = 60_000;

/** Refresh the server-rendered page without exposing gateway credentials. */
export function AutoRefresh() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [paused, setPaused] = useState(false);
  const refreshing = useRef(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = document.visibilityState === "visible" && navigator.onLine;
    refreshing.current = isPending;
    setPaused(!active);

    function clearTimer() {
      clearTimeout(timer);
      timer = undefined;
    }

    function refresh() {
      clearTimer();
      if (!active || refreshing.current) return;
      // Guard synchronously: visibility and online events may arrive together.
      refreshing.current = true;
      startTransition(() => router.refresh());
    }

    function schedule() {
      clearTimer();
      if (active && !refreshing.current) {
        timer = setTimeout(refresh, REFRESH_INTERVAL_MS);
      }
    }

    function onAvailabilityChange() {
      const wasActive = active;
      active = document.visibilityState === "visible" && navigator.onLine;
      setPaused(!active);
      if (!active) clearTimer();
      else if (!wasActive) refresh();
    }

    // A pending transition removes the timer; completion starts a fresh minute.
    schedule();
    document.addEventListener("visibilitychange", onAvailabilityChange);
    window.addEventListener("online", onAvailabilityChange);
    window.addEventListener("offline", onAvailabilityChange);
    return () => {
      clearTimer();
      document.removeEventListener("visibilitychange", onAvailabilityChange);
      window.removeEventListener("online", onAvailabilityChange);
      window.removeEventListener("offline", onAvailabilityChange);
    };
  }, [isPending, router, startTransition]);

  return (
    <span className="console-refresh" role="status">
      {paused ? "Updates paused" : isPending ? "Updating…" : "Updates every 60s"}
    </span>
  );
}
