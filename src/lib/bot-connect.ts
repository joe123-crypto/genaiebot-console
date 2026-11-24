import "server-only";
import { firestoreAdmin } from "./firebase-admin";
import {
  botOrigin,
  botServesWorkspace,
  deriveBotToken,
  forgetCachedWorkspaces,
  type Workspace,
} from "./workspace";

/**
 * Pointing a workspace at a bot.
 *
 * The same handshake `scripts/workspace-admin.mjs connect-bot` performs, because
 * a bot created from the console has to pass it too. The registry is only
 * written after the bot itself has answered: it must accept the workspace's
 * derived token and report that workspace as its own. A bot that answers for
 * another workspace, or none, is refused, so `workspaces/{id}.bot` can never
 * come to name someone else's data.
 */

export class BotConnectError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "BotConnectError";
  }
}

/** Ask the bot which workspace it serves, with the token it should hold. */
export async function checkBot(origin: string, workspace: Workspace): Promise<void> {
  const token = deriveBotToken(workspace.id);
  let response: Response;
  try {
    response = await fetch(`${origin}/internal/console/capabilities`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new BotConnectError(`Your bot could not be reached at ${origin}.`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new BotConnectError("Your bot refused this workspace's token.");
  }
  if (!response.ok) throw new BotConnectError(`Your bot answered ${response.status} when asked what it serves.`);
  let body: unknown;
  try { body = await response.json(); } catch { throw new BotConnectError("Your bot's answer could not be read."); }
  const writes = (body as { writes?: { workspace?: unknown } } | null)?.writes;
  if (!botServesWorkspace(writes?.workspace, workspace)) {
    throw new BotConnectError("Your bot is serving a different workspace, so it was not connected.");
  }
}

/**
 * Save the bot's address, once it has said it is this workspace's. The cached
 * workspace is dropped straight after: every page decides whether to send the
 * user to `/setup` from that cache, and a run that has just finished must not
 * keep landing them back on it.
 */
export async function connectBot(workspace: Workspace, url: string): Promise<void> {
  const origin = botOrigin(url);
  if (!origin) throw new BotConnectError("That is not a bare https address for a bot.");
  await checkBot(origin, workspace);
  const ref = firestoreAdmin().collection("workspaces").doc(workspace.id);
  // A workspace has one bot. Repointing an existing one would move a user off
  // their own data, so a caller that thought there was none is refused rather
  // than obeyed -- the callers' own checks should make this unreachable.
  await firestoreAdmin().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw new BotConnectError("Your workspace could not be found.");
    if (snapshot.get("bot")) throw new BotConnectError("Your workspace already has a bot connected.");
    transaction.update(ref, { bot: { baseUrl: origin } });
  });
  // Per process, so another instance can still serve a stale /setup for up to
  // its 30 seconds. That is already true of every other workspace change.
  forgetCachedWorkspaces();
}
