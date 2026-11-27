/**
 * Rolling a genaebot release out to every workspace's bot: the records and
 * the rules, kept pure so every decision can be tested without Firestore,
 * Railway or a bot.
 *
 * ## The fleet
 *
 * `consoleFleet/release` names the image every console-built bot should run --
 * the fleet's *target* -- and, separately, the generation of shared settings it
 * should hold. genaebot's CI sets the target once your gateway has released
 * that commit and passed its own startup check, so the gateway is the canary.
 * New bots are created from it too.
 *
 * ## One bot at a time
 *
 * At most one bot is ever being changed, fleet-wide. The first bot to take a
 * release is therefore the canary for the rest: if it does not come back, it is
 * put back on the image it had and the fleet pauses, and nobody else gets that
 * image. A later release clears the pause, because it is presumably the fix.
 *
 * ## Each bot
 *
 * `workspaces/{id}.release` is what this console last did to that bot:
 *
 *   deploying  the image is set and a deployment is going
 *   verifying  the deployment succeeded; waiting for the bot to answer for its
 *              workspace and for every WhatsApp account that was connected
 *              before to be connected again
 *   failed     it did not; the image it had is back
 *
 * A bot with no attempt in flight is *behind* when the image it runs is not the
 * target, or its settings generation is below the fleet's. Being behind is all
 * "waiting" means: there is no stored waiting stage, because nothing about it
 * needs remembering beyond the bot's own answer about its quiet window.
 */

export const RELEASE_LEASE_MS = 60_000;
/** The tick that moves the fleet holds this; a crashed tick frees it after. */
export const TICK_LEASE_MS = 5 * 60_000;
/** From the image being set to Railway calling the deployment a success. */
export const DEPLOY_DEADLINE_MS = 15 * 60_000;
/** From that success to the bot answering with every account back. */
export const VERIFY_DEADLINE_MS = 10 * 60_000;

export type FleetPause = { at: string; reason: string; workspace?: string };

export type FleetRelease = {
  /** The image every console-built bot should run. */
  image: string;
  /** The target before this one, for the operator who rolls back. */
  previousImage?: string;
  promotedAt: string;
  /** Who set it: `ci` for genaebot's release job, `operator` for a command. */
  source: string;
  /** Bumped by `fleet sync-settings`; a bot below it gets the current shared values. */
  settingsGeneration: number;
  paused?: FleetPause;
  tickLease?: { holder: string; until: string };
};

export type ReleaseStage = "deploying" | "verifying" | "failed";

export type ReleaseAttempt = {
  stage: ReleaseStage;
  target: string;
  targetSettings: number;
  /** What the bot ran before, which a failure puts back. Null when unknown. */
  fromImage: string | null;
  /** Its live deployment before, so the new one can be told apart. */
  fromDeploymentId: string | null;
  deploymentId?: string;
  /** Connected before the restart, and so expected back after it. */
  accountsBefore: string[];
  startedAt: string;
  updatedAt: string;
  deployedAt?: string;
  detail?: string;
};

export type BotRelease = {
  /** The image this console last saw the bot settle on. */
  image: string | null;
  settingsGeneration: number;
  attempt?: ReleaseAttempt;
  lease?: { holder: string; until: string };
};

/** `ghcr.io/owner/genaebot:<40-hex sha>`, from the repository `BOT_IMAGE` names. */
export function imageRepository(image: string): string | null {
  const match = /^([a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+):[A-Za-z0-9._-]{1,128}$/.exec(image);
  return match ? match[1] : null;
}

/**
 * Whether `image` may become the fleet's target. Only a commit build of the
 * same repository the console already creates bots from: so a leaked release
 * token can choose among your own published builds, never point every bot at
 * somebody else's image, or at a moving tag like `:main`.
 */
export function promotable(image: unknown, botImage: string): image is string {
  if (typeof image !== "string") return false;
  const repository = imageRepository(botImage);
  return !!repository && new RegExp(`^${repository.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:[0-9a-f]{40}$`).test(image);
}

const isStamp = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
const isText = (value: unknown, max = 400): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0;

function lease(value: unknown): { holder: string; until: string } | undefined {
  const data = value as Record<string, unknown> | null;
  return data && typeof data === "object" && isText(data.holder, 200) && isStamp(data.until)
    ? { holder: data.holder, until: data.until } : undefined;
}

export function parseFleet(value: unknown): FleetRelease | null {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (!isText(data.image, 300) || !isStamp(data.promotedAt)) return null;
  const fleet: FleetRelease = {
    image: data.image, promotedAt: data.promotedAt,
    source: isText(data.source, 40) ? data.source : "unknown",
    settingsGeneration: isCount(data.settingsGeneration) ? data.settingsGeneration : 0,
  };
  if (isText(data.previousImage, 300)) fleet.previousImage = data.previousImage;
  const paused = data.paused as Record<string, unknown> | null | undefined;
  if (paused && typeof paused === "object" && isStamp(paused.at) && isText(paused.reason)) {
    fleet.paused = { at: paused.at, reason: paused.reason };
    if (isText(paused.workspace, 40)) fleet.paused.workspace = paused.workspace;
  }
  const tick = lease(data.tickLease);
  if (tick) fleet.tickLease = tick;
  return fleet;
}

function parseAttempt(value: unknown): ReleaseAttempt | undefined {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return undefined;
  if (data.stage !== "deploying" && data.stage !== "verifying" && data.stage !== "failed") return undefined;
  if (!isText(data.target, 300) || !isCount(data.targetSettings)) return undefined;
  if (!isStamp(data.startedAt) || !isStamp(data.updatedAt)) return undefined;
  const attempt: ReleaseAttempt = {
    stage: data.stage, target: data.target, targetSettings: data.targetSettings,
    fromImage: isText(data.fromImage, 300) ? data.fromImage : null,
    fromDeploymentId: isText(data.fromDeploymentId, 200) ? data.fromDeploymentId : null,
    accountsBefore: Array.isArray(data.accountsBefore)
      ? data.accountsBefore.filter((id): id is string => isText(id, 100)) : [],
    startedAt: data.startedAt, updatedAt: data.updatedAt,
  };
  if (isText(data.deploymentId, 200)) attempt.deploymentId = data.deploymentId;
  if (isStamp(data.deployedAt)) attempt.deployedAt = data.deployedAt;
  if (isText(data.detail)) attempt.detail = data.detail;
  return attempt;
}

/** A bot's record, or a fresh one for a bot this console has never released to. */
export function parseBotRelease(value: unknown): BotRelease {
  const data = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const release: BotRelease = {
    image: isText(data.image, 300) ? data.image : null,
    settingsGeneration: isCount(data.settingsGeneration) ? data.settingsGeneration : 0,
  };
  const attempt = parseAttempt(data.attempt);
  if (attempt) release.attempt = attempt;
  const held = lease(data.lease);
  if (held) release.lease = held;
  return release;
}

export function inFlight(release: BotRelease): boolean {
  return release.attempt?.stage === "deploying" || release.attempt?.stage === "verifying";
}

/**
 * Whether this bot should be rolled to the fleet's target.
 *
 * A bot whose last attempt at exactly this target failed is not behind: it is
 * the reason the fleet paused, and trying it again would only fail it again.
 * A newer target, or new settings, makes it behind once more.
 */
export function behind(release: BotRelease, fleet: FleetRelease): boolean {
  if (inFlight(release)) return false;
  const attempt = release.attempt;
  if (attempt?.stage === "failed" && attempt.target === fleet.image
      && attempt.targetSettings === fleet.settingsGeneration) return false;
  return release.image !== fleet.image || release.settingsGeneration < fleet.settingsGeneration;
}

export function leaseHeld(held: { until: string } | undefined, now: number): boolean {
  return !!held && Date.parse(held.until) > now;
}

const stamp = (now: number) => new Date(now).toISOString();

export function startAttempt(fleet: FleetRelease, before: {
  image: string | null; deploymentId: string | null; accounts: string[];
}, now: number): ReleaseAttempt {
  return {
    stage: "deploying", target: fleet.image, targetSettings: fleet.settingsGeneration,
    fromImage: before.image, fromDeploymentId: before.deploymentId,
    accountsBefore: [...before.accounts].sort(), startedAt: stamp(now), updatedAt: stamp(now),
  };
}

export function deployed(attempt: ReleaseAttempt, now: number): ReleaseAttempt {
  return { ...attempt, stage: "verifying", deployedAt: stamp(now), updatedAt: stamp(now) };
}

export function failed(attempt: ReleaseAttempt, detail: string, now: number): ReleaseAttempt {
  return { ...attempt, stage: "failed", detail: detail.slice(0, 400), updatedAt: stamp(now) };
}

/** The bot is on the target: the attempt is done and forgotten. */
export function settled(attempt: ReleaseAttempt): BotRelease {
  return { image: attempt.target, settingsGeneration: attempt.targetSettings };
}

export function pastDeadline(attempt: ReleaseAttempt, now: number): boolean {
  if (attempt.stage === "deploying") return now - Date.parse(attempt.startedAt) > DEPLOY_DEADLINE_MS;
  if (attempt.stage === "verifying") {
    return now - Date.parse(attempt.deployedAt ?? attempt.updatedAt) > VERIFY_DEADLINE_MS;
  }
  return false;
}

/** Every account that was connected before is connected now. */
export function accountsBack(before: string[], now: string[]): boolean {
  const connected = new Set(now);
  return before.every((id) => connected.has(id));
}

/**
 * A new target. It clears a pause -- a later release is presumably the fix for
 * whatever stopped the last -- and keeps the settings generation.
 *
 * The SAME image again changes nothing, pause included. A re-run of the CI job
 * promotes the image it promoted before; if that cleared the pause, every bot
 * after the canary would be handed the very release the canary just failed.
 * Resuming past a failure is `fleet resume`, which somebody does on purpose.
 */
export function promote(current: FleetRelease | null, image: string, source: string, now: number): FleetRelease {
  if (current?.image === image) return current;
  const next: FleetRelease = {
    image, promotedAt: stamp(now), source,
    settingsGeneration: current?.settingsGeneration ?? 0,
  };
  if (current) next.previousImage = current.image;
  return next;
}
