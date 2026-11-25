import { PROVISION_STAGES, type ProvisionStage, type ProvisionState } from "./bot-provisioning";

/**
 * A provisioning run as it is stored, and the transitions between its states.
 *
 * The screen's view of a run is `ProvisionState` (`./bot-provisioning`): a value
 * with no history. A real run needs more than that -- which Railway resources it
 * has already created, and which instance is currently working on it -- because
 * it outlives the request that started it. That record is this module, kept pure
 * so the provisioner is only the part that reaches things, and so every rule
 * about re-entering a stage can be tested without Firestore or Railway.
 *
 * The record lives in `workspaces/{id}.provisioning`, next to the `bot` field a
 * finished run writes. It is deliberately not an in-memory map: Railway may run
 * more than one console instance, and each of them polls.
 */

/** What a run has built so far. Every id is recorded before the next call is
 *  made, which is what lets a re-entered stage carry on instead of building a
 *  second service. */
export type RailwayResources = {
  serviceId?: string;
  volumeId?: string;
  domainId?: string;
  /** Host only, as Railway hands it over: `bot-x-production-ab12.up.railway.app`. */
  domain?: string;
  /** When the whole variable set was last written, so a re-entered step skips it. */
  variablesAt?: string;
  /** When the image was set on the service. That call is also the first deploy,
   *  so a re-entered step must never make it twice. */
  sourceSetAt?: string;
  deploymentId?: string;
  /** Which attempt triggered that deployment. A retry after a failed deploy must
   *  start a new one rather than poll the old one's verdict for ever. */
  deploymentAttempt?: number;
  /** When the bot first answered for this workspace. */
  servingAt?: string;
};

export type RunOutcome = "running" | "ready" | "failed";

export type ProvisionRun = {
  stage: ProvisionStage;
  outcome: RunOutcome;
  startedAt: string;
  updatedAt: string;
  /** Bumped each time a failed run is tried again, for the logs and the tests. */
  attempt: number;
  detail?: string;
  readyAt?: string;
  failedAt?: string;
  railway: RailwayResources;
  lease?: { holder: string; until: string };
};

/**
 * How long one claimed step may take. Every step is a handful of API calls and
 * returns rather than waiting on anything, so this is generous by design: it is
 * the window after which another instance may assume the holder died. Timestamps
 * are each instance's own clock, so the margin also covers ordinary skew.
 */
export const LEASE_MS = 60_000;

/** How long a whole run may take before it is called off. A Railway image pull
 *  and boot is well inside this; a wedged one must not poll for ever. */
export const RUN_DEADLINE_MS = 15 * 60_000;

const isStage = (value: unknown): value is ProvisionStage =>
  typeof value === "string" && (PROVISION_STAGES as readonly string[]).includes(value);
const isStamp = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
const isId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 200;

function resources(value: unknown): RailwayResources {
  const data = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const kept: RailwayResources = {};
  for (const key of ["serviceId", "volumeId", "domainId", "domain", "deploymentId"] as const) {
    if (isId(data[key])) kept[key] = data[key] as string;
  }
  for (const key of ["variablesAt", "sourceSetAt", "servingAt"] as const) {
    if (isStamp(data[key])) kept[key] = data[key] as string;
  }
  if (typeof data.deploymentAttempt === "number" && Number.isInteger(data.deploymentAttempt)) {
    kept.deploymentAttempt = data.deploymentAttempt;
  }
  return kept;
}

/**
 * The stored record, or null when there is no run to speak of.
 *
 * A record this cannot read is treated as no run rather than guessed at, the
 * same choice `checkProvisionState` makes about a payload. That is deliberate
 * and it is safe: the workspace's `bot` field, not this record, is what says a
 * bot exists, so the worst a dropped record costs is a run started again.
 */
export function parseRun(value: unknown): ProvisionRun | null {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  if (!isStage(data.stage) || !isStamp(data.startedAt) || !isStamp(data.updatedAt)) return null;
  if (data.outcome !== "running" && data.outcome !== "ready" && data.outcome !== "failed") return null;
  const attempt = typeof data.attempt === "number" && Number.isInteger(data.attempt) && data.attempt >= 1
    ? data.attempt : 1;
  const run: ProvisionRun = {
    stage: data.stage, outcome: data.outcome, startedAt: data.startedAt, updatedAt: data.updatedAt,
    attempt, railway: resources(data.railway),
  };
  // A failure with no reason could not be drawn, so it is not a failure we keep.
  if (data.outcome === "failed") {
    if (typeof data.detail !== "string" || !data.detail.trim()) return null;
    run.detail = data.detail.slice(0, 400);
    run.failedAt = isStamp(data.failedAt) ? data.failedAt : data.updatedAt;
  }
  if (data.outcome === "ready") run.readyAt = isStamp(data.readyAt) ? data.readyAt : data.updatedAt;
  const lease = data.lease as Record<string, unknown> | undefined;
  if (lease && typeof lease === "object" && isId(lease.holder) && isStamp(lease.until)) {
    run.lease = { holder: lease.holder, until: lease.until };
  }
  return run;
}

/** What the screen is told. Every branch is a state `checkProvisionState` accepts. */
export function runState(run: ProvisionRun): ProvisionState {
  if (run.outcome === "ready") return { status: "ready", readyAt: run.readyAt ?? run.updatedAt };
  if (run.outcome === "failed") {
    return { status: "failed", stage: run.stage, detail: run.detail ?? "Your bot could not be created.",
             failedAt: run.failedAt ?? run.updatedAt };
  }
  return { status: "running", stage: run.stage, startedAt: run.startedAt };
}

export function leaseHeld(run: ProvisionRun, now: number): boolean {
  return !!run.lease && Date.parse(run.lease.until) > now;
}

export function pastDeadline(run: ProvisionRun, now: number): boolean {
  return now - Date.parse(run.startedAt) > RUN_DEADLINE_MS;
}

export function newRun(now: number): ProvisionRun {
  const at = new Date(now).toISOString();
  return { stage: PROVISION_STAGES[0], outcome: "running", startedAt: at, updatedAt: at, attempt: 1, railway: {} };
}

/**
 * A failed run, tried again. The clock restarts, because the deadline is about
 * how long *this* attempt may take; what is kept is `railway`, so the attempt
 * carries on from the resources the last one built rather than duplicating them.
 */
export function rearmRun(run: ProvisionRun, now: number): ProvisionRun {
  const at = new Date(now).toISOString();
  return { stage: run.stage, outcome: "running", startedAt: at, updatedAt: at,
           attempt: run.attempt + 1, railway: { ...run.railway } };
}

export function atStage(run: ProvisionRun, stage: ProvisionStage, now: number): ProvisionRun {
  return { ...run, stage, outcome: "running", updatedAt: new Date(now).toISOString() };
}

export function withResources(run: ProvisionRun, railway: RailwayResources, now: number): ProvisionRun {
  return { ...run, railway: { ...run.railway, ...railway }, updatedAt: new Date(now).toISOString() };
}

export function failedRun(run: ProvisionRun, detail: string, now: number): ProvisionRun {
  const at = new Date(now).toISOString();
  const said = detail.trim() ? detail.trim().slice(0, 400) : "Your bot could not be created.";
  return { ...run, outcome: "failed", detail: said, failedAt: at, updatedAt: at };
}

export function readyRun(run: ProvisionRun, now: number): ProvisionRun {
  const at = new Date(now).toISOString();
  return { ...run, stage: PROVISION_STAGES[PROVISION_STAGES.length - 1], outcome: "ready", readyAt: at, updatedAt: at };
}
