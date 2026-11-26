import "server-only";
import type { BotTarget } from "./workspace";

/**
 * Asking a workspace's bot whether it may be restarted now.
 *
 * The bot answers from its own campaigns, with the same arithmetic your
 * gateway's release gate uses (genaebot `deploy/release_window.py`). Only the
 * bot can: its schedule is its own, and the console holds no copy.
 *
 * Anything but a clear answer is "cannot see", never "quiet". A bot that
 * predates the route answers 404; one that is down answers nothing. Neither is
 * deployed to by the rollout, which is the same rule the gateway's own gate
 * follows -- a gate that cannot see must not wave a restart through.
 */

const TIMEOUT_MS = 10_000;

export type ReleaseWindow =
  | { known: true; quiet: boolean; nextQuietAt: string | null }
  | { known: false; reason: string };

export async function readReleaseWindow(target: BotTarget): Promise<ReleaseWindow> {
  let response: Response;
  try {
    response = await fetch(`${target.baseUrl}/internal/console/release-window`, {
      headers: { accept: "application/json", authorization: `Bearer ${target.token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store",
    });
  } catch {
    return { known: false, reason: "the bot could not be reached" };
  }
  if (response.status === 404) return { known: false, reason: "the bot predates release windows" };
  if (!response.ok) return { known: false, reason: `the bot answered ${response.status}` };
  let body: unknown;
  try { body = await response.json(); } catch { return { known: false, reason: "the bot's answer could not be read" }; }
  const quiet = (body as { quiet?: unknown } | null)?.quiet;
  const next = (body as { nextQuietAt?: unknown } | null)?.nextQuietAt;
  if (typeof quiet !== "boolean") return { known: false, reason: "the bot's answer could not be read" };
  return { known: true, quiet, nextQuietAt: typeof next === "string" && !Number.isNaN(Date.parse(next)) ? next : null };
}
