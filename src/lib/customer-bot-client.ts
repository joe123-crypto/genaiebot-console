import { BotUnavailableError } from "./bot-errors";
import { botTarget, type BotTarget } from "./workspace";
import {
  customerBotReplies, isCustomerBotReplies, isCustomerBotVersion,
  type CustomerBotReplies, type CustomerBotReplyMode, type CustomerBotText, type CustomerBotVersion,
} from "./customer-bot-types";

type Result =
  | { kind: "live"; live: CustomerBotVersion }
  | { kind: "conflict"; live: CustomerBotVersion }
  | { kind: "error"; detail: string }
  | { kind: "unknown" };

export async function customerBotRequest(publish?: CustomerBotText & { expectedRevision: string; actor: string }): Promise<Result> {
  let target: BotTarget;
  try { target = await botTarget(); }
  catch (error) {
    if (error instanceof BotUnavailableError) return { kind: "error", detail: error.detail };
    throw error;
  }
  // Pin the read and publish to the workspace's own bot, as with account actions.
  try {
    const response = await fetch(`${target.baseUrl}/internal/console/customer-bot`, {
      method: publish ? "POST" : "GET",
      headers: { accept: "application/json", authorization: `Bearer ${target.token}`,
        ...(publish ? { "content-type": "application/json" } : {}) },
      ...(publish ? { body: JSON.stringify(publish) } : {}),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404 || response.status === 405) {
      return { kind: "error", detail: "This bot version does not support the Customer Bot editor yet." };
    }
    if (response.status === 401 || response.status === 403) {
      return { kind: "error", detail: "The bot API rejected the console credentials." };
    }
    if (response.ok || response.status === 409 || response.status === 400) {
      const body: unknown = await response.json();
      if (response.ok && isCustomerBotVersion(body)) return { kind: "live", live: withReplies(body) };
      if (response.ok) return publish ? { kind: "unknown" } : { kind: "error", detail: "Update the bot to support live lookups and the instructions-only Customer Bot editor." };
      if (response.status === 409 && body && typeof body === "object" && "current" in body && isCustomerBotVersion(body.current)) {
        return { kind: "conflict", live: withReplies(body.current) };
      }
      if (response.status === 400) {
        return { kind: "error", detail: "The bot rejected this draft. Check that reply instructions contain text and are within the size limit." };
      }
    }
  } catch { /* A dropped connection or unreadable response cannot confirm a publish. */ }
  return publish ? { kind: "unknown" } : { kind: "error", detail: "The bot's live content could not be loaded. Try again." };
}

/** Keeps a malformed reply setting from passing as a real one; see customerBotReplies. */
function withReplies(version: CustomerBotVersion): CustomerBotVersion {
  const { replies: _ignored, ...rest } = version;
  const replies = customerBotReplies(version);
  return replies === undefined ? rest : { ...rest, replies };
}

type RepliesResult =
  | { kind: "saved"; replies: CustomerBotReplies }
  | { kind: "error"; detail: string }
  | { kind: "unknown" };

/** Saves who the bot replies to. It takes effect on the next customer message. */
export async function customerBotRepliesRequest(body: { mode: CustomerBotReplyMode; actor: string }): Promise<RepliesResult> {
  let target: BotTarget;
  try { target = await botTarget(); }
  catch (error) {
    if (error instanceof BotUnavailableError) return { kind: "error", detail: error.detail };
    throw error;
  }
  try {
    const response = await fetch(`${target.baseUrl}/internal/console/customer-bot/replies`, {
      method: "POST",
      headers: { accept: "application/json", authorization: `Bearer ${target.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    if (response.status === 404 || response.status === 405) {
      return { kind: "error", detail: "This bot version can’t change who it replies to yet. Update the bot first." };
    }
    if (response.status === 401 || response.status === 403) {
      return { kind: "error", detail: "The bot API rejected the console credentials." };
    }
    if (response.status === 400) return { kind: "error", detail: "The bot rejected this reply setting." };
    if (response.ok) {
      const saved: unknown = await response.json();
      if (isCustomerBotReplies(saved) && saved.mode === body.mode) return { kind: "saved", replies: saved };
    }
  } catch { /* A dropped connection cannot confirm the change. */ }
  return { kind: "unknown" };
}
