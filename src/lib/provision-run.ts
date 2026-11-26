import "server-only";
import { randomUUID } from "node:crypto";
import {
  LEASE_MS,
  deletionFenced,
  leaseHeld,
  newRun,
  parseRun,
  rearmRun,
  type ProvisionRun,
} from "@/src/domains/provision-run";
import { leaseHeld as releaseLeaseActive, parseBotRelease } from "@/src/domains/bot-release";
import { firestoreAdmin } from "./firebase-admin";

const releaseLeaseHeld = (value: unknown, now: number) => releaseLeaseActive(parseBotRelease(value).lease, now);
import { WorkspaceUnavailableError, type Workspace } from "./workspace";

/**
 * Where a provisioning run is kept, and who is allowed to move it.
 *
 * The record is `workspaces/{id}.provisioning`, beside the `bot` field a
 * finished run writes. The console owns this document already, so a run adds no
 * new collection and no new access rule.
 *
 * A run has no process of its own: the browser's poll is what advances it. Two
 * polls can therefore arrive at once, on two instances, and both would otherwise
 * create a service. The lease is what stops that -- one holder at a time, taken
 * and released in a transaction, with a TTL so an instance that dies mid-step
 * does not wedge the run for ever. Every step is written to be re-enterable,
 * because a lease that expires mid-step is exactly a step run twice.
 */

export type RunClaim =
  /** No run has ever been started for this workspace. */
  | { kind: "none" }
  /** There is a record, and this console cannot read it. Not the same as "none":
   *  a run we cannot read may have a live service behind it, so offering to
   *  create a bot again could build a second one. */
  | { kind: "broken" }
  /** There is a run, but it is not ours to move: another instance holds the
   *  lease, or it has already finished. Report its state and change nothing. */
  | { kind: "busy"; run: ProvisionRun }
  /** The lease is ours until `run.lease.until`. Advance one step, then save. */
  | { kind: "claimed"; run: ProvisionRun };

function reference(workspace: Workspace) {
  return firestoreAdmin().collection("workspaces").doc(workspace.id);
}

/** Firestore refuses an undefined value, and an absent key is what every
 *  optional field here means, so they are dropped rather than written. */
function toDocument(run: ProvisionRun): Record<string, unknown> {
  const document: Record<string, unknown> = {
    stage: run.stage, outcome: run.outcome, startedAt: run.startedAt,
    updatedAt: run.updatedAt, attempt: run.attempt, railway: { ...run.railway },
  };
  if (run.detail !== undefined) document.detail = run.detail;
  if (run.readyAt !== undefined) document.readyAt = run.readyAt;
  if (run.failedAt !== undefined) document.failedAt = run.failedAt;
  if (run.lease !== undefined) document.lease = { ...run.lease };
  return document;
}

export async function readRun(workspace: Workspace): Promise<ProvisionRun | null> {
  try {
    const snapshot = await reference(workspace).get();
    if (!snapshot.exists) throw new WorkspaceUnavailableError();
    return parseRun(snapshot.get("provisioning"));
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) throw error;
    throw new WorkspaceUnavailableError("Your bot's setup could not be read. Try again shortly.");
  }
}

/**
 * Start a run, join the one already going, or re-arm the one that failed.
 *
 * All three are the same request -- the screen's button posts the same thing
 * whether it says "Create my bot" or "Try again" -- so they are one transaction.
 * A re-armed run keeps the Railway ids it had, which is what makes trying again
 * carry on rather than build a second service.
 */
export async function startRun(workspace: Workspace, now = Date.now()): Promise<ProvisionRun> {
  const reference_ = reference(workspace);
  try {
    return await firestoreAdmin().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference_);
      if (!snapshot.exists) throw new WorkspaceUnavailableError("Your workspace could not be found.");
      // The account is being deleted, and its bot with it: a run started now
      // could build a service after the teardown had already looked.
      if (deletionFenced(snapshot.get("deletingAt"), now)) {
        throw new WorkspaceUnavailableError("Your account is being deleted, so no bot can be created.");
      }
      const stored = snapshot.get("provisioning");
      const existing = parseRun(stored);
      // A record we cannot read is not a blank slate. It may name a service, a
      // volume and a domain that exist, and starting over would build a second
      // volume and bill for it. Refused, so somebody looks at it instead.
      if (!existing && stored !== undefined) {
        throw new WorkspaceUnavailableError(
          "Your bot's setup could not be read. Ask whoever runs this console to look at it.");
      }
      if (existing && existing.outcome !== "failed") return existing;
      const run = existing ? rearmRun(existing, now) : newRun(now);
      transaction.update(reference_, { provisioning: toDocument(run) });
      return run;
    });
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) throw error;
    throw new WorkspaceUnavailableError("Your bot's setup could not be started. Try again shortly.");
  }
}

/**
 * Take the lease, if there is work to do and nobody else is doing it.
 *
 * A finished run is `busy`: there is nothing to advance, and the poll should
 * report what it says. The holder is a fresh token each time, so a step that
 * overran its lease cannot later clear a lease it no longer owns.
 */
export async function claimRun(workspace: Workspace, now = Date.now()): Promise<RunClaim> {
  const reference_ = reference(workspace);
  try {
    return await firestoreAdmin().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference_);
      if (!snapshot.exists) throw new WorkspaceUnavailableError("Your workspace could not be found.");
      const stored = snapshot.get("provisioning");
      const run = parseRun(stored);
      if (!run) return { kind: stored === undefined ? "none" : "broken" } as RunClaim;
      // A deletion in progress is reported like a held lease: nothing moves.
      if (run.outcome !== "running" || leaseHeld(run, now) || deletionFenced(snapshot.get("deletingAt"), now)) {
        return { kind: "busy", run } as RunClaim;
      }
      const claimed: ProvisionRun = {
        ...run,
        lease: { holder: randomUUID(), until: new Date(now + LEASE_MS).toISOString() },
      };
      transaction.update(reference_, { provisioning: toDocument(claimed) });
      return { kind: "claimed", run: claimed } as RunClaim;
    });
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) throw error;
    throw new WorkspaceUnavailableError("Your bot's setup could not be read. Try again shortly.");
  }
}

/**
 * Write the run, optionally letting the lease go.
 *
 * Nothing is written when the stored lease has passed to somebody else: the run
 * belongs to whoever holds it now, and a step re-entered by that holder reaches
 * the same place anyway. That is also why losing a lease mid-step is survivable
 * rather than corrupting -- the writes a step makes are all of this shape.
 */
async function writeRun(workspace: Workspace, run: ProvisionRun, release: boolean): Promise<void> {
  const holder = run.lease?.holder;
  const next: ProvisionRun = release ? { ...run, lease: undefined } : run;
  const reference_ = reference(workspace);
  try {
    await firestoreAdmin().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference_);
      if (!snapshot.exists) throw new WorkspaceUnavailableError("Your workspace could not be found.");
      const stored = parseRun(snapshot.get("provisioning"));
      if (holder && stored?.lease && stored.lease.holder !== holder) return;
      transaction.update(reference_, { provisioning: toDocument(next) });
    });
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) throw error;
    throw new WorkspaceUnavailableError("Your bot's setup could not be saved. Try again shortly.");
  }
}

/**
 * Write down a resource the moment Railway hands it over, keeping the lease.
 *
 * This is what makes a step safe to re-enter: an id that is already recorded is
 * never created twice. It is a write of its own, rather than part of the step's
 * final save, because the crash this protects against is the one in the middle.
 */
export async function recordRun(workspace: Workspace, run: ProvisionRun): Promise<void> {
  await writeRun(workspace, run, false);
}

/** The step is over: write where it got to and release the lease. */
export async function saveRun(workspace: Workspace, run: ProvisionRun): Promise<void> {
  await writeRun(workspace, run, true);
}

/** A step holds the lease right now, so what it is building is not yet written
 *  down. Deleting the account in that moment could leave that one thing behind. */
export class ProvisioningBusyError extends WorkspaceUnavailableError {
  constructor(detail = "Your bot is still being set up. Try again in a minute.") {
    super(detail);
    this.name = "ProvisioningBusyError";
  }
}

/**
 * The first step of deleting an account: fence provisioning off, and hand back
 * the run record so the teardown knows which Railway resources are this
 * workspace's.
 *
 * One transaction, so no poll can claim the run between the lease being read
 * and the fence going up. A held lease refuses outright: that step may be
 * creating something this instant that the record does not name yet. A lease
 * lasts at most `LEASE_MS`, so trying again a minute later succeeds.
 *
 * A record this console cannot read comes back as null. That is safe here,
 * unlike in `startRun`: the teardown also looks the bot's service up by its
 * name, which finds it whatever the record says.
 */
export async function beginDeletion(workspace: Workspace, now = Date.now()): Promise<ProvisionRun | null> {
  const reference_ = reference(workspace);
  try {
    return await firestoreAdmin().runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference_);
      if (!snapshot.exists) throw new WorkspaceUnavailableError("Your workspace could not be found.");
      const run = parseRun(snapshot.get("provisioning"));
      if (run?.outcome === "running" && leaseHeld(run, now)) throw new ProvisioningBusyError();
      // A release step is changing this bot's image or settings right now; the
      // teardown would race it. Its lease is a minute at most, like a run's.
      if (releaseLeaseHeld(snapshot.get("release"), now)) {
        throw new ProvisioningBusyError("Your bot is being updated right now. Try again in a minute.");
      }
      transaction.update(reference_, { deletingAt: new Date(now).toISOString() });
      return run;
    });
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) throw error;
    throw new WorkspaceUnavailableError("Your account could not be deleted. Try again shortly.");
  }
}

/**
 * The bot this workspace is pointed at, read fresh rather than from the cached
 * `Workspace`. The connecting step needs it to tell its own earlier success
 * (the same origin, written before a lease expired) from somebody else's bot.
 */
export async function readConnectedBot(workspace: Workspace): Promise<string | null> {
  try {
    const snapshot = await reference(workspace).get();
    const bot = snapshot.get("bot");
    const baseUrl = (bot as { baseUrl?: unknown } | null)?.baseUrl;
    return typeof baseUrl === "string" && baseUrl ? baseUrl : null;
  } catch {
    throw new WorkspaceUnavailableError();
  }
}
