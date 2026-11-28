import "server-only";
import { cache } from "react";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { redirect } from "next/navigation";
import { FieldValue, type DocumentData } from "firebase-admin/firestore";
import { BOT_SOURCE } from "@/src/config";
import { getOperator } from "./auth";
import type { Operator } from "./auth-types";
import { BotUnavailableError } from "./bot-errors";
import { firestoreAdmin } from "./firebase-admin";

/**
 * Whose data a request may see.
 *
 * Every user owns exactly one workspace: an opaque id, with the user as its
 * owner. A workspace's data lives under `workspaces/{id}/` in Firestore and is
 * read and written only by that workspace's own bot deployment, which this
 * console reaches at `bot.baseUrl` with a token derived for that workspace.
 * The registry is two documents per user, read and created here and nowhere
 * else:
 *
 *   consoleUsers/{uid}  { email, workspaceId, createdAt }
 *   workspaces/{id}     { name, ownerUid, createdAt, bot: { baseUrl } | null,
 *                         onboarding: { status, at } }
 *
 * The Firebase project, and its sign-in uids, are shared with other apps:
 * agent_genaie keeps its own profiles in a root `users/{uid}`. That is why the
 * pointer lives in `consoleUsers`, never `users`.
 *
 * Keying data by a workspace rather than by the uid itself is what keeps
 * teammates possible later without moving any data: a members list and a
 * change to `canAccess` below. Nothing else assumes one user per workspace.
 *
 * There is deliberately no fallback bot. A workspace without one makes no bot
 * call at all, which is what keeps a new sign-up from ever reaching another
 * user's bot.
 */

/**
 * Whether the first-run wizard (`/onboarding`) is still in the way. `pending`
 * sends every console page there; `skipped` and `done` are both final, and
 * nothing ever sets a workspace back to `pending` after either.
 */
export type OnboardingStatus = "pending" | "skipped" | "done";
const ONBOARDING_STATUSES: readonly OnboardingStatus[] = ["pending", "skipped", "done"];

export type Workspace = {
  id: string;
  name: string;
  ownerUid: string;
  bot: { baseUrl: string } | null;
  onboarding: OnboardingStatus;
  /** When the workspace was made, which is when its owner signed up: the two
   *  are written in one transaction. Null on a workspace registered before
   *  this was recorded, and absent on a Workspace built from anything but the
   *  registry -- a fleet row has no such date to give. */
  createdAt?: string | null;
};
export type BotTarget = { baseUrl: string; token: string; workspaceId: string };

/** The bot's own rule for a workspace id (`GENAIE_WORKSPACE_ID`). */
export const WORKSPACE_ID = /^[A-Za-z0-9_-]{6,40}$/;
export const USERS_COLLECTION = "consoleUsers";
const CACHE_TTL_MS = 30_000;

/** The registry could not be read. Nothing is shown rather than a guess. */
export class WorkspaceUnavailableError extends BotUnavailableError {
  constructor(detail = "Your workspace could not be loaded. Try again shortly.") {
    super(detail, 503);
    this.name = "WorkspaceUnavailableError";
  }
}

/** The workspace exists but no bot is connected to it yet. */
export class NoBotError extends BotUnavailableError {
  constructor() {
    super("No bot is connected to your workspace yet.", 409);
    this.name = "NoBotError";
  }
}

export function newWorkspaceId(): string {
  // 16 base64url characters: 96 bits, and inside the bot's id pattern.
  return `w${randomBytes(12).toString("base64url")}`;
}

/**
 * The bearer token for one workspace's bot. Derived, not stored: the registry
 * holds no secret, and a bot given another workspace's URL by mistake answers
 * 401 rather than serving the wrong data. The bot holds this exact value as its
 * `CONSOLE_API_TOKEN` (printed by `scripts/workspace-admin.mjs connect-bot`).
 */
export function deriveBotToken(workspaceId: string, secret = process.env.BOT_TOKEN_SECRET?.trim()): string {
  if (!WORKSPACE_ID.test(workspaceId)) throw new WorkspaceUnavailableError("This workspace id is invalid.");
  if (!secret || secret.length < 32) {
    throw new WorkspaceUnavailableError("The console cannot reach workspace bots: BOT_TOKEN_SECRET is not configured.");
  }
  return createHmac("sha256", secret).update(`genaie-bot:${workspaceId}`).digest("base64url");
}

/** Only an https origin, or loopback http outside production. */
export function botOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname) &&
      process.env.NODE_ENV !== "production";
    if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.search || url.hash ||
        (url.pathname !== "/" && url.pathname !== "")) return null;
    return url.origin;
  } catch { return null; }
}

/** The one access rule. Teammates later: membership instead of ownership. */
export function canAccess(workspace: Pick<Workspace, "ownerUid">, uid: string): boolean {
  return workspace.ownerUid === uid;
}

/**
 * A registry date as an ISO string. Every one is written with
 * `FieldValue.serverTimestamp()`, so it comes back as a Firestore Timestamp;
 * a document older than the field it is read from simply has none, and a date
 * nobody recorded is never guessed at.
 */
export function registryDate(value: unknown): string | null {
  try {
    const at = value instanceof Date ? value
      : value && typeof value === "object" && typeof (value as { toDate?: unknown }).toDate === "function"
        ? (value as { toDate: () => Date }).toDate()
        : null;
    return at && Number.isFinite(at.getTime()) ? at.toISOString() : null;
  } catch { return null; }
}

function parseWorkspace(id: string, data: DocumentData | undefined): Workspace {
  if (!data || typeof data.ownerUid !== "string") throw new WorkspaceUnavailableError();
  const bot = data.bot && typeof data.bot === "object" ? botOrigin(data.bot.baseUrl) : null;
  // A bot field that is set but unusable is a registry error, not "no bot".
  if (data.bot && !bot) throw new WorkspaceUnavailableError("Your workspace's bot address is invalid.");
  return {
    id, ownerUid: data.ownerUid,
    name: typeof data.name === "string" && data.name.trim() ? data.name : "Workspace",
    bot: bot ? { baseUrl: bot } : null,
    onboarding: onboardingOf(data.onboarding, Boolean(bot)),
    createdAt: registryDate(data.createdAt),
  };
}

/**
 * A workspace made before onboarding existed has no status. One that already
 * has a bot was set up the old way and is left alone; one without is where a
 * new user would be, so it gets the wizard rather than an empty console.
 */
export function onboardingOf(value: unknown, hasBotAlready: boolean): OnboardingStatus {
  const status = value && typeof value === "object" ? (value as { status?: unknown }).status : undefined;
  if (ONBOARDING_STATUSES.includes(status as OnboardingStatus)) return status as OnboardingStatus;
  return hasBotAlready ? "done" : "pending";
}

/**
 * The signed-in user's workspace id, creating the workspace on first use. One
 * transaction, so two first requests at once cannot create two workspaces.
 */
export async function ensureWorkspace(operator: Operator): Promise<string> {
  const db = firestoreAdmin();
  const userRef = db.collection(USERS_COLLECTION).doc(operator.uid);
  return db.runTransaction(async (transaction) => {
    const user = await transaction.get(userRef);
    const existing = user.get("workspaceId");
    if (user.exists && typeof existing === "string" && WORKSPACE_ID.test(existing)) return existing;
    if (user.exists) throw new WorkspaceUnavailableError();
    const id = newWorkspaceId();
    transaction.create(db.collection("workspaces").doc(id), {
      name: `${operator.name}'s workspace`.slice(0, 120), ownerUid: operator.uid,
      createdAt: FieldValue.serverTimestamp(), bot: null,
      onboarding: { status: "pending", at: FieldValue.serverTimestamp() },
    });
    transaction.create(userRef, { email: operator.email, workspaceId: id, createdAt: FieldValue.serverTimestamp() });
    return id;
  });
}

type Cached = { at: number; workspace: Workspace };
const globalCache = globalThis as typeof globalThis & { __genaieWorkspaces?: Map<string, Cached> };
const cached = globalCache.__genaieWorkspaces ??= new Map();

export function forgetCachedWorkspaces(): void { cached.clear(); }

async function loadWorkspace(operator: Operator): Promise<Workspace> {
  const hit = cached.get(operator.uid);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.workspace;
  let workspace: Workspace;
  try {
    const db = firestoreAdmin();
    // Plain reads on the usual path; the transaction only runs for a first visit.
    const user = await db.collection(USERS_COLLECTION).doc(operator.uid).get();
    const pointer = user.get("workspaceId");
    const id = !user.exists ? await ensureWorkspace(operator)
      : typeof pointer === "string" && WORKSPACE_ID.test(pointer) ? pointer : null;
    if (!id) throw new WorkspaceUnavailableError();
    const snapshot = await db.collection("workspaces").doc(id).get();
    workspace = parseWorkspace(id, snapshot.data());
  } catch (error) {
    if (error instanceof WorkspaceUnavailableError) throw error;
    throw new WorkspaceUnavailableError();
  }
  // A pointer to someone else's workspace is refused, never followed.
  if (!canAccess(workspace, operator.uid)) throw new WorkspaceUnavailableError();
  cached.set(operator.uid, { at: Date.now(), workspace });
  return workspace;
}

/** Request-scoped, like getOperator. Null when nobody is signed in. */
export const getWorkspace = cache(async (): Promise<Workspace | null> => {
  const operator = await getOperator();
  return operator ? loadWorkspace(operator) : null;
});

/**
 * Where this request's bot calls go. Throws a BotUnavailableError subclass, so
 * every screen that already explains an unreachable bot explains these too.
 */
export async function botTarget(): Promise<BotTarget> {
  const workspace = await getWorkspace();
  if (!workspace) throw new BotUnavailableError("Sign in to continue.", 401);
  if (!workspace.bot) throw new NoBotError();
  return { baseUrl: workspace.bot.baseUrl, token: deriveBotToken(workspace.id), workspaceId: workspace.id };
}

/** Whether this workspace has a bot to call. The local development adapter is its own bot. */
export function hasBot(workspace: Pick<Workspace, "bot">): boolean {
  return Boolean(workspace.bot) || BOT_SOURCE === "local";
}

/**
 * For the console's own pages: a workspace still in onboarding goes to the
 * wizard. Anything after that -- skipped or done, with or without a bot -- is
 * the page's to render, which is how a user who skipped sets things up from
 * each page in its usual place.
 */
export async function requireWorkspace(): Promise<Workspace> {
  const workspace = await getWorkspace();
  if (!workspace) redirect("/login");
  if (workspace.onboarding === "pending") redirect("/onboarding");
  return workspace;
}

/**
 * For pages that only make sense with a bot behind them (a campaign, the new
 * campaign form): without one there is nothing to show, so they go home, where
 * the page says what to do first.
 */
export async function requireBot(): Promise<Workspace> {
  const workspace = await requireWorkspace();
  if (!hasBot(workspace)) redirect("/");
  return workspace;
}

/**
 * Record how onboarding ended for the signed-in user's own workspace. Only
 * ever forward: `pending` is never written back once it has ended.
 */
export async function finishOnboarding(status: Exclude<OnboardingStatus, "pending">): Promise<void> {
  const operator = await getOperator();
  const workspace = operator ? await loadWorkspace(operator) : null;
  if (!operator || !workspace) throw new WorkspaceUnavailableError("Sign in to continue.");
  if (workspace.onboarding !== "pending") return;
  await firestoreAdmin().collection("workspaces").doc(workspace.id)
    .update({ onboarding: { status, at: FieldValue.serverTimestamp() } });
  cached.delete(operator.uid);
}

/**
 * A workspace made before onboarding existed reads as `pending` only while it
 * has no bot. Before its bot is created, write that down, or the wizard would
 * end itself the moment the bot arrived. Does nothing when a status is stored.
 */
export async function holdOnboardingOpen(workspace: Workspace): Promise<void> {
  if (workspace.onboarding !== "pending" || workspace.bot) return;
  const db = firestoreAdmin();
  const ref = db.collection("workspaces").doc(workspace.id);
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists || snapshot.get("onboarding") !== undefined) return;
    transaction.update(ref, { onboarding: { status: "pending", at: FieldValue.serverTimestamp() } });
  });
}

/** A stable, non-secret label for browser drafts tied to one workspace's bot. */
export function draftScope(workspace: Workspace): string {
  return createHash("sha256").update(`${workspace.id}\n${workspace.bot?.baseUrl ?? "local"}`).digest("hex").slice(0, 16);
}

/**
 * The bot says which workspace it serves (`writes.workspace`). Before anything
 * is created on it, that must be the workspace this user owns: a derived token
 * already makes a wrong URL fail, and this catches a bot started with the wrong
 * GENAIE_WORKSPACE_ID.
 */
export function botServesWorkspace(reported: unknown, workspace: Workspace): boolean {
  return reported === workspace.id;
}
