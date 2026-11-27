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

const WHATSAPP_URL = /https?:\/\/(?:wa\.me\/|api\.whatsapp\.com\/send\?)[^\s<>]+/gi;
function withoutTrailingPunctuation(url: string) {
  return url.replace(/[.,;:!?)\]>*_~]+$/, "");
}

export function whatsappLinks(text: string): string[] {
  return [...new Set((text.match(WHATSAPP_URL) ?? []).map(withoutTrailingPunctuation))];
}

/** A tracked link goes through the bot's click redirect, which is a web page.
 *  A direct ref link is the same wa.me link, with the group's ref in its
 *  prefilled text, but the bot never wraps it: it opens on WhatsApp-only data
 *  bundles, and its taps are not counted. */
export type CaptionLinkKind = "tracked" | "direct";

export const LINK_PLACEHOLDER: Record<CaptionLinkKind, string> = { tracked: "{ref_link}", direct: "{direct_ref_link}" };
const LINK_LINE: Record<CaptionLinkKind, string> = {
  tracked: "👉 Tap to chat on WhatsApp: {ref_link}",
  direct: "📲 No data? Chat on WhatsApp: {direct_ref_link}",
};

/** The bot resolves the placeholder per group, with the group's ref code. */
export function proposeTrackedLink(text: string, number: string, slug: string, name: string, tracking: Tracking = {}, replace?: string, kind: CaptionLinkKind = "tracked") {
  const normalized = internationalNumber(number);
  if (!normalized) throw new Error("Enter an international WhatsApp number, including its country code.");
  const nextTracking: Tracking = { ...tracking, prefix: tracking.prefix || slug, label: tracking.label ?? name, number: normalized };
  const placeholder = LINK_PLACEHOLDER[kind];
  const caption = replace ? text.replace(WHATSAPP_URL, (matched) => {
      const url = withoutTrailingPunctuation(matched);
      return url === replace ? `${placeholder}${matched.slice(url.length)}` : matched;
    })
    : text.includes(placeholder) ? text
    : `${text}${text ? text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n" : ""}${LINK_LINE[kind]}`;
  return { caption, tracking: nextTracking };
}
