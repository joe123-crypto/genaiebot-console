import type { Tracking } from "@/src/lib/types";

export function internationalNumber(value: string): string | undefined {
  const compact = value.trim().replace(/[\s().-]/g, "").replace(/^00/, "+");
  return /^\+?[1-9][0-9]{6,14}$/.test(compact) ? `+${compact.replace(/^\+/, "")}` : undefined;
}

export function trackingError(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Tracking settings could not be read.";
  const tracking = value as Record<string, unknown>;
  if (Object.entries(tracking).some(([key, text]) => !["prefix", "label", "number", "prefill", "link_line"].includes(key) || typeof text !== "string" || text.length > 1000)) return "Tracking settings contain an invalid value.";
  if (!Object.keys(tracking).length) return undefined;
  if (typeof tracking.prefix !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(tracking.prefix)) return "Tracking requires a valid reference prefix.";
  if (tracking.number && (typeof tracking.number !== "string" || !/^\+[1-9][0-9]{6,14}$/.test(tracking.number))) return "Use an international destination number.";
}

export function sameTracking(left: Tracking = {}, right: Tracking = {}) {
  return JSON.stringify(Object.entries(left).sort()) === JSON.stringify(Object.entries(right).sort());
}

export function whatsappLinks(text: string): string[] {
  const links = text.match(/https?:\/\/(?:wa\.me\/|api\.whatsapp\.com\/send\?)[^\s<>]+/gi) ?? [];
  return [...new Set(links.map((link) => link.replace(/[.,;:!?)\]>*_~]+$/, "")))];
}

/** The bot resolves this placeholder per group and registers its redirect. */
export function proposeTrackedLink(text: string, number: string, slug: string, name: string, tracking: Tracking = {}, replace?: string) {
  const normalized = internationalNumber(number);
  if (!normalized) throw new Error("Enter an international WhatsApp number, including its country code.");
  const nextTracking: Tracking = { ...tracking, prefix: tracking.prefix || slug, label: tracking.label ?? name, number: normalized };
  const caption = replace ? text.split(replace).join("{ref_link}")
    : text.includes("{ref_link}") ? text
    : `${text}${text ? text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n" : ""}👉 Tap to chat on WhatsApp: {ref_link}`;
  return { caption, tracking: nextTracking };
}
