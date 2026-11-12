"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import {
  OPERATOR_NAME, TIMEZONE_COOKIE_MAX_AGE_SECONDS, TIMEZONE_COOKIE_NAME, WRITES_ENABLED,
} from "@/src/config";
import { isDisplayTimezone } from "@/src/lib/timezone";
import { getConfiguration, updateSettings } from "@/src/lib/bot-client";
import {
  capChange, capDraftProblems, storedSettings, type CapChange, type CapDraft,
} from "@/src/domains/cap-settings";
import { READ_ONLY_OUTCOME, failedWrite, type WriteOutcome } from "@/src/lib/write-outcome";

/**
 * Save the cap settings.
 *
 * `expected` is the settings as the form loaded them, in the bot's field names.
 * Only the fields this save changes are compared, so someone else's edit to an
 * unrelated setting does not block it, and a newer value in one it does change
 * is never written over unseen. Guarded here as well as in the UI: a server
 * action is a reachable POST, and the console has no login.
 */
export async function saveCapSettingsAction(draft: CapDraft, expected: Required<CapChange>): Promise<WriteOutcome> {
  if (!WRITES_ENABLED) return READ_ONLY_OUTCOME;
  if (!draft || typeof draft !== "object" || typeof draft.enabled !== "boolean" ||
      typeof draft.defaultActivity !== "string" || !draft.bands || typeof draft.bands !== "object" ||
      Object.values(draft.bands).some((pair) => !Array.isArray(pair) || pair.length !== 2 ||
        pair.some((value) => typeof value !== "string")) ||
      !expected || typeof expected !== "object" || typeof expected.caps_enabled !== "boolean" ||
      typeof expected.activity !== "string" || !expected.bands || typeof expected.bands !== "object" ||
      JSON.stringify(Object.keys(expected.bands).sort()) !== JSON.stringify(Object.keys(draft.bands).sort())) {
    return { ok: false, detail: "The change could not be read." };
  }

  try {
    const overview = await getConfiguration({ fresh: true });
    const settings = overview.capSettings;
    if (!settings) {
      return { ok: false, detail: "This bot predates editing cap settings from the console." };
    }
    const problems = capDraftProblems(draft, settings);
    if (problems.length > 0) return { ok: false, detail: "The settings were not saved.", problems };

    // What the operator changed is measured against what the form loaded, not
    // against the bot's settings now: a field they never touched must not look
    // edited just because someone else has since changed it.
    const loaded = { enabled: expected.caps_enabled, defaultActivity: expected.activity, bands: expected.bands };
    const change = capChange(draft, loaded);
    const fields = Object.keys(change) as (keyof CapChange)[];
    if (fields.length === 0) return { ok: true };
    const current = storedSettings(settings);
    if (fields.some((field) => JSON.stringify(expected[field]) !== JSON.stringify(current[field]))) {
      return { ok: false, detail: "The settings changed since this page loaded. Reload it to see the latest." };
    }
    await updateSettings(change, { by: OPERATOR_NAME });
  } catch (error) {
    return failedWrite(error);
  }
  // Caps decide what every campaign sends today, so every screen re-reads.
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Pick the clock the console is read on.
 *
 * Alone among the actions here it does not gate on `WRITES_ENABLED`: nothing
 * reaches the bot and nothing about a send changes. It sets a cookie on the
 * browser that asked, so a read-only console can still be read in Algiers time
 * and two operators can watch the same bot on different clocks.
 */
export async function setDisplayTimezoneAction(zone: string): Promise<WriteOutcome> {
  if (!isDisplayTimezone(zone)) return { ok: false, detail: "That is not one of the zones the console shows." };
  (await cookies()).set(TIMEZONE_COOKIE_NAME, zone, {
    maxAge: TIMEZONE_COOKIE_MAX_AGE_SECONDS,
    sameSite: "lax",
    path: "/",
  });
  // Times are server-rendered on every screen, so every screen re-reads.
  revalidatePath("/", "layout");
  return { ok: true };
}
