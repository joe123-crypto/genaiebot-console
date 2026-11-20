"use server";

import { requireOperator } from "@/src/lib/auth";

import { WRITES_ENABLED } from "@/src/config";
import { CaptionAIError, generateCaptionReply, parseCaptionAIRequest } from "@/src/lib/caption-ai";
import type { CaptionAIOutcome } from "@/src/lib/caption-ai-types";

// Bound simultaneous paid requests in each console process, including callers
// that bypass the UI's pending button. There are no automatic paid retries.
let activeRequests = 0;
export async function suggestCaptionAction(value: unknown): Promise<CaptionAIOutcome> {
  await requireOperator();
  if (!WRITES_ENABLED) return { ok: false, detail: "The console is in read-only mode." };
  if (activeRequests >= 4) return { ok: false, detail: "The caption assistant is busy. Try again in a moment." };
  activeRequests++;
  try {
    const input = parseCaptionAIRequest(value);
    return { ok: true, reply: await generateCaptionReply(input) };
  } catch (error) {
    return { ok: false, detail: error instanceof CaptionAIError ? error.message : "AI editing could not be completed. Your caption is unchanged; try again." };
  } finally { activeRequests--; }
}

/** Read-only account lookup, independent of paid caption generation. */
export async function captionLinkAccountsAction(): Promise<import("@/src/lib/types").LineAccount[]> {
  await requireOperator();
  try {
    const { getOverview } = await import("@/src/lib/bot-client");
    const accounts = (await getOverview()).accounts;
    return Array.isArray(accounts) ? accounts : [];
  } catch { return []; }
}
