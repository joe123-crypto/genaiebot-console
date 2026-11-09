import { NextResponse } from "next/server";
import { WRITES_ENABLED } from "@/src/config";
import { CAMPAIGN_SLUG, uploadError } from "@/src/domains/campaign-create";
import { getOverview, BotUnavailableError } from "@/src/lib/bot-client";
import { canCreateCampaign } from "@/src/lib/write-capabilities";
import { imageUploadConfigured, signCampaignUpload } from "@/src/lib/campaign-upload";

export async function POST(request: Request) {
  const refuse = (error: string, status = 400) => NextResponse.json({ error }, { status });
  if (!WRITES_ENABLED) return refuse("The console is in read-only mode.", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return refuse("Cross-origin uploads are not allowed.", 403);
  if (!imageUploadConfigured()) return refuse("Picture upload storage is not configured on the console.", 503);
  if (Number(request.headers.get("content-length")) > 4096) return refuse("Upload metadata is too large.");
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw) > 4096) return refuse("Upload metadata is too large.");
    const { slug, image } = JSON.parse(raw);
    if (typeof slug !== "string" || !CAMPAIGN_SLUG.test(slug)) return refuse("Enter a valid campaign name first.");
    const error = uploadError(image, slug);
    if (error) return refuse(error);
    const gate = canCreateCampaign(WRITES_ENABLED, (await getOverview()).writes);
    if (!gate.allowed) return refuse(gate.reason, 403);
    return NextResponse.json(await signCampaignUpload(image), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) return refuse("Upload metadata could not be read.");
    if (error instanceof BotUnavailableError) return refuse(error.detail, 503);
    return refuse("The upload URL could not be prepared. Try again.", 503);
  }
}
