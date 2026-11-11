"use client";
import { useEffect, useRef, useState } from "react";
import { EntryTimeline } from "./entry-timeline";
import { ScheduleCounts } from "./schedule-counts";
import { canEditSchedule, canEditScheduleEntries } from "@/src/lib/write-capabilities";
import { minutesOfDay } from "@/src/lib/format";
import { SyncNotice } from "@/app/_components/live-page";
import { liveFetch, useLivePoll } from "@/app/_components/use-live";
import type { LiveSchedule } from "@/src/lib/live-types";

export function LiveScheduleView({ initial, initialError, writable }: { initial: LiveSchedule | null; initialError?: string; writable: boolean }) {
  const [data, setData] = useState(initial);
  const [error, setError] = useState<string | null>(initialError ?? null);
  const [now, setNow] = useState<number | null>(null);
  const latest = useRef(data); latest.current = data;
  useEffect(() => { const update = () => setNow(minutesOfDay(new Date(), data?.timezone)); update();
    const timer = setInterval(update, 15_000); return () => clearInterval(timer); }, [data?.timezone]);
  async function read(signal?: AbortSignal) {
    const query = new URLSearchParams();
    if (latest.current?.revision) query.set("since", latest.current.revision);
    try { const next = await liveFetch<LiveSchedule>("schedule", query, signal);
      if (signal?.aborted) return;
      setData(previous => next.unchanged && previous ? { ...previous, sync: next.sync } : next); setError(null);
    } catch (reason) { if (!signal?.aborted) setError(reason instanceof Error ? reason.message : "Schedule updates unavailable."); }
  }
  useEffect(() => { if (initial) return; const controller = new AbortController(); void read(controller.signal); return () => controller.abort(); }, [initial]);
  useLivePoll(read);
  const gate = canEditSchedule(writable, data?.writes);
  const entryGate = canEditScheduleEntries(writable, data?.writes);
  return <><SyncNotice sync={data?.sync} error={error} />{data?.slots && data.date && data.timezone ?
    <EntryTimeline slots={data.slots} nowMinutes={now ?? 0} timezone={data.timezone} date={data.date}
      saveUnavailableReason={gate.allowed ? undefined : gate.reason}
      entriesUnavailableReason={entryGate.allowed ? undefined : entryGate.reason}
      summary={<ScheduleCounts campaignsToday={new Set(data.slots.map((slot) => slot.slug)).size} />} /> : <p role="status">Loading the live schedule…</p>}</>;
}
