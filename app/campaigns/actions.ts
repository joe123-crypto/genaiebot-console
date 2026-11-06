"use server";

import { revalidatePath } from "next/cache";
import { OPERATOR_NAME, WRITES_ENABLED } from "@/src/config";
import {
  BotUnavailableError,
  WritesDisabledError,
  getCampaignPreview,
  updateCampaignCaptions,
} from "@/src/lib/bot-client";

export type SaveCaptionsOutcome = { ok: true } | { ok: false; detail: string };

export async function saveCaptionsAction(
  slug: string,
  captions: string[],
  expectedCaptions: string[],
): Promise<SaveCaptionsOutcome> {
  if (!WRITES_ENABLED) return { ok: false, detail: "The console is in read-only mode." };
  if (typeof slug !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return { ok: false, detail: "No valid campaign was named." };
  }
  if (!Array.isArray(captions) || captions.length === 0 ||
      captions.some((caption) => typeof caption !== "string" || !caption.trim())) {
    return { ok: false, detail: "Keep at least one variant and enter text for every caption." };
  }
  // The bot's write bridge accepts at most 64 KiB, including request metadata.
  if (Buffer.byteLength(JSON.stringify(captions), "utf8") > 60 * 1024) {
    return { ok: false, detail: "The captions are too large to save. Shorten them and try again." };
  }

  try {
    const current = await getCampaignPreview(slug);
    if (JSON.stringify(current.captions) !== JSON.stringify(expectedCaptions)) {
      return { ok: false, detail: "Captions changed since you started editing. Reset to the latest captions before saving." };
    }
    await updateCampaignCaptions(slug, captions, { by: OPERATOR_NAME });
  } catch (error) {
    if (error instanceof BotUnavailableError || error instanceof WritesDisabledError) {
      return { ok: false, detail: error.detail };
    }
    throw error;
  }

  revalidatePath(`/campaigns/${slug}`);
  revalidatePath("/campaigns");
  revalidatePath("/");
  return { ok: true };
}
