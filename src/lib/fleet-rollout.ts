import "server-only";
import {
  accountsBack,
  behind,
  deployed,
  failed,
  inFlight,
  pastDeadline,
  settled,
  startAttempt,
  type BotRelease,
  type FleetPause,
  type FleetRelease,
  type ReleaseAttempt,
  type ReleaseStage,
} from "@/src/domains/bot-release";
import { botVariables, unreadableShared } from "@/src/domains/bot-variables";
import { deletionFenced } from "@/src/domains/provision-run";
import { connectedAccounts } from "./account-client";
import { checkBot } from "./bot-connect";
import {
  claimBot,
  claimTick,
  listFleetBots,
  pauseFleet,
  readFleet,
  releaseTick,
  saveBot,
  type FleetBot,
} from "./fleet-store";
import { RailwayError } from "./railway-api";
import {
  deployService,
  readDeploymentStatus,
  readServiceInstance,
  readServiceVariables,
  readTemplateVariables,
  setServiceSource,
  writeVariables,
} from "./railway-bot";
import { readReleaseWindow } from "./release-window-client";
import { deriveBotToken, type BotTarget } from "./workspace";

/**
 * Rolling the fleet's target out, one step per tick.
 *
 * Nothing here runs on its own: a scheduled workflow calls
 * `POST /api/internal/fleet/tick` every ten minutes, and each call advances the
 * fleet by at most one step under the tick's lease, then returns. That is the
 * provisioner's shape too, and for the same reason -- no route handler can hold
 * a job that waits for a quiet window hours away.
 *
 * Per tick, in order:
 *
 * 1. A bot already being changed is moved on: its deployment is watched, then
 *    the bot is verified, or it is failed and put back.
 * 2. Otherwise, unless the fleet is paused, the first bot that is behind and
 *    says it is quiet is started: its connected accounts are noted, its
 *    settings re-copied if a sync is pending, its image set, and one deploy
 *    asked for. Setting an image does not deploy by itself (measured), so the
 *    deploy is always this one explicit call.
 *
 * A failure anywhere after something was changed puts back the image the bot
 * had, marks it failed, and pauses the fleet, so the bot that failed is the
 * only one that ever got that release.
 */

const DEPLOY_UP = new Set(["SUCCESS", "SLEEPING"]);
const DEPLOY_LOST = new Set(["FAILED", "CRASHED", "REMOVED", "REMOVING", "SKIPPED", "NEEDS_APPROVAL"]);
/** How many bots one tick asks about their quiet window, at once. */
const PROBES_PER_TICK = 10;

export type FleetSummary = {
  target: string | null;
  paused: FleetPause | null;
  /** Another tick held the lease, so this one changed nothing. */
  busy?: true;
  inFlight?: { workspace: string; stage: ReleaseStage };
  started?: string;
  settled?: string;
  failed?: { workspace: string; detail: string };
  waiting: { workspace: string; nextQuietAt?: string | null; reason?: string }[];
  upToDate: number;
  behind: number;
};

const targetOf = (bot: FleetBot): BotTarget => ({
  baseUrl: bot.workspace.bot!.baseUrl, token: deriveBotToken(bot.workspace.id), workspaceId: bot.workspace.id,
});

function said(error: unknown): string {
  if (error instanceof RailwayError) return error.detail;
  return error instanceof Error ? error.message : "an unknown error";
}

export async function advanceFleet(now = Date.now()): Promise<FleetSummary> {
  const claim = await claimTick(now);
  if (!claim) {
    // Either no release has been promoted yet, or another tick holds the
    // fleet. Only the second is "busy"; the first is simply nothing to do.
    const idle = { target: null, paused: null, waiting: [], upToDate: 0, behind: 0 };
    return (await readFleet()) ? { ...idle, busy: true } : idle;
  }
  try {
    return await tick(claim.fleet, now);
  } finally {
    await releaseTick(claim.holder);
  }
}

async function tick(fleet: FleetRelease, now: number): Promise<FleetSummary> {
  const bots = (await listFleetBots()).filter((bot) => !deletionFenced(bot.deletingAt, now));
  const summary: FleetSummary = {
    target: fleet.image, paused: fleet.paused ?? null, waiting: [],
    upToDate: bots.filter((bot) => !inFlight(bot.release) && !behind(bot.release, fleet)
      && bot.release.image === fleet.image).length,
    behind: bots.filter((bot) => behind(bot.release, fleet)).length,
  };

  // One bot at a time, fleet-wide: a bot already in flight is the only one moved.
  const flying = bots.find((bot) => inFlight(bot.release));
  if (flying) {
    await step(flying, fleet, now, summary);
    return summary;
  }
  if (fleet.paused) return summary;

  const candidates = bots.filter((bot) => behind(bot.release, fleet)).slice(0, PROBES_PER_TICK);
  const windows = await Promise.all(candidates.map((bot) => readReleaseWindow(targetOf(bot))));
  for (const [index, bot] of candidates.entries()) {
    const window = windows[index];
    if (!window.known) {
      summary.waiting.push({ workspace: bot.workspace.id, reason: window.reason });
      continue;
    }
    if (!window.quiet) {
      summary.waiting.push({ workspace: bot.workspace.id, nextQuietAt: window.nextQuietAt });
      continue;
    }
    if (summary.started || summary.settled || summary.failed) {
      summary.waiting.push({ workspace: bot.workspace.id, reason: "another bot went first" });
      continue;
    }
    await start(bot, fleet, now, summary);
  }
  return summary;
}

/** Start one bot on the target. Called only for a bot that says it is quiet. */
async function start(bot: FleetBot, fleet: FleetRelease, now: number, summary: FleetSummary): Promise<void> {
  const claim = await claimBot(bot.workspace.id, now);
  if (!claim) {
    summary.waiting.push({ workspace: bot.workspace.id, reason: "being deleted or already being changed" });
    return;
  }
  const { release, holder } = claim;
  let accounts: string[];
  let instance;
  try {
    // Nothing is changed until both of these are known: without the accounts
    // there is nothing to verify against, and without the image nothing to put back.
    accounts = await connectedAccounts(targetOf(bot));
    instance = await readServiceInstance(bot.serviceId);
  } catch (error) {
    await saveBot(bot.workspace.id, release, holder);
    summary.waiting.push({ workspace: bot.workspace.id, reason: `could not be read before starting: ${said(error)}` });
    return;
  }
  const syncSettings = release.settingsGeneration < fleet.settingsGeneration;
  // Already on the target, by a route this console did not record -- a bot
  // created from it, say. Nothing to restart for.
  if (instance.image === fleet.image && !syncSettings) {
    await saveBot(bot.workspace.id, { image: fleet.image, settingsGeneration: release.settingsGeneration }, holder);
    summary.settled = bot.workspace.id;
    return;
  }

  let attempt = startAttempt(fleet, { image: instance.image, deploymentId: instance.latestDeploymentId, accounts }, now);
  let changed = false;
  try {
    if (syncSettings) {
      await syncBotSettings(bot);
      changed = true;
    }
    if (instance.image !== fleet.image) {
      await setServiceSource(bot.serviceId, fleet.image);
      changed = true;
    }
    attempt = { ...attempt, deploymentId: await deployService(bot.serviceId) };
  } catch (error) {
    if (!changed) {
      await saveBot(bot.workspace.id, release, holder);
      summary.waiting.push({ workspace: bot.workspace.id, reason: `could not be started: ${said(error)}` });
      return;
    }
    await fail(bot, release, attempt, `the release could not be started: ${said(error)}`, holder, now, summary);
    return;
  }
  await saveBot(bot.workspace.id, { ...release, attempt }, holder);
  console.info("[fleet] started", { workspace: bot.workspace.id, from: instance.image, to: fleet.image,
                                    settings: syncSettings, deployment: attempt.deploymentId });
  summary.started = bot.workspace.id;
  summary.inFlight = { workspace: bot.workspace.id, stage: attempt.stage };
}

/** Move the bot in flight on by one step. */
async function step(bot: FleetBot, fleet: FleetRelease, now: number, summary: FleetSummary): Promise<void> {
  const claim = await claimBot(bot.workspace.id, now);
  if (!claim || !claim.release.attempt || !inFlight(claim.release)) {
    if (claim) await saveBot(bot.workspace.id, claim.release, claim.holder);
    return;
  }
  const { release, holder } = claim;
  let attempt = release.attempt!;
  summary.inFlight = { workspace: bot.workspace.id, stage: attempt.stage };

  if (attempt.stage === "deploying") {
    let status: string | null = null;
    try { status = attempt.deploymentId ? await readDeploymentStatus(attempt.deploymentId) : null; }
    catch { status = null; }
    if (status && DEPLOY_LOST.has(status)) {
      return fail(bot, release, attempt, `its deployment ended ${status}`, holder, now, summary);
    }
    if (status && DEPLOY_UP.has(status)) {
      attempt = deployed(attempt, now);
      await saveBot(bot.workspace.id, { ...release, attempt }, holder);
      summary.inFlight = { workspace: bot.workspace.id, stage: attempt.stage };
      return;
    }
    if (pastDeadline(attempt, now)) {
      return fail(bot, release, attempt, `its deployment had not succeeded after 15 minutes (${status ?? "unread"})`, holder, now, summary);
    }
    await saveBot(bot.workspace.id, release, holder);
    return;
  }

  // Verifying: it must answer for its own workspace, with every account back.
  let connected: string[] | null = null;
  let reason = "no answer";
  try {
    await checkBot(bot.workspace.bot!.baseUrl, bot.workspace);
    connected = await connectedAccounts(targetOf(bot));
  } catch (error) {
    reason = said(error);
  }
  if (connected && accountsBack(attempt.accountsBefore, connected)) {
    await saveBot(bot.workspace.id, settled(attempt), holder);
    console.info("[fleet] settled", { workspace: bot.workspace.id, image: attempt.target });
    summary.settled = bot.workspace.id;
    summary.inFlight = undefined;
    return;
  }
  if (pastDeadline(attempt, now)) {
    const missing = connected ? attempt.accountsBefore.filter((id) => !connected!.includes(id)) : [];
    const detail = missing.length
      ? `it came back without WhatsApp account(s) ${missing.join(", ")}`
      : `it did not answer for its workspace within 10 minutes (${reason})`;
    return fail(bot, release, attempt, detail, holder, now, summary);
  }
  await saveBot(bot.workspace.id, release, holder);
}

/**
 * Put back what the bot had, mark it failed and pause the fleet.
 *
 * The image is set back and deployed. Settings cannot be: Railway keeps no
 * history of a variable, and this console never copies a bot's secrets, so a
 * failed settings sync says so rather than claiming to have undone it.
 */
async function fail(bot: FleetBot, release: BotRelease, attempt: ReleaseAttempt, why: string,
                    holder: string, now: number, summary: FleetSummary): Promise<void> {
  let detail = `${bot.workspace.id}: ${why}.`;
  let image = release.image;
  if (attempt.fromImage && attempt.fromImage !== attempt.target) {
    try {
      await setServiceSource(bot.serviceId, attempt.fromImage);
      await deployService(bot.serviceId);
      image = attempt.fromImage;
      detail += ` It was put back on ${attempt.fromImage}.`;
    } catch (error) {
      detail += ` Putting it back on ${attempt.fromImage} failed too (${said(error)}); it needs looking at.`;
    }
  } else if (!attempt.fromImage) {
    detail += " What it ran before is unknown, so it could not be put back.";
  }
  if (attempt.targetSettings > release.settingsGeneration) {
    detail += " Its re-copied settings stay: they cannot be restored.";
  }
  const failedAttempt = failed(attempt, detail, now);
  await saveBot(bot.workspace.id, { ...release, image, attempt: failedAttempt }, holder);
  await pauseFleet({ at: new Date(now).toISOString(), reason: detail, workspace: bot.workspace.id });
  console.error("[fleet] failed and paused", { workspace: bot.workspace.id, detail });
  summary.failed = { workspace: bot.workspace.id, detail };
  summary.paused = { at: new Date(now).toISOString(), reason: detail, workspace: bot.workspace.id };
  summary.inFlight = undefined;
}

/**
 * Re-copy the template's shared values onto a bot, by the same rules as when
 * it was created (`botVariables`), keeping the one secret that is its own: its
 * gateway password. Written with `skipDeploys`; the rollout's deploy applies it.
 */
async function syncBotSettings(bot: FleetBot): Promise<void> {
  const [template, current] = await Promise.all([readTemplateVariables(), readServiceVariables(bot.serviceId)]);
  const missing = unreadableShared(template);
  if (missing.length) throw new Error(`the template's ${missing[0]} cannot be read`);
  const gatewayToken = current.GATEWAY_AUTH_TOKEN;
  // Its own, made when it was built and kept nowhere else. Replacing it would
  // change a password nobody wrote down, so a bot without one is refused.
  if (!gatewayToken) throw new Error("the bot has no gateway password of its own to keep");
  await writeVariables(bot.serviceId, botVariables(template, {
    workspaceId: bot.workspace.id, domain: new URL(bot.workspace.bot!.baseUrl).host,
    consoleToken: deriveBotToken(bot.workspace.id), gatewayToken,
  }));
}
