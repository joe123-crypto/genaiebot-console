import "server-only";
import { BOT_PROVISIONING } from "@/src/config";
import type { ProvisionState } from "@/src/domains/bot-provisioning";
import { BotUnavailableError } from "./bot-errors";
import type { Workspace } from "./workspace";

/**
 * Creating a workspace's bot.
 *
 * The one place that knows how a bot comes into being. `railway` builds one for
 * real (`./bot-provisioning-railway`); `stub` walks the screen through the
 * stages without building anything, for development.
 *
 * With no provisioner configured there is nothing to offer, and saying so is
 * the honest answer -- a bot is then still created by hand
 * (`docs/provision-bot.md`), which is also the fallback when a run goes wrong.
 */

export class ProvisioningUnavailableError extends BotUnavailableError {
  constructor() {
    super("Creating a bot from the console is not available yet. Share your workspace ID with whoever is setting up your bot.", 503);
    this.name = "ProvisioningUnavailableError";
  }
}

export function provisioningEnabled(): boolean {
  return BOT_PROVISIONING !== "none";
}

/**
 * A connected bot is what "ready" means, so the registry answers before any
 * provisioner does. It is also what keeps the screen right at the moment a run
 * finishes: the poll that follows reads a workspace that now has a bot, and
 * must say ready rather than refuse because there is nothing left to create.
 */
export async function readProvisionState(workspace: Workspace): Promise<ProvisionState> {
  if (workspace.bot) return { status: "ready", readyAt: new Date().toISOString() };
  if (BOT_PROVISIONING === "railway") return (await import("./bot-provisioning-railway")).readProvisionState(workspace);
  if (BOT_PROVISIONING === "stub") return (await import("./bot-provisioning-stub")).readProvisionState(workspace);
  throw new ProvisioningUnavailableError();
}

/** Starting is "start, or tell me about the run already going": a second tab,
 *  or a second click, never creates a second bot. */
export async function startProvisioning(workspace: Workspace): Promise<ProvisionState> {
  if (workspace.bot) return { status: "ready", readyAt: new Date().toISOString() };
  if (BOT_PROVISIONING === "railway") return (await import("./bot-provisioning-railway")).startProvisioning(workspace);
  if (BOT_PROVISIONING === "stub") return (await import("./bot-provisioning-stub")).startProvisioning(workspace);
  throw new ProvisioningUnavailableError();
}
