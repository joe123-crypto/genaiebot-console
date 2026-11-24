/**
 * Creating a workspace's bot, as the screen sees it.
 *
 * A workspace with no bot can do nothing until one exists, so `/setup` runs the
 * creation itself and shows how far it has got. The stages here are the manual
 * runbook's steps (`docs/provision-bot.md`): reserve the service, start it,
 * seed its config, then connect it to the workspace. They are named for what
 * the user is waiting on, not for the infrastructure doing it, so the labels
 * survive a change of host.
 *
 * Nothing here reaches anything. The run's whole state is a value, which is
 * what lets the screen, the route and the tests all agree on what a stage means.
 */

export const PROVISION_STAGES = ["reserving", "starting", "seeding", "connecting"] as const;
export type ProvisionStage = (typeof PROVISION_STAGES)[number];

/**
 * `simulated` marks a run that only looked like one: the development stub
 * finished without creating anything. The screen says so rather than sending
 * someone to a bot that is not there.
 */
export type ProvisionState =
  | { status: "idle" }
  | { status: "running"; stage: ProvisionStage; startedAt: string }
  | { status: "ready"; readyAt: string; simulated?: boolean }
  | { status: "failed"; stage: ProvisionStage; detail: string; failedAt: string };

export const STAGE_LABEL: Record<ProvisionStage, string> = {
  reserving: "Reserving your bot",
  starting: "Starting it up",
  seeding: "Setting up its config",
  connecting: "Connecting it to your workspace",
};

/** What the step list draws for one stage of a run. */
export type StepState = "done" | "current" | "pending" | "failed";

export function stageStatus(state: ProvisionState, stage: ProvisionStage): StepState {
  const position = PROVISION_STAGES.indexOf(stage);
  if (state.status === "idle") return "pending";
  if (state.status === "ready") return "done";
  const reached = PROVISION_STAGES.indexOf(state.stage);
  if (position < reached) return "done";
  if (position > reached) return "pending";
  return state.status === "failed" ? "failed" : "current";
}

export function isTerminal(state: ProvisionState): boolean {
  return state.status === "ready" || state.status === "failed";
}

/** How long each stage is shown for while a run has nothing better to report. */
export const STAGE_MS = 4_000;

/**
 * The run's state from when it started, with no timer and nothing stored per
 * stage: a reload, a second tab and the server all compute the same answer from
 * the same instant. The real provisioner will report its own stage instead;
 * this is what the development stub advances on.
 */
export function stateFromElapsed(startedAt: number, now: number): ProvisionState {
  const elapsed = Math.max(0, now - startedAt);
  const index = Math.floor(elapsed / STAGE_MS);
  if (index >= PROVISION_STAGES.length) {
    return { status: "ready", readyAt: new Date(startedAt + STAGE_MS * PROVISION_STAGES.length).toISOString() };
  }
  return { status: "running", stage: PROVISION_STAGES[index], startedAt: new Date(startedAt).toISOString() };
}

const isStage = (value: unknown): value is ProvisionStage =>
  typeof value === "string" && (PROVISION_STAGES as readonly string[]).includes(value);
const isStamp = (value: unknown): value is string =>
  typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));

/**
 * The browser trusts no payload's shape, as with the account and pairing reads.
 * An answer that is not a state this screen knows how to draw is not guessed at.
 */
export function checkProvisionState(value: unknown): ProvisionState {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("The setup status could not be read.");
  switch (data.status) {
    case "idle":
      return { status: "idle" };
    case "running":
      if (!isStage(data.stage) || !isStamp(data.startedAt)) break;
      return { status: "running", stage: data.stage, startedAt: data.startedAt };
    case "ready":
      if (!isStamp(data.readyAt)) break;
      return { status: "ready", readyAt: data.readyAt, ...(data.simulated === true ? { simulated: true } : {}) };
    case "failed":
      if (!isStage(data.stage) || !isStamp(data.failedAt) || typeof data.detail !== "string" || !data.detail.trim()) break;
      return { status: "failed", stage: data.stage, detail: data.detail.slice(0, 400), failedAt: data.failedAt };
  }
  throw new Error("The setup status could not be read.");
}
