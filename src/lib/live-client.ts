import { BotUnavailableError } from "./bot-client";
import { botTarget } from "./workspace";
import { deduplicateRead, withReadSlot } from "./remote-read";

const VIEWS = new Set(["groups", "campaigns", "discoveries", "metrics", "schedule", "settings", "lines", "navigation", "campaign", "campaign-clicks", "captions", "detail", "preview", "group", "status"]);
/** No legacy fallback: a missing live endpoint must never download a directory. */
export async function getLiveView<T>(view: string, params = new URLSearchParams()): Promise<T> {
  if (!VIEWS.has(view)) throw new Error("Unknown live view");
  const target = await botTarget();
  const url = `${target.baseUrl}/internal/console/live/${view}?${params}`;
  return deduplicateRead(JSON.stringify([url, target.token]), () => withReadSlot(async () => {
    let response: Response;
    try { response = await fetch(url, { headers: { accept: "application/json", authorization: `Bearer ${target.token}` },
      cache: "no-store", signal: AbortSignal.timeout(15_000) }); }
    catch { throw new BotUnavailableError("The live view could not connect. Previous data is retained."); }
    if (!response.ok) throw new BotUnavailableError(response.status === 404 ? "The bot needs the live-view endpoint update; no full-directory fallback was attempted." : "The live view is synchronizing or unavailable. Previous data is retained.", response.status);
    return await response.json() as T;
  }));
}
