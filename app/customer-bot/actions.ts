"use server";

import { ACCOUNT_WRITES_ENABLED } from "@/src/config";
import { customerBotRequest } from "@/src/lib/customer-bot-client";
import {
  CUSTOMER_BOT_FIELDS, customerBotProblem, customerBotText, isCustomerBotRevision, isCustomerBotText,
  sameCustomerBotText, type CustomerBotText, type CustomerBotVersion,
} from "@/src/lib/customer-bot-types";

type PublishResult =
  | { kind: "published" | "conflict" | "unchanged"; live: CustomerBotVersion }
  | { kind: "error"; detail: string }
  | { kind: "unknown" };

export async function checkCustomerBotAction() {
  return customerBotRequest();
}

export async function publishCustomerBotAction(draft: CustomerBotText, expectedRevision: string): Promise<PublishResult> {
  if (!ACCOUNT_WRITES_ENABLED) return { kind: "error", detail: "The console is in read-only mode." };
  if (!isCustomerBotText(draft) || !isCustomerBotRevision(expectedRevision)) {
    return { kind: "error", detail: "The draft or its live revision could not be read." };
  }
  for (const field of CUSTOMER_BOT_FIELDS) {
    const detail = customerBotProblem(draft[field], field);
    if (detail) return { kind: "error", detail };
  }
  const text = customerBotText(draft);
  const result = await customerBotRequest({ ...text, expectedRevision });
  if (result.kind === "error" || result.kind === "conflict") return result;
  if (result.kind === "live" && sameCustomerBotText(text, result.live)) return { kind: "published", live: result.live };

  // Only read after an ambiguous write. Never replay the publish automatically.
  const checked = await customerBotRequest();
  if (checked.kind !== "live") return { kind: "unknown" };
  return { live: checked.live, kind: sameCustomerBotText(text, checked.live) ? "published" :
    checked.live.revision === expectedRevision ? "unchanged" : "conflict" };
}
