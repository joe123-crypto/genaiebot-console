"use client";
import { useEffect } from "react";

/**
 * Poll after each completed read; hidden/offline tabs do no background work.
 *
 * `useLivePoll` is the console's 30-second heartbeat for screens showing the
 * bot's state. This is the other kind of waiting: an operation the user is
 * watching finish -- a WhatsApp pairing, a bot being created -- where the
 * interval is the caller's to choose and seconds matter.
 */
export function usePolling(read: () => Promise<void>, interval: number, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let active = document.visibilityState === 'visible' && navigator.onLine;
    async function tick() {
      if (stopped || running || !active) return;
      running = true;
      await read();
      running = false;
      if (!stopped && active) timer = setTimeout(tick, interval);
    }
    function availability() {
      const previous = active;
      active = document.visibilityState === 'visible' && navigator.onLine;
      if (!active) clearTimeout(timer);
      else if (!previous) void tick();
    }
    void tick();
    document.addEventListener('visibilitychange', availability);
    window.addEventListener('online', availability);
    window.addEventListener('offline', availability);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', availability);
      window.removeEventListener('online', availability);
      window.removeEventListener('offline', availability);
    };
  }, [read, interval, enabled]);
}
