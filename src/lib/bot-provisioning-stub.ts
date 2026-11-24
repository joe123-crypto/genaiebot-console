import "server-only";
import { BOT_PROVISIONING_STUB_URL } from "@/src/config";
import {
  PROVISION_STAGES,
  STAGE_MS,
  stateFromElapsed,
  type ProvisionState,
} from "@/src/domains/bot-provisioning";
import { BotConnectError, connectBot } from "./bot-connect";
import type { Workspace } from "./workspace";

/**
 * The creation screen's stand-in until a real provisioner exists.
 *
 * It builds nothing. A run is one instant -- when it started -- and every stage
 * after that is `stateFromElapsed` reading the clock, so a reload, a second tab
 * and the server all answer the same thing without a timer between them.
 *
 * The runs live on `globalThis` so they survive a development hot reload, the
 * same reason the workspace cache does. A real provisioner must not copy this:
 * an in-memory map is per process, and Railway may run more than one, so its
 * run state belongs in the registry (a `workspaces/{id}.provisioning` field).
 */

// Defence in depth behind BOT_PROVISIONING, which is already never "stub" in
// production: a screen that pretended to create a bot there would be a lie.
if (process.env.NODE_ENV === "production") throw new Error("The provisioning stub cannot run in production.");

type Run = { startedAt: number; outcome?: ProvisionState; settling?: Promise<ProvisionState> };
const global = globalThis as typeof globalThis & { __genaieProvisioning?: Map<string, Run> };
const runs = (global.__genaieProvisioning ??= new Map<string, Run>());

/** Exported for the tests, which need a workspace that has never been run. */
export function forgetProvisioningRuns(): void { runs.clear(); }

const LAST_STAGE = PROVISION_STAGES[PROVISION_STAGES.length - 1];

export async function readProvisionState(workspace: Workspace): Promise<ProvisionState> {
  const run = runs.get(workspace.id);
  if (!run) return { status: "idle" };
  if (run.outcome) return run.outcome;
  const state = stateFromElapsed(run.startedAt, Date.now());
  // The last stage is the only one that does anything, and it only does it
  // once: settle it here, so every later read reports what it decided.
  if (state.status !== "ready") return state;
  // The run has no process of its own, so the poll that finds it finished is
  // what connects it. The in-flight promise is what stops two polls doing it
  // twice -- the registry write is not something to race.
  run.settling ??= settle(workspace, state.readyAt);
  run.outcome = await run.settling;
  return run.outcome;
}

export async function startProvisioning(workspace: Workspace): Promise<ProvisionState> {
  // A second tab, or a second click, joins the run already going rather than
  // starting another one.
  const existing = runs.get(workspace.id);
  if (existing) return readProvisionState(workspace);
  const startedAt = Date.now();
  runs.set(workspace.id, { startedAt });
  return stateFromElapsed(startedAt, startedAt);
}

/**
 * What a finished run leaves behind. With a bot origin to connect to, the real
 * handshake runs and the workspace comes out of this genuinely connected; with
 * none, nothing is written and the run says it was simulated.
 */
async function settle(workspace: Workspace, readyAt: string): Promise<ProvisionState> {
  if (!BOT_PROVISIONING_STUB_URL) return { status: "ready", readyAt, simulated: true };
  try {
    await connectBot(workspace, BOT_PROVISIONING_STUB_URL);
  } catch (error) {
    const detail = error instanceof BotConnectError ? error.message
      : "Your bot could not be connected to your workspace.";
    return { status: "failed", stage: LAST_STAGE, detail, failedAt: new Date().toISOString() };
  }
  return { status: "ready", readyAt };
}

/** How long a whole stubbed run takes, for the tests and the screen's copy. */
export const STUB_RUN_MS = STAGE_MS * PROVISION_STAGES.length;
