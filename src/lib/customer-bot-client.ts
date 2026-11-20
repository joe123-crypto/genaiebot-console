import { BOT_API_BASE_URL, BOT_API_TOKEN } from "@/src/config";
import { isCustomerBotVersion, type CustomerBotText, type CustomerBotVersion } from "./customer-bot-types";

type Result =
  | { kind: "live"; live: CustomerBotVersion }
  | { kind: "conflict"; live: CustomerBotVersion }
  | { kind: "error"; detail: string }
  | { kind: "unknown" };

export async function customerBotRequest(publish?: CustomerBotText & { expectedRevision: string; actor: string }): Promise<Result> {
  if (!BOT_API_BASE_URL || !BOT_API_TOKEN) {
    return { kind: "error", detail: "Connect the console to the live bot API to load its customer instructions." };
  }
  // Pin the read and publish to the same live gateway, as with account actions.
  // A general config write override must never send this draft to another bot.
  try {
    const response = await fetch(`${BOT_API_BASE_URL.replace(/\/+$/, "")}/internal/console/customer-bot`, {
      method: publish ? "POST" : "GET",
      headers: { accept: "application/json", authorization: `Bearer ${BOT_API_TOKEN}`,
        ...(publish ? { "content-type": "application/json" } : {}) },
      ...(publish ? { body: JSON.stringify(publish) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404 || response.status === 405) {
      return { kind: "error", detail: "This bot version does not support the Customer Bot editor yet." };
    }
    if (response.status === 401 || response.status === 403) {
      return { kind: "error", detail: "The bot API rejected the console credentials." };
    }
    if (response.ok || response.status === 409 || response.status === 400) {
      const body: unknown = await response.json();
      if (response.ok && isCustomerBotVersion(body)) return { kind: "live", live: body };
      if (response.ok) return publish ? { kind: "unknown" } : { kind: "error", detail: "Update the bot to support live lookups and the instructions-only Customer Bot editor." };
      if (response.status === 409 && body && typeof body === "object" && "current" in body && isCustomerBotVersion(body.current)) {
        return { kind: "conflict", live: body.current };
      }
      if (response.status === 400) {
        return { kind: "error", detail: "The bot rejected this draft. Check that reply instructions contain text and are within the size limit." };
      }
    }
  } catch { /* A dropped connection or unreadable response cannot confirm a publish. */ }
  return publish ? { kind: "unknown" } : { kind: "error", detail: "The bot's live content could not be loaded. Try again." };
}
