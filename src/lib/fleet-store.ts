import "server-only";
import { randomUUID } from "node:crypto";
import {
  RELEASE_LEASE_MS,
  TICK_LEASE_MS,
  leaseHeld,
  parseBotRelease,
  parseFleet,
  promote,
  type BotRelease,
  type FleetPause,
  type FleetRelease,
} from "@/src/domains/bot-release";
import { deletionFenced, parseRun } from "@/src/domains/provision-run";
import { firestoreAdmin } from "./firebase-admin";
import { botOrigin, onboardingOf, type Workspace } from "./workspace";

/**
 * Where the fleet rollout keeps its state, and who may move it.
 *
 * `consoleFleet/release` is the fleet: its target image, its settings
 * generation, whether it is paused, and the lease the tick holds so two ticks
 * -- the schedule and a manual run, say -- never both start a bot. Each bot's
 * own record is `workspaces/{id}.release`, beside the `provisioning` record it
 * was built from, with a lease of its own: that is what account deletion
 * checks, the same way it waits out a provisioning step.
 */

export const FLEET_COLLECTION = "consoleFleet";
const FLEET_DOC = "release";

const fleetRef = () => firestoreAdmin().collection(FLEET_COLLECTION).doc(FLEET_DOC);
const workspaceRef = (id: string) => firestoreAdmin().collection("workspaces").doc(id);

/** Firestore refuses undefined, and absent is what every optional field means. */
function clean<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) {
    if (field === undefined) continue;
    out[key] = field && typeof field === "object" && !Array.isArray(field)
      ? clean(field as Record<string, unknown>) : field;
  }
  return out;
}

export async function readFleet(): Promise<FleetRelease | null> {
  return parseFleet((await fleetRef().get()).data());
}

/** Set the fleet's target. The same image again changes nothing (`promote`). */
export async function promoteFleet(image: string, source: string, now = Date.now()): Promise<FleetRelease> {
  return firestoreAdmin().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(fleetRef());
    const current = parseFleet(snapshot.data());
    const next = promote(current, image, source, now);
    if (next !== current) {
      // The tick's lease survives a promotion; everything else is the new target's.
      transaction.set(fleetRef(), clean({ ...next, tickLease: current?.tickLease ?? null }));
    }
    return next;
  });
}

/** Change the fleet record under a transaction; for pause, resume and settings. */
export async function updateFleet(change: (fleet: FleetRelease) => FleetRelease): Promise<FleetRelease | null> {
  return firestoreAdmin().runTransaction(async (transaction) => {
    const current = parseFleet((await transaction.get(fleetRef())).data());
    if (!current) return null;
    const next = change(current);
    transaction.set(fleetRef(), clean({ ...next, paused: next.paused ?? null, tickLease: next.tickLease ?? null }));
    return next;
  });
}

export function pauseFleet(pause: FleetPause): Promise<FleetRelease | null> {
  return updateFleet((fleet) => ({ ...fleet, paused: pause }));
}

/**
 * Take the tick's lease, or null when another tick holds it (or there is no
 * fleet yet). The holder is fresh every time, so a tick that overran its lease
 * cannot later release one it no longer owns.
 */
export async function claimTick(now = Date.now()): Promise<{ fleet: FleetRelease; holder: string } | null> {
  return firestoreAdmin().runTransaction(async (transaction) => {
    const fleet = parseFleet((await transaction.get(fleetRef())).data());
    if (!fleet || leaseHeld(fleet.tickLease, now)) return null;
    const holder = randomUUID();
    const claimed = { ...fleet, tickLease: { holder, until: new Date(now + TICK_LEASE_MS).toISOString() } };
    transaction.set(fleetRef(), clean({ ...claimed, paused: claimed.paused ?? null }));
    return { fleet: claimed, holder };
  });
}

export async function releaseTick(holder: string): Promise<void> {
  await firestoreAdmin().runTransaction(async (transaction) => {
    const fleet = parseFleet((await transaction.get(fleetRef())).data());
    if (!fleet || fleet.tickLease?.holder !== holder) return;
    transaction.set(fleetRef(), clean({ ...fleet, paused: fleet.paused ?? null, tickLease: null }));
  });
}

/** A bot this console built, as the rollout sees it. */
export type FleetBot = {
  workspace: Workspace;
  serviceId: string;
  release: BotRelease;
  deletingAt: unknown;
};

/**
 * Every console-built bot: a workspace whose provisioning run finished and
 * names the service it built. A bot connected by hand has no such record and
 * is never touched, the same rule account deletion follows.
 */
export async function listFleetBots(): Promise<FleetBot[]> {
  const snapshot = await firestoreAdmin().collection("workspaces")
    .where("provisioning.outcome", "==", "ready").get();
  const bots: FleetBot[] = [];
  for (const document of snapshot.docs) {
    const data = document.data() ?? {};
    const run = parseRun(data.provisioning);
    const serviceId = run?.railway.serviceId;
    const baseUrl = data.bot && typeof data.bot === "object" ? botOrigin((data.bot as { baseUrl?: unknown }).baseUrl) : null;
    if (!serviceId || !baseUrl || typeof data.ownerUid !== "string") continue;
    bots.push({
      workspace: {
        id: document.id, ownerUid: data.ownerUid, bot: { baseUrl }, onboarding: onboardingOf(data.onboarding, true),
        name: typeof data.name === "string" && data.name.trim() ? data.name : "Workspace",
      },
      serviceId,
      release: parseBotRelease(data.release),
      deletingAt: data.deletingAt,
    });
  }
  return bots.sort((a, b) => a.workspace.id.localeCompare(b.workspace.id));
}

/**
 * Take a bot's lease for one step, or null: the account is being deleted, or
 * somebody else is already working on this bot. Read fresh inside the
 * transaction, so the record the step works from is the stored one.
 */
export async function claimBot(workspaceId: string, now = Date.now()): Promise<{ release: BotRelease; holder: string } | null> {
  return firestoreAdmin().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(workspaceRef(workspaceId));
    if (!snapshot.exists || deletionFenced(snapshot.get("deletingAt"), now)) return null;
    const release = parseBotRelease(snapshot.get("release"));
    if (leaseHeld(release.lease, now)) return null;
    const holder = randomUUID();
    const claimed = { ...release, lease: { holder, until: new Date(now + RELEASE_LEASE_MS).toISOString() } };
    transaction.update(workspaceRef(workspaceId), { release: clean(claimed) });
    return { release: claimed, holder };
  });
}

/** Write where the step got to and let the lease go, unless it is no longer ours. */
export async function saveBot(workspaceId: string, release: BotRelease, holder: string): Promise<void> {
  await firestoreAdmin().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(workspaceRef(workspaceId));
    if (!snapshot.exists) return;
    const stored = parseBotRelease(snapshot.get("release"));
    if (stored.lease && stored.lease.holder !== holder) return;
    const { lease: _lease, ...rest } = release;
    transaction.update(workspaceRef(workspaceId), { release: clean(rest) });
  });
}

/** Record the image a newly built bot was created from, so the rollout knows. */
export async function recordBotImage(workspaceId: string, image: string): Promise<void> {
  await workspaceRef(workspaceId).update({ release: { image, settingsGeneration: (await readFleet())?.settingsGeneration ?? 0 } });
}
