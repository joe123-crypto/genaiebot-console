/**
 * The one config document a new workspace is given: `settings/defaults`.
 *
 * A workspace starts empty, and a bot with no `settings/defaults` can read
 * nothing: its config fails closed, so every send stops rather than guessing.
 * The document is copied from a template tree rather than invented here, so a
 * new workspace starts with the cap bands and tiers the running install uses.
 * This is what genaebot's `deploy/init-workspace.py` does, minus the lines.
 *
 * No line is seeded. A line is a WhatsApp account somebody logs into, not a
 * field to type in, and `/setup` asks for no number. The user links WhatsApp on
 * `/lines` afterwards, where the first line is called `default` and is given
 * its configuration document from the number that linked account reports
 * (`app/lines/actions:createLineAction`).
 *
 * Pure: the copy and every rule about it, with the Firestore reading and
 * writing in `src/lib/workspace-seed`.
 */

/** The bot stores its settings under this id (`operator_config.SETTINGS_DOC`). */
export const SETTINGS_DOC = "defaults";

/**
 * Values the bot's reader can decode.
 *
 * `operator_config.decode_value` raises on a timestamp, a reference, bytes and
 * a geopoint, and a settings document it cannot decode is `ConfigInvalid` --
 * which takes EVERY group out of sending, not just one. So nothing but plain
 * JSON-ish values is copied, and anything else is named rather than written.
 *
 * An integer outside the safe range is refused for the same reason: it would not
 * survive the trip back through JavaScript intact.
 */
function valueProblems(value: unknown, where: string): string[] {
  if (value === null || typeof value === "boolean" || typeof value === "string") return [];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return [`${where} is not a finite number`];
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) return [`${where} is too large a whole number`];
    return [];
  }
  if (Array.isArray(value)) return value.flatMap((item, index) => valueProblems(item, `${where}[${index}]`));
  // A Firestore Timestamp, DocumentReference, GeoPoint or Buffer all arrive as
  // objects; none has a plain prototype, and none of them can be decoded.
  if (value && typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return [`${where} is not a plain value`];
    return Object.entries(value as Record<string, unknown>)
      .flatMap(([key, item]) => valueProblems(item, `${where}.${key}`));
  }
  return [`${where} is not a value the bot can read`];
}

/**
 * Why this template cannot be copied, in operator terms. Empty means it can.
 *
 * `version` is checked because the bot's validator accepts only 1
 * (`promo_membership.validate`); seeding a document it would refuse would leave
 * the new bot as badly off as seeding nothing.
 */
export function settingsSeedProblems(template: unknown): string[] {
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    return ["the template settings document could not be read"];
  }
  const data = template as Record<string, unknown>;
  const problems = valueProblems(data, "settings");
  if (data.version !== 1) problems.push(`the template settings are version ${JSON.stringify(data.version)}, not 1`);
  return problems;
}

/**
 * The document to write.
 *
 * `contact_account` is removed. It names the line customers are sent to, and a
 * workspace with no lines has none -- the bot's validator treats it as optional
 * but requires it to name an account with a number when it is present, so
 * copying the template's would make the new workspace's config invalid.
 */
export function settingsSeed(template: Record<string, unknown>): Record<string, unknown> {
  const seed: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(template)) {
    if (name === "contact_account") continue;
    seed[name] = value;
  }
  return seed;
}
