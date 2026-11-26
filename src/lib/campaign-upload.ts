import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CampaignImageUpload } from "@/src/domains/campaign-create";
import { r2Bucket, r2Client, r2Configured } from "./r2";

export function imageUploadConfigured() {
  return r2Configured();
}
export async function signCampaignUpload(image: CampaignImageUpload) {
  const client = r2Client();
  // Only the browser PUT is signed. The bot verifies bytes before indexing them.
  const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: r2Bucket(),
    Key: image.key, ContentType: image.contentType, IfNoneMatch: "*" }), { expiresIn: 300, signableHeaders: new Set(["content-type", "if-none-match"]) });
  return { url, headers: { "Content-Type": image.contentType, "If-None-Match": "*" } };
}
