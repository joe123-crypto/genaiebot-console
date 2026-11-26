import "server-only";
import { RAILWAY_PROVISIONING } from "@/src/config";
import type { BotRemoval } from "@/src/domains/bot-provisioning";
import type { ProvisionRun } from "@/src/domains/provision-run";
import { readRun } from "./provision-run";
import { RailwayError } from "./railway-api";
import {
  deleteService,
  deleteVolume,
  listServices,
  listVolumeInstances,
  serviceName,
} from "./railway-bot";
import type { Workspace } from "./workspace";

/**
 * Removing the bot this console created for a workspace: its Railway service,
 * which stops it and takes its domain, and then its volume.
 *
 * ## Which bot
 *
 * Only one this console built. That is a service named `bot-<workspace id>`,
 * the name the provisioner gives and nothing else does, and never the template
 * service every new bot copies its settings from. A bot connected by hand from
 * the runbook is left running for an operator to take down. The run record
 * (`workspaces/{id}.provisioning.railway`) is read too, but the name is what
 * decides: a crash between `serviceCreate` returning and its id being written
 * down leaves a service the record does not name, and this must find that one
 * as well.
 *
 * ## In what order
 *
 * The volumes are read first, because deleting a service leaves its volume
 * behind -- still billed -- with nothing to say whose it was: its instance's
 * `serviceId` goes null. Then the service, so the bot stops before anything it
 * reads or writes is deleted; then the volumes. Railway holds a deleted volume
 * for a few days before erasing it, which is the one part of an account that is
 * scheduled rather than gone at once.
 *
 * ## Twice
 *
 * Every step reads Railway before it acts, so a teardown that failed half-way
 * picks up where it stopped: a service already gone is not listed, and a volume
 * already going reports `isPendingDeletion`. A volume left detached by an
 * earlier attempt is still found, through the id the run record kept.
 */

export class BotTeardownError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "BotTeardownError";
  }
}

export type TeardownResult = { services: string[]; volumes: string[] };

export async function removeProvisionedBot(workspaceId: string, run: ProvisionRun | null): Promise<TeardownResult> {
  const recorded = run?.railway ?? {};
  if (!RAILWAY_PROVISIONING) {
    // The record says this console built something, and without its Railway
    // credentials it cannot take it down. Carrying on would delete the record
    // that names it and leave a bot running that nothing points at.
    if (recorded.serviceId || recorded.volumeId) {
      throw new BotTeardownError("This console cannot remove your bot right now, so your account was kept. Ask whoever runs it to check its hosting settings.");
    }
    return { services: [], volumes: [] };
  }
  const { templateServiceId } = RAILWAY_PROVISIONING;
  const name = serviceName(workspaceId);

  const services = await listServices();
  const ours = services.filter((service) => service.name === name && service.id !== templateServiceId);
  const listed = services.find((service) => service.id === recorded.serviceId);
  if (listed && listed.name !== name && listed.id !== templateServiceId) {
    // The record names a service that exists under somebody else's name. It is
    // not this function's to guess which of the two is wrong, and deleting the
    // wrong one could stop another user's bot.
    throw new BotTeardownError("Your bot could not be identified for removal, so your account was kept. Ask whoever runs this console to look at it.");
  }

  const serviceIds = new Set(ours.map((service) => service.id));
  const volumes: string[] = [];
  for (const volume of await listVolumeInstances()) {
    if (volume.pendingDeletion) continue;
    const mountedOnOurs = volume.serviceId !== null && serviceIds.has(volume.serviceId);
    // Left detached by an earlier attempt that deleted the service and then
    // failed. Only the record can say it was ours; a volume still mounted on
    // any other service is never touched, whatever the record says.
    const ourDetached = volume.serviceId === null && volume.volumeId === recorded.volumeId;
    if (mountedOnOurs || ourDetached) volumes.push(volume.volumeId);
  }

  for (const service of ours) await deleteService(service.id);
  for (const volume of volumes) await deleteVolume(volume);
  if (ours.length || volumes.length) {
    console.info("[account-deletion] removed the workspace's bot", {
      workspace: workspaceId, services: [...serviceIds], volumes,
    });
  }
  return { services: [...serviceIds], volumes };
}

/**
 * What deleting this account does to its bot, for the screen that offers it.
 *
 * * `removed` -- this console started a run for the workspace, so whatever it
 *   built goes with the account.
 * * `manual` -- a bot is connected that this console did not build. It keeps
 *   running until an operator takes it down.
 * * `none` -- there is no bot.
 *
 * It is a sentence on a card, so a record that cannot be read is answered from
 * the registry alone rather than failing the page. The deletion itself never
 * relies on this: it looks the service up by name whatever this said.
 */
export async function botRemovalOf(workspace: Workspace | null): Promise<BotRemoval> {
  if (!workspace) return "none";
  // Read whatever provisioning is set to now: a bot built before it was
  // switched off is still this console's, and still goes.
  const run = await readRun(workspace).catch(() => null);
  if (run) return "removed";
  return workspace.bot ? "manual" : "none";
}

/** Railway's own words, for the server log only. */
export function teardownUpstream(error: unknown): string | undefined {
  return error instanceof RailwayError ? error.upstream : undefined;
}
