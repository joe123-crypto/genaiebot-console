import { NextResponse } from "next/server";
import { RAILWAY_PROVISIONING } from "@/src/config";
import { promotable } from "@/src/domains/bot-release";
import { promoteFleet } from "@/src/lib/fleet-store";
import { bearerMatches } from "@/src/lib/internal-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * genaebot's release job, telling the console which image every workspace's
 * bot should now run. It is called only after your gateway released that
 * commit and passed its own startup check (genaebot
 * `deploy/promote-workspace-bots.py`), and it deploys nothing: the rollout
 * picks the target up on its next tick.
 *
 * Only a commit build of the repository `BOT_IMAGE` already names is accepted,
 * so whoever holds `FLEET_RELEASE_TOKEN` can choose among your own builds and
 * nothing else. Promoting the image that is already the target changes
 * nothing -- a re-run of the job must not clear a pause its first run caused.
 */

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  // The token first, so an unset one answers 401 like a wrong one, and a
  // caller learns nothing about this console's set-up without holding it.
  if (!bearerMatches(request, "FLEET_RELEASE_TOKEN")) return json({ error: "Unauthorized." }, 401);
  if (!RAILWAY_PROVISIONING) {
    return json({ error: "This console is not set up to roll releases out to bots." }, 503);
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > 1024) return json({ error: "The request is too large." }, 413);
    body = JSON.parse(text);
  } catch {
    return json({ error: "Send {\"image\": \"<image>:<commit sha>\"}." }, 400);
  }
  const image = (body as { image?: unknown } | null)?.image;
  if (!promotable(image, RAILWAY_PROVISIONING.image)) {
    return json({ error: "That image is not a commit build of the repository this console creates bots from." }, 400);
  }
  try {
    const fleet = await promoteFleet(image, "ci");
    return json({ image: fleet.image, promotedAt: fleet.promotedAt, paused: fleet.paused ?? null });
  } catch {
    return json({ error: "The release could not be recorded. Try again shortly." }, 503);
  }
}
