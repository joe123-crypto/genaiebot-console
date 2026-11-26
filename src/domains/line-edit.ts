/**
 * A line's `number` is where every advert on that line sends customers, so it
 * is never typed in. The console only ever copies the number the linked
 * WhatsApp account itself reports, and only when the two differ.
 */

/** The number as the bot stores it: `+` and digits, or null when there are
 *  no digits at all. WhatsApp may report it with or without the `+`. */
export function normalizeNumber(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits ? `+${digits}` : null;
}

export function sameNumber(a: string | null | undefined, b: string | null | undefined) {
  return normalizeNumber(a) === normalizeNumber(b);
}

/** The number to offer as "use the linked number", or null when there is
 *  nothing to change -- no linked number, or it already matches. */
export function linkedNumberChange(configured: string | null | undefined, live: string | null | undefined) {
  const linked = normalizeNumber(live);
  if (!linked || sameNumber(configured, linked)) return null;
  return linked;
}

/** The id the first line is given. The screen does not ask for it and the
 *  configuration document is written under it, so both read it from here. */
export const FIRST_LINE_ID = "default";

/** What deciding whether to show a line needs to know about it. */
export type LineAccountState = {
  id: string;
  configured?: boolean;
  linked: boolean | null;
  number: string | null;
  pairingSessionId: string | null;
};

/**
 * A line the gateway invents rather than one the workspace has.
 *
 * A bot with no accounts configured still reports one, called `default`
 * (`accountIds` in genaebot's `console_accounts.mjs`), so a workspace that has
 * never made a line would otherwise open on a line it did not ask for.
 *
 * Every condition has to hold, and `configured` is compared to `false` rather
 * than read for truthiness: an older bot does not report it at all, and absent
 * means "cannot tell", which never hides anything. `linked: null` is the
 * gateway failing to read the saved login, not the absence of one.
 */
export function isPhantomLine(account: LineAccountState, configuredIds: ReadonlySet<string>) {
  return account.configured === false &&
    !configuredIds.has(account.id) &&
    account.linked === false &&
    !account.number &&
    !account.pairingSessionId;
}

/**
 * The lines to show, and the invented ones held back.
 *
 * The hidden rows are returned rather than dropped because they are the only
 * place a reason the gateway gives -- `startBlockedReason` -- can be read from
 * when there is no card to put it on.
 */
export function lineRows<T extends LineAccountState>(
  accounts: readonly T[] | undefined,
  configured: readonly { id: string }[] | undefined,
): { ids: string[]; hidden: T[] } {
  const configuredIds = new Set((configured ?? []).map((line) => line.id));
  const hidden = (accounts ?? []).filter((account) => isPhantomLine(account, configuredIds));
  const held = new Set(hidden.map((account) => account.id));
  const ids = [...new Set([
    ...(accounts ?? []).map((account) => account.id).filter((id) => !held.has(id)),
    ...configuredIds,
  ])];
  return { ids, hidden };
}
