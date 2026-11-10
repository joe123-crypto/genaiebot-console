"use server";

import { revalidatePath } from "next/cache";
import { BOT_TIMEZONE, OPERATOR_NAME, WRITES_ENABLED } from "@/src/config";
import { BotUnavailableError, WriteRefusedError, getCapabilities, getCampaigns, saveSchedule } from "@/src/lib/bot-client";
import { canEditSchedule } from "@/src/lib/write-capabilities";
import { failedWrite, type WriteOutcome } from "@/src/lib/write-outcome";
import type { ScheduleRequest, ScheduleSaveResult } from "@/src/lib/types";
import { isScheduleSaveResult } from "@/src/domains/schedule";

export type SaveScheduleOutcome = ({ ok: true } & ScheduleSaveResult) | Extract<WriteOutcome, { ok: false }>;

export async function saveScheduleAction(input: ScheduleRequest): Promise<SaveScheduleOutcome> {
  if (!WRITES_ENABLED) return { ok: false, detail: "The console is in read-only mode." };
  if (!input || typeof input !== "object" || typeof input.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.timezone !== BOT_TIMEZONE ||
      !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 100 ||
      new Set(input.changes.map((change) => change?.slug)).size !== input.changes.length ||
      input.changes.some((change) => !change || typeof change.slug !== "string" ||
        !/^[a-z0-9][a-z0-9-]{0,63}$/.test(change.slug) || change.slug === "new" ||
        typeof change.time !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(change.time) ||
        typeof change.expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(change.expectedRevision))) {
    return { ok: false, detail: "Invalid schedule change. Reload the latest times and try again." };
  }
  let attempted = false;
  try {
    const gate = canEditSchedule(WRITES_ENABLED, await getCapabilities());
    if (!gate.allowed) return { ok: false, detail: gate.reason };
    attempted = true;
    const result = await saveSchedule(input, { by: OPERATOR_NAME });
    return { ok: true, ...result };
  } catch (error) {
    // A lost reply can follow a committed change. Confirm it from live config
    // before letting the operator retry the same draft.
    const uncertain = attempted && error instanceof BotUnavailableError &&
      (!(error instanceof WriteRefusedError) || error.status >= 500);
    if (uncertain) {
      try {
        const current = await getCampaigns(input.date, { fresh: true });
        const campaigns = input.changes.map((change) => {
          const row = current.find((campaign) => campaign.slug === change.slug);
          const minutes = row?.scheduleMinutes !== undefined ? row.scheduleMinutes
            : row?.hour === null || row?.hour === undefined ? null : row.hour * 60 + (row.minute ?? 0);
          const [hour, minute] = change.time.split(":").map(Number);
          return row?.scheduleEdit && minutes === hour * 60 + minute ? { slug: row.slug, minutes, scheduleEdit: row.scheduleEdit } : null;
        });
        const result = { campaigns };
        if (isScheduleSaveResult(result, input)) return { ok: true, ...result };
      } catch { /* Keep the original unknown-outcome message and the draft. */ }
    }
    const failure = failedWrite(error) as Extract<WriteOutcome, { ok: false }>;
    return uncertain && failure.code !== "config_rate_limited"
      ? { ...failure, detail: `${failure.detail} Changes may have been saved; your draft is still here. Retry to check the latest times.` }
      : failure;
  } finally {
    for (const path of ["/schedule", "/", "/campaigns", ...input.changes.map(({ slug }) => `/campaigns/${slug}`)]) revalidatePath(path);
  }
}
