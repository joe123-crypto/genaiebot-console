import type { ActionCapabilities, WriteCapabilities } from "@/src/lib/types";

/**
 * Whether a control may change something, and if not, why -- in words a screen
 * can show beside the disabled control.
 *
 * Two parties have to agree before anything is written. The console has its own
 * switch (`CONSOLE_WRITES`), which is what keeps an unauthenticated console
 * read-only. The bot reports, through `overview.writes`, whether it holds a write
 * key and exactly which fields its writer accepts. Gating on the bot's own list
 * is what keeps this console from ever offering an edit the bot will refuse: a
 * field the writer does not know yet (captions, before their patch lands) simply
 * shows as unavailable, with the reason, instead of failing on save.
 *
 * Pure and free of server imports, so client components can call it with the
 * values their page passed down.
 */
export type WriteGate =
  | { allowed: true; warning?: string }
  | { allowed: false; reason: string };

export const READ_ONLY_REASON = "The console is in read-only mode.";
export const BOT_TOO_OLD_REASON =
  "This bot predates editing from the console. Deploy genaebot with console config writes to edit here.";
export const NO_WRITE_KEY_REASON =
  "The bot has no write key installed, so it cannot save changes yet.";
export const NOT_LIVE_WARNING =
  "Saved changes go to Firestore, but the campaigns still read membership.json, so they will not change what is sent.";

function botGate(consoleWrites: boolean, writes: WriteCapabilities | undefined): WriteGate {
  if (!consoleWrites) return { allowed: false, reason: READ_ONLY_REASON };
  // Absent means an older bot, and that is read as "cannot write" -- never as
  // "everything is writable".
  if (!writes) return { allowed: false, reason: BOT_TOO_OLD_REASON };
  if (!writes.enabled) return { allowed: false, reason: NO_WRITE_KEY_REASON };
  return writes.affectsProduction
    ? { allowed: true }
    : { allowed: true, warning: NOT_LIVE_WARNING };
}

/** Every one of `fields` must be writable: one change that touches several
 *  fields (removing an assignment touches three) is refused as a whole. */
export function canWrite(
  consoleWrites: boolean,
  writes: WriteCapabilities | undefined,
  collection: string,
  ...fields: string[]
): WriteGate {
  const gate = botGate(consoleWrites, writes);
  if (!gate.allowed) return gate;
  const accepted = new Set(writes?.fields[collection] ?? []);
  const missing = fields.filter((field) => !accepted.has(field));
  if (missing.length > 0) {
    return {
      allowed: false,
      reason: `The bot does not accept changes to ${missing.join(", ")} yet.`,
    };
  }
  return gate;
}

export function canDeleteCampaign(consoleWrites: boolean, writes: WriteCapabilities | undefined): WriteGate {
  const gate = botGate(consoleWrites, writes);
  if (!gate.allowed) return gate;
  if (!writes?.affectsProduction) return { allowed: false, reason: "Campaign deletion requires live Firestore configuration." };
  if (!writes.campaignDeletion?.delete) return { allowed: false, reason: writes.campaignDeletion?.reason ?? "Deploy the companion bot update for campaign deletion and picture cleanup." };
  return gate;
}

export function canEditSchedule(consoleWrites: boolean, writes: WriteCapabilities | undefined): WriteGate {
  const gate = botGate(consoleWrites, writes);
  if (!gate.allowed) return gate;
  if (!writes?.affectsProduction) return { allowed: false, reason: "Schedule editing requires live Firestore configuration." };
  if (!writes.scheduleEditing?.edit) return { allowed: false, reason: writes.scheduleEditing?.reason ?? "Deploy the companion bot update for schedule editing to save times here." };
  return gate;
}

export function canEditScheduleEntries(consoleWrites: boolean, writes: WriteCapabilities | undefined): WriteGate {
  const gate = canEditSchedule(consoleWrites, writes);
  if (!gate.allowed) return gate;
  return writes?.scheduleEditing?.entries ? gate : { allowed: false, reason: "Deploy the companion bot update for repeat, pause, skip and delete controls." };
}

export const NO_ACTIONS_REASON =
  "This bot cannot act on WhatsApp groups from the console yet. Deploy genaebot with console group actions to use this.";
export const ACTIONS_OFF_REASON =
  "Group actions are switched off on this bot.";

/**
 * Whether the bot will perform one of the group actions, and if not, why.
 *
 * Gated on `overview.actions` rather than `overview.writes`: leaving a WhatsApp
 * group and clearing a group's local records write no Firestore document, so
 * asking whether the bot holds a write key would hide a working control behind
 * a credential it does not use. Absent means an older bot, read as "cannot".
 */
export function canAct(
  consoleWrites: boolean,
  actions: ActionCapabilities | undefined,
  name: keyof ActionCapabilities,
): WriteGate {
  if (!consoleWrites) return { allowed: false, reason: READ_ONLY_REASON };
  if (!actions) return { allowed: false, reason: NO_ACTIONS_REASON };
  if (!actions[name]) return { allowed: false, reason: ACTIONS_OFF_REASON };
  return { allowed: true };
}

export function canDelete(
  consoleWrites: boolean,
  writes: WriteCapabilities | undefined,
  collection: string,
): WriteGate {
  const gate = botGate(consoleWrites, writes);
  if (!gate.allowed) return gate;
  if (!writes?.delete.includes(collection)) {
    return { allowed: false, reason: `The bot does not delete ${collection}.` };
  }
  return gate;
}

/** Creation must reach live config, assets and a registered schedule together. */
export function canCreateCampaign(consoleWrites: boolean, writes: WriteCapabilities | undefined): WriteGate {
  const gate = botGate(consoleWrites, writes);
  if (!gate.allowed) return gate;
  if (!writes?.affectsProduction) return { allowed: false, reason: "Campaign creation requires the bot to use live Firestore configuration." };
  const support = writes.campaignCreation;
  if (!support?.create || !support.scheduling) return { allowed: false, reason: "Deploy the companion bot update for campaign creation, pictures and scheduling." };
  if (!support.images) return { allowed: false, reason: "Campaign creation requires R2 images on the bot. Set GENAIE_AD_ASSETS_SOURCE=r2 and GENAIE_AD_ASSETS_BASE_URL to the bucket's public HTTPS URL." };
  return { allowed: true };
}
