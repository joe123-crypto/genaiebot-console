import { NextResponse } from "next/server";
import { RAILWAY_PROVISIONING } from "@/src/config";
import { advanceFleet } from "@/src/lib/fleet-rollout";
import { bearerMatches } from "@/src/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * One step of the fleet rollout (`src/lib/fleet-rollout.ts`), called every ten
 * minutes by the console repository's `fleet-tick` workflow.
 *
 * 409 is the tick that failed a bot and paused the fleet: the workflow run
 * fails on it, and GitHub's failure email is how you hear. Only that one tick:
 * GitHub mails every failed scheduled run, so a fleet that stays paused answers
 * 200 with `paused` in the body, which the workflow shows as a warning on
 * every run until the next release or a `fleet resume`.
 */

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // The token first, so an unset one answers 401 like a wrong one, and a
  // caller learns nothing about this console's set-up without holding it.
  if (!bearerMatches(request, "FLEET_TICK_TOKEN")) return json({ error: "Unauthorized." }, 401);
  if (!RAILWAY_PROVISIONING) {
    return json({ error: "This console is not set up to roll releases out to bots." }, 503);
  }
  try {
    const summary = await advanceFleet();
    return json(summary, summary.failed ? 409 : 200);
  } catch (error) {
    console.error("[fleet] tick failed", { error: error instanceof Error ? error.message : "unknown" });
    return json({ error: "The rollout could not be advanced. The next tick tries again." }, 503);
  }
}
