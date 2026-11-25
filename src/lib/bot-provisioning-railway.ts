import "server-only";
import { randomBytes } from "node:crypto";
import { botVariables, unreadableShared } from "@/src/domains/bot-variables";
import type { ProvisionState } from "@/src/domains/bot-provisioning";
import {
  atStage,
  pastDeadline,
  readyRun,
  runState,
  failedRun,
  withResources,
  type ProvisionRun,
} from "@/src/domains/provision-run";
import { BotConnectError, checkBot, connectBot } from "./bot-connect";
import { BotUnavailableError } from "./bot-errors";
import {
  claimRun,
  readConnectedBot,
  readRun,
  recordRun,
  saveRun,
  startRun,
} from "./provision-run";
import { RailwayError } from "./railway-api";
import {
  createDomain,
  createService,
  createVolume,
  deployService,
  findService,
  readDeploymentStatus,
  readLatestDeployment,
  readTemplateVariables,
  serviceName,
  setServiceSource,
  writeVariables,
} from "./railway-bot";
import { readSettingsTemplate, seedWorkspaceSettings } from "./workspace-seed";
import { deriveBotToken, type Workspace } from "./workspace";

/**
 * Creating a workspace's bot, for real: its own Railway service, its own volume,
 * its own domain, its own config, connected to the workspace that asked.
 *
 * These are the manual runbook's steps (`docs/provision-bot.md`) with nobody
 * running them. The four stages the screen already draws are the four steps.
 *
 * ## One step per poll
 *
 * A run takes minutes and a route handler cannot hold one, so the run has no
 * process of its own: the browser's poll is its clock. Each poll takes the
 * lease, advances AT MOST ONE step, writes what it reached and returns. Nothing
 * here waits on anything -- a step that is not finished says so and the next
 * poll re-enters it.
 *
 * This is the design's one real weakness, and it is worth knowing rather than
 * rediscovering: while nothing polls, nothing advances. A closed tab stalls a
 * run. It does not break it -- every step checks whether its work has succeeded
 * BEFORE it checks the deadline, so a user who comes back to a finished
 * deployment has it adopted rather than timed out -- but a run that nobody
 * watches does not finish. The fix, when it is wanted, is a Railway webhook or
 * a scheduled tick calling the same `readProvisionState`.
 *
 * ## Nothing is built twice
 *
 * Every id is written down the instant Railway hands it over, inside the lease,
 * so a re-entered step skips what already exists. The service -- the one that
 * costs money -- is also looked up by name before it is created, which covers
 * the crash between the call returning and that write.
 */

const DEPLOY_UP = new Set(["SUCCESS", "SLEEPING"]);
const DEPLOY_LOST = new Set(["FAILED", "CRASHED", "REMOVED", "REMOVING", "SKIPPED"]);

/** A failure the user may read. Railway's and the bot's own words never pass
 *  through here: each error type carries a sentence this console wrote. */
function detailOf(error: unknown): string {
  if (error instanceof RailwayError) return error.detail;
  if (error instanceof BotConnectError) return error.message;
  if (error instanceof BotUnavailableError) return error.detail;
  return "Your bot could not be created. Try again shortly.";
}

/**
 * Checked before a run opens, so a console that cannot copy what a bot needs
 * refuses rather than building one that can serve nothing. One Railway read and
 * one Firestore read, with no mutation yet, so there is nothing to clean up.
 */
async function checkTemplate(workspace: Workspace): Promise<void> {
  const template = await readTemplateVariables();
  const missing = unreadableShared(template);
  if (missing.length) {
    throw new BotUnavailableError(
      `This console cannot read the settings a new bot needs (${missing[0]}), so no bot was created. ` +
      "Ask whoever runs this console to make it a shared project variable.", 503);
  }
  // The config a new workspace is seeded with, checked here for the same reason:
  // a bot built and then found unseedable would have cost money to no purpose.
  await readSettingsTemplate(workspace);
}

export async function startProvisioning(workspace: Workspace): Promise<ProvisionState> {
  await checkTemplate(workspace);
  return runState(await startRun(workspace));
}

export async function readProvisionState(workspace: Workspace): Promise<ProvisionState> {
  const claim = await claimRun(workspace);
  if (claim.kind === "none") return { status: "idle" };
  if (claim.kind === "broken") {
    throw new BotUnavailableError(
      "Your bot's setup could not be read. Ask whoever runs this console to look at it.", 503);
  }
  // Somebody else holds the lease, or the run is over. Either way: report, don't move.
  if (claim.kind === "busy") return runState(claim.run);
  return runState(await advance(workspace, claim.run));
}

/**
 * Whether the step got anywhere: a stage behind it, or one more thing built.
 *
 * This is what the deadline is measured against. A run is only called off when
 * a poll finds it no further along than the last one left it -- so somebody who
 * closes the tab for an hour and comes back to a deployment that finished
 * meanwhile has it adopted, rather than timed out for the waiting. Progress is
 * finite (four stages, a few resources each), so this cannot defer for ever.
 */
function madeProgress(before: ProvisionRun, after: ProvisionRun): boolean {
  return after.stage !== before.stage ||
    JSON.stringify(after.railway) !== JSON.stringify(before.railway);
}

/** One step, then the lease goes back. A step that throws fails the run. */
async function advance(workspace: Workspace, run: ProvisionRun): Promise<ProvisionRun> {
  const now = Date.now();
  let next: ProvisionRun;
  try {
    next = await step(workspace, run, now);
  } catch (error) {
    // Fail from what is STORED, not from the run this step began with: a step
    // writes each id down as it goes, and failing from the older value would
    // throw those ids away -- leaving a service nobody has a record of, and a
    // retry that built a second one.
    next = failedRun(await readRun(workspace) ?? run, detailOf(error), now);
  }
  if (next.outcome === "running" && !madeProgress(run, next) && pastDeadline(next, now)) {
    next = failedRun(next, "Your bot took too long to be created. Nothing was connected to your workspace.", now);
  }
  await saveRun(workspace, next);
  return next;
}

function step(workspace: Workspace, run: ProvisionRun, now: number): Promise<ProvisionRun> {
  switch (run.stage) {
    case "reserving": return reserve(workspace, run, now);
    case "starting": return start(workspace, run, now);
    case "seeding": return seed(workspace, run, now);
    case "connecting": return connect(workspace, run, now);
  }
}

/**
 * The service, its volume and its domain. Each is skipped when the run already
 * names it, so re-entering this stage costs three reads and builds nothing.
 */
async function reserve(workspace: Workspace, run: ProvisionRun, now: number): Promise<ProvisionRun> {
  let current = run;
  if (!current.railway.serviceId) {
    // Adopt rather than duplicate: a previous attempt may have created this and
    // died before writing the id down.
    const existing = await findService(serviceName(workspace.id));
    const serviceId = existing ?? await createService(workspace.id);
    current = withResources(current, { serviceId }, now);
    await recordRun(workspace, current);
  }
  if (!current.railway.volumeId) {
    // Before the deploy that counts, or the bot has nowhere durable to keep its
    // WhatsApp session.
    const volumeId = await createVolume(current.railway.serviceId!);
    current = withResources(current, { volumeId }, now);
    await recordRun(workspace, current);
  }
  if (!current.railway.domain) {
    const domain = await createDomain(current.railway.serviceId!);
    current = withResources(current, { domainId: domain.id, domain: domain.domain }, now);
    await recordRun(workspace, current);
  }
  return atStage(current, "starting", now);
}

/**
 * Its config, its deployment, and waiting for it to answer.
 *
 * The variables wait until here because two of them are the bot's own domain,
 * which did not exist until `reserving` finished. The image waits until after
 * them, because setting it is what deploys: a service created with an image
 * deploys at once, which would boot the bot with no volume and no config.
 */
async function start(workspace: Workspace, run: ProvisionRun, now: number): Promise<ProvisionRun> {
  let current = run;
  const { serviceId, domain } = current.railway;
  if (!serviceId || !domain) {
    throw new BotUnavailableError("Your bot's setup lost track of what it had created, so it was stopped.", 503);
  }
  if (!current.railway.variablesAt) {
    const template = await readTemplateVariables();
    const missing = unreadableShared(template);
    if (missing.length) {
      throw new BotUnavailableError(
        `This console cannot read the settings your bot needs (${missing[0]}), so it was not started.`, 503);
    }
    await writeVariables(serviceId, botVariables(template, {
      workspaceId: workspace.id, domain,
      consoleToken: deriveBotToken(workspace.id),
      // This bot's own gateway password, never the template bot's.
      gatewayToken: randomBytes(32).toString("base64url"),
    }));
    current = withResources(current, { variablesAt: new Date(now).toISOString() }, now);
    await recordRun(workspace, current);
    return current;
  }
  // The image goes on last, because setting it is also the first deploy: the bot
  // boots once, with its volume mounted and its whole config already in place.
  if (!current.railway.sourceSetAt) {
    await setServiceSource(serviceId);
    current = withResources(current, { sourceSetAt: new Date(now).toISOString() }, now);
    await recordRun(workspace, current);
    // That call answers only "yes", so the deployment it started has to be
    // looked up. Not finding it yet is fine -- the next poll looks again.
    const started = await readLatestDeployment(serviceId);
    if (started) {
      current = withResources(current, { deploymentId: started, deploymentAttempt: current.attempt }, now);
      await recordRun(workspace, current);
    }
    return current;
  }
  // One deploy per attempt: every poll within an attempt polls the same one, and
  // a retry after a failed deploy starts a fresh one -- the image is already
  // set by then, so this is the call that redeploys it -- instead of re-reading
  // a verdict that will never change.
  if (!current.railway.deploymentId || current.railway.deploymentAttempt !== current.attempt) {
    const deploymentId = await deployService(serviceId);
    current = withResources(current, { deploymentId, deploymentAttempt: current.attempt }, now);
    await recordRun(workspace, current);
    return current;
  }
  const status = await readDeploymentStatus(current.railway.deploymentId);
  if (DEPLOY_LOST.has(status)) {
    return failedRun(current,
      "Your bot was created but would not start. Nothing was connected to your workspace.", now);
  }
  if (status === "NEEDS_APPROVAL") {
    return failedRun(current, "Your bot's deployment is waiting to be approved before it can start.", now);
  }
  // An unrecognised status is treated as still working, never as success.
  if (!DEPLOY_UP.has(status)) return current;
  // Deployed is not the same as serving. The bot must accept this workspace's
  // token and say this workspace is the one it serves, which is the same
  // handshake `connect-bot` makes -- so "Starting it up" means it answers.
  try {
    await checkBot(`https://${domain}`, workspace);
  } catch {
    // Not yet. The deadline is what ends this, not a guess about how long a
    // first boot takes.
    return current;
  }
  current = withResources(current, { servingAt: new Date(now).toISOString() }, now);
  return atStage(current, "seeding", now);
}

async function seed(workspace: Workspace, run: ProvisionRun, now: number): Promise<ProvisionRun> {
  await seedWorkspaceSettings(workspace);
  return atStage(run, "connecting", now);
}

/**
 * The registry write, and the only thing that makes the console use this bot.
 *
 * The stored `bot` is read first so this step can tell its own earlier success
 * -- written just before a lease expired -- from a workspace that somehow points
 * somewhere else. `connectBot` refuses to repoint an existing bot, so without
 * this a re-entry would fail a run that had in fact succeeded.
 */
async function connect(workspace: Workspace, run: ProvisionRun, now: number): Promise<ProvisionRun> {
  const domain = run.railway.domain;
  if (!domain) {
    throw new BotUnavailableError("Your bot's setup lost track of its address, so it was stopped.", 503);
  }
  const origin = `https://${domain}`;
  const connected = await readConnectedBot(workspace);
  if (connected === origin) return readyRun(run, now);
  if (connected) {
    return failedRun(run, "Your workspace is already connected to a different bot, so this one was not connected.", now);
  }
  await connectBot(workspace, origin);
  return readyRun(run, now);
}
