"use client";
import { useEffect, useState, type ReactNode } from "react";
import { ConsoleShell } from "./console-shell";
import { liveFetch, useLivePoll } from "./use-live";
export function LiveShell({ children, operator }: { children: ReactNode; operator: { name: string; meta: string } }) {
  const [counts, setCounts] = useState<{ campaigns?: number; groupsNeedingReview?: number }>({});
  async function read(signal?: AbortSignal) {
    try { const data = await liveFetch<{ campaignTotal: number; groupsNeedingReview: number }>("navigation", new URLSearchParams(), signal);
      if (!signal?.aborted) setCounts({ campaigns: data.campaignTotal, groupsNeedingReview: data.groupsNeedingReview }); }
    catch { /* Preserve known counts; the view reports synchronization failures. */ }
  }
  useEffect(() => { const controller = new AbortController(); void read(controller.signal); return () => controller.abort(); }, []);
  useLivePoll(read);
  return <ConsoleShell counts={counts} operator={operator}>{children}</ConsoleShell>;
}
