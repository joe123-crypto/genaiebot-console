import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { CampaignImageUpload } from "@/src/domains/campaign-create";

export function imageUploadConfigured() {
  return ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]
    .every((key) => Boolean(process.env[key]?.trim()));
}
export async function signCampaignUpload(image: CampaignImageUpload) {
  const client = new S3Client({ forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! } });
  // Only the browser PUT is signed. The bot verifies bytes before indexing them.
  const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: process.env.R2_BUCKET,
    Key: image.key, ContentType: image.contentType, IfNoneMatch: "*" }), { expiresIn: 300, signableHeaders: new Set(["content-type", "if-none-match"]) });
  return { url, headers: { "Content-Type": image.contentType, "If-None-Match": "*" } };
}
