export const CUSTOMER_BOT_FIELDS = ["instructions"] as const;
export const CUSTOMER_BOT_TEXT_LIMIT = 16 * 1024;
export const CUSTOMER_BOT_LABELS = { instructions: "Reply instructions" };

export type CustomerBotField = typeof CUSTOMER_BOT_FIELDS[number];
export type CustomerBotText = Record<CustomerBotField, string>;
export type CustomerBotSource = { id: string; label: string; description: string };
/** Who the bot replies to on WhatsApp. "ref": only customers who have sent a campaign ref code. */
export const CUSTOMER_BOT_REPLY_MODES = ["everyone", "ref", "off"] as const;
export type CustomerBotReplyMode = typeof CUSTOMER_BOT_REPLY_MODES[number];
export type CustomerBotReplies = { mode: CustomerBotReplyMode; updatedAt: string | null; updatedBy: string | null };
export type CustomerBotVersion = CustomerBotText & {
  sources: CustomerBotSource[];
  revision: string;
  publishedAt: string | null;
  publishedBy: string | null;
  /** Absent: the bot is too old to choose. null: the bot could not read its setting. */
  replies?: CustomerBotReplies | null;
};

export function isCustomerBotReplyMode(value: unknown): value is CustomerBotReplyMode {
  return CUSTOMER_BOT_REPLY_MODES.includes(value as CustomerBotReplyMode);
}

export function isCustomerBotReplies(value: unknown): value is CustomerBotReplies {
  if (!value || typeof value !== "object") return false;
  const data = value as CustomerBotReplies;
  // A bot that has never saved one reports the default with no author.
  return isCustomerBotReplyMode(data.mode) && (data.updatedAt === null
    ? data.updatedBy === null
    : typeof data.updatedAt === "string" && Number.isFinite(Date.parse(data.updatedAt)) &&
      typeof data.updatedBy === "string" && Boolean(data.updatedBy));
}

/** The reply setting a bot reported, kept apart from the instructions it came with. */
export function customerBotReplies(value: unknown): CustomerBotReplies | null | undefined {
  if (!value || typeof value !== "object" || !("replies" in value)) return undefined;
  return isCustomerBotReplies(value.replies) ? value.replies : null;
}

export function customerBotText(value: CustomerBotText): CustomerBotText {
  const clean = (text: string) => text.replace(/\r\n?/g, "\n").trim();
  return { instructions: clean(value.instructions) };
}

export function sameCustomerBotText(a: CustomerBotText, b: CustomerBotText) {
  return CUSTOMER_BOT_FIELDS.every((key) => a[key] === b[key]);
}

export function isCustomerBotText(value: unknown): value is CustomerBotText {
  if (!value || typeof value !== "object" || "knowledge" in value) return false;
  const data = value as Partial<CustomerBotText>;
  return CUSTOMER_BOT_FIELDS.every((key) => typeof data[key] === "string");
}

export function isCustomerBotRevision(value: unknown): value is string {
  return typeof value === "string" && /^(?:default-[a-f0-9]{64}|[a-f0-9]{32})$/.test(value);
}

export function customerBotProblem(text: string, field: CustomerBotField) {
  const label = CUSTOMER_BOT_LABELS[field];
  if (!text.trim() || text.includes("\0")) return `${label} must contain text.`;
  if (/[\uD800-\uDFFF]/u.test(text)) return `${label} contains invalid characters.`;
  if (new TextEncoder().encode(text).byteLength > CUSTOMER_BOT_TEXT_LIMIT) return `${label} must be no larger than 16 KB.`;
  return null;
}

export function isCustomerBotVersion(value: unknown): value is CustomerBotVersion {
  if (!isCustomerBotText(value)) return false;
  const data = value as CustomerBotVersion;
  return Array.isArray(data.sources) && data.sources.length > 0 && data.sources.length <= 10 &&
    data.sources.every((source) => source && [source.id, source.label, source.description].every((text) => typeof text === "string" && text.length > 0 && text.length <= 500)) &&
    isCustomerBotRevision(data.revision) &&
    (data.revision.startsWith("default-")
      ? data.publishedAt === null && data.publishedBy === null
      : typeof data.publishedAt === "string" && Number.isFinite(Date.parse(data.publishedAt)) &&
        typeof data.publishedBy === "string" && Boolean(data.publishedBy)) &&
    CUSTOMER_BOT_FIELDS.every((key) => !customerBotProblem(data[key], key));
}
