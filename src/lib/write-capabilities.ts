import type { WriteCapabilities } from "@/src/lib/types";

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

/**
 * Why a campaign's delete button is there and switched off.
 *
 * The bot's writer removes groups and nothing else. For a campaign declared in
 * the manifest it says why: that campaign is a script, a cron and an installer
 * run rather than a record, and deleting its Firestore document would not even
 * take the row off the Campaigns table -- the row comes from the manifest, and
 * the document only carries the operator's switch, so a delete that "worked"
 * would hand the campaign back its default state. A campaign created from the
 * console is a record, and could be removed one day; the bot still does not,
 * and until it does this console must not pretend otherwise.
 *
 * The button is shown switched off rather than left out, the same way the
 * campaign pictures' add and remove are, so the gap is named where an operator
 * looks for it.
 */
export const CAMPAIGN_DELETE_NOT_BUILT =
  "Campaigns cannot be deleted from here yet. Turn it off instead: it then posts nothing, and its groups, copy and pictures stay as they are.";

/** Prefer the bot's own words. It reports, collection by collection, what its
 *  writer will delete; when campaigns are not on that list the reason it gives
 *  is the accurate one. If a bot ever does list them, the button still says
 *  something true rather than arming itself against nothing. */
export function campaignDeleteReason(gate: WriteGate) {
  return gate.allowed ? CAMPAIGN_DELETE_NOT_BUILT : gate.reason;
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
