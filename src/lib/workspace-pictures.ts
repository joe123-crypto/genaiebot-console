import "server-only";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { r2Bucket, r2Client, r2Configured } from "./r2";
import { WORKSPACE_ID } from "./workspace";

/**
 * Deleting a workspace's pictures from R2, with its account.
 *
 * A workspace's pictures are everything under `w/<id>/`: the bot keeps them
 * there unless `GENAIE_ASSET_KEY_PREFIX` says otherwise, and the provisioner
 * never sets it. The shared `ads/` prefix belongs to the install that predates
 * workspaces, and nothing here can reach it. The id is checked against the
 * bot's own pattern before it becomes a prefix, and every key listed is checked
 * against that prefix again before it is deleted.
 *
 * One object at a time, a few at once, rather than `DeleteObjects`: that call
 * needs a checksum on its body, and this client is deliberately set to send
 * checksums only when a call demands them, which R2 has handled unevenly. A
 * workspace holds tens of pictures, not thousands.
 *
 * A console with no R2 settings could not have uploaded any, so it has nothing
 * to delete.
 */

const AT_ONCE = 8;

export function picturePrefix(workspaceId: string): string {
  if (!WORKSPACE_ID.test(workspaceId)) throw new Error("the workspace id is invalid");
  return `w/${workspaceId}/`;
}

export async function deleteWorkspacePictures(workspaceId: string): Promise<number> {
  const prefix = picturePrefix(workspaceId);
  if (!r2Configured()) return 0;
  const client = r2Client();
  const bucket = r2Bucket();
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    const keys = (page.Contents ?? []).map((object) => object.Key)
      .filter((key): key is string => typeof key === "string" && key.startsWith(prefix) && key.length > prefix.length);
    for (let start = 0; start < keys.length; start += AT_ONCE) {
      await Promise.all(keys.slice(start, start + AT_ONCE).map((key) =>
        client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))));
    }
    deleted += keys.length;
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return deleted;
}
