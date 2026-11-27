"use server";

import { requireOperator, auditActor } from "@/src/lib/auth";

import { ACCOUNT_WRITES_ENABLED } from "@/src/config";
import { customerBotRepliesRequest, customerBotRequest } from "@/src/lib/customer-bot-client";
import {
  CUSTOMER_BOT_FIELDS, customerBotProblem, customerBotText, isCustomerBotReplyMode, isCustomerBotRevision, isCustomerBotText,
  sameCustomerBotText, type CustomerBotReplies, type CustomerBotText, type CustomerBotVersion,
} from "@/src/lib/customer-bot-types";

type PublishResult =
  | { kind: "published" | "conflict" | "unchanged"; live: CustomerBotVersion }
  | { kind: "error"; detail: string }
  | { kind: "unknown" };

export async function checkCustomerBotAction() {
  await requireOperator();
  return customerBotRequest();
}

export async function publishCustomerBotAction(draft: CustomerBotText, expectedRevision: string): Promise<PublishResult> {
  const operator = await requireOperator();
  if (!ACCOUNT_WRITES_ENABLED) return { kind: "error", detail: "The console is in read-only mode." };
  if (!isCustomerBotText(draft) || !isCustomerBotRevision(expectedRevision)) {
    return { kind: "error", detail: "The draft or its live revision could not be read." };
  }
  for (const field of CUSTOMER_BOT_FIELDS) {
    const detail = customerBotProblem(draft[field], field);
    if (detail) return { kind: "error", detail };
  }
  const text = customerBotText(draft);
  const result = await customerBotRequest({ ...text, expectedRevision, actor: auditActor(operator) });
  if (result.kind === "error" || result.kind === "conflict") return result;
  if (result.kind === "live" && sameCustomerBotText(text, result.live)) return { kind: "published", live: result.live };

  // Only read after an ambiguous write. Never replay the publish automatically.
  const checked = await customerBotRequest();
  if (checked.kind !== "live") return { kind: "unknown" };
  return { live: checked.live, kind: sameCustomerBotText(text, checked.live) ? "published" :
    checked.live.revision === expectedRevision ? "unchanged" : "conflict" };
}

type RepliesResult =
  | { kind: "saved"; replies: CustomerBotReplies }
  | { kind: "error"; detail: string; replies?: CustomerBotReplies };

export async function setCustomerBotRepliesAction(mode: unknown): Promise<RepliesResult> {
  const operator = await requireOperator();
  if (!ACCOUNT_WRITES_ENABLED) return { kind: "error", detail: "The console is in read-only mode." };
  if (!isCustomerBotReplyMode(mode)) return { kind: "error", detail: "Choose who the bot replies to." };
  const result = await customerBotRepliesRequest({ mode, actor: auditActor(operator) });
  if (result.kind !== "unknown") return result;

  // Only read after an ambiguous write. Never replay it automatically.
  const checked = await customerBotRequest();
  const replies = checked.kind === "live" ? checked.live.replies : undefined;
  if (replies?.mode === mode) return { kind: "saved", replies };
  if (replies) return { kind: "error", detail: "The change wasn’t saved. Try again.", replies };
  return { kind: "error", detail: "We couldn’t confirm the change. Reload the page to see the current setting before trying again." };
}
