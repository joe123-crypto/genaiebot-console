export const CUSTOMER_BOT_FIELDS = ["instructions", "knowledge"] as const;
export const CUSTOMER_BOT_TEXT_LIMIT = 16 * 1024;
export const CUSTOMER_BOT_LABELS = { instructions: "Reply instructions", knowledge: "Business knowledge" };

export type CustomerBotField = typeof CUSTOMER_BOT_FIELDS[number];
export type CustomerBotText = Record<CustomerBotField, string>;
export type CustomerBotVersion = CustomerBotText & {
  revision: string;
  publishedAt: string | null;
  publishedBy: string | null;
};

export function customerBotText(value: CustomerBotText): CustomerBotText {
  const clean = (text: string) => text.replace(/\r\n?/g, "\n").trim();
  return { instructions: clean(value.instructions), knowledge: clean(value.knowledge) };
}

export function sameCustomerBotText(a: CustomerBotText, b: CustomerBotText) {
  return CUSTOMER_BOT_FIELDS.every((key) => a[key] === b[key]);
}

export function isCustomerBotText(value: unknown): value is CustomerBotText {
  if (!value || typeof value !== "object") return false;
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
  return isCustomerBotRevision(data.revision) &&
    (data.revision.startsWith("default-")
      ? data.publishedAt === null && data.publishedBy === null
      : typeof data.publishedAt === "string" && Number.isFinite(Date.parse(data.publishedAt)) &&
        typeof data.publishedBy === "string" && Boolean(data.publishedBy)) &&
    CUSTOMER_BOT_FIELDS.every((key) => !customerBotProblem(data[key], key));
}
