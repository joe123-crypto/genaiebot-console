import { BOT_API_BASE_URL, BOT_API_TOKEN } from "@/src/config";
import { BotUnavailableError } from "./bot-client";
import { deduplicateRead, withReadSlot } from "./remote-read";

const VIEWS = new Set(["groups", "campaigns", "discoveries", "metrics", "schedule", "settings", "lines", "navigation", "campaign", "captions", "detail", "preview", "group", "status"]);
/** No legacy fallback: a missing live endpoint must never download a directory. */
export function getLiveView<T>(view: string, params = new URLSearchParams()): Promise<T> {
  if (!VIEWS.has(view)) throw new Error("Unknown live view");
  if (!BOT_API_BASE_URL) return Promise.reject(new BotUnavailableError("Live views need the companion console API. Set BOT_API_BASE_URL to the bot's console API."));
  const url = `${BOT_API_BASE_URL.replace(/\/$/, "")}/internal/console/live/${view}?${params}`;
  return deduplicateRead(JSON.stringify([url, BOT_API_TOKEN]), () => withReadSlot(async () => {
    let response: Response;
    try { response = await fetch(url, { headers: { accept: "application/json", ...(BOT_API_TOKEN ? { authorization: `Bearer ${BOT_API_TOKEN}` } : {}) },
      cache: "no-store", signal: AbortSignal.timeout(15_000) }); }
    catch { throw new BotUnavailableError("The live view could not connect. Previous data is retained."); }
    if (!response.ok) throw new BotUnavailableError(response.status === 404 ? "The bot needs the live-view endpoint update; no full-directory fallback was attempted." : "The live view is synchronizing or unavailable. Previous data is retained.", response.status);
    return await response.json() as T;
  }));
}
