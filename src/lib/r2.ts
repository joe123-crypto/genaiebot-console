import { S3Client } from "@aws-sdk/client-s3";

/**
 * The console's one R2 client, for the bucket every bot keeps its pictures in.
 *
 * Two things use it: signing a browser's upload (`./campaign-upload`) and
 * deleting a workspace's pictures with its account (`./workspace-pictures`). So
 * the key it holds needs put, list and delete on the bucket.
 */

export const R2_VARS = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"] as const;

export function r2Configured(): boolean {
  return R2_VARS.every((key) => Boolean(process.env[key]?.trim()));
}

export function r2Bucket(): string {
  return process.env.R2_BUCKET!;
}

export function r2Client(): S3Client {
  return new S3Client({
    forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID!, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY! },
  });
}
