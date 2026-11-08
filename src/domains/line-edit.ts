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
