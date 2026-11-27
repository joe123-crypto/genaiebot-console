import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import "./auth-fixture";

/**
 * Deleting a workspace's pictures with its account. The bucket is shared by
 * every bot, so what matters is what is NOT deleted: nothing outside
 * `workspaces/<id>/` and the older `w/<id>/`, and above all not the shared
 * `ads/` the original install used.
 */

const bucket = vi.hoisted(() => ({
  configured: true,
  objects: [] as string[],
  pageSize: 2,
  sent: [] as { kind: string; input: Record<string, unknown> }[],
}));

vi.mock("@/src/lib/r2", () => ({
  r2Configured: () => bucket.configured,
  r2Bucket: () => "genaie-bucket",
  r2Client: () => ({
    async send(command: { input: Record<string, unknown> }) {
      if (command instanceof ListObjectsV2Command) {
        bucket.sent.push({ kind: "list", input: command.input });
        const prefix = String(command.input.Prefix ?? "");
        const matching = bucket.objects.filter((key) => key.startsWith(prefix)).sort();
        // Like S3's own, the token is a position in key order, not an offset,
        // so deleting what one page listed does not make the next skip any.
        const after = command.input.ContinuationToken ? String(command.input.ContinuationToken) : "";
        const rest = matching.filter((key) => key > after);
        const page = rest.slice(0, bucket.pageSize);
        const more = rest.length > page.length;
        return { Contents: page.map((Key) => ({ Key })), IsTruncated: more,
                 NextContinuationToken: more ? page.at(-1) : undefined };
      }
      if (command instanceof DeleteObjectCommand) {
        bucket.sent.push({ kind: "delete", input: command.input });
        bucket.objects = bucket.objects.filter((key) => key !== command.input.Key);
        return {};
      }
      throw new Error("unexpected command");
    },
  }),
}));

const pictures = () => import("@/src/lib/workspace-pictures");

beforeEach(() => {
  bucket.configured = true;
  bucket.pageSize = 2;
  bucket.sent = [];
  bucket.objects = [
    "ads/borehole/aaaa.jpg",
    "w/wOtherWorkspace1/ads/cv/bbbb.png",
    "w/wTestWorkspace1/ads/borehole/cccc.jpg",
    "w/wTestWorkspace1/ads/borehole/dddd.jpg",
    "w/wTestWorkspace1/ads/cv/eeee.png",
    "workspaces/wTestWorkspace1/campaigns/borehole/1111.jpg",
    "workspaces/wTestWorkspace1/campaigns/cv/2222.png",
    "workspaces/wOtherWorkspace1/campaigns/cv/3333.png",
    "workspaces/wTestWorkspace12/campaigns/cv/4444.png",
    // A sibling whose id begins with this one's: a prefix without its slash
    // would have taken it too.
    "w/wTestWorkspace12/ads/cv/ffff.png",
  ];
});

describe("deleting a workspace's pictures", () => {
  it("deletes everything under the workspace's own prefixes, across pages, and nothing else", async () => {
    const { deleteWorkspacePictures } = await pictures();
    expect(await deleteWorkspacePictures("wTestWorkspace1")).toBe(5);
    expect(bucket.objects).toEqual([
      "ads/borehole/aaaa.jpg",
      "w/wOtherWorkspace1/ads/cv/bbbb.png",
      "workspaces/wOtherWorkspace1/campaigns/cv/3333.png",
      "workspaces/wTestWorkspace12/campaigns/cv/4444.png",
      "w/wTestWorkspace12/ads/cv/ffff.png",
    ]);
    const listed = new Set(bucket.sent.filter((call) => call.kind === "list").map((call) => call.input.Prefix));
    expect(listed).toEqual(new Set(["workspaces/wTestWorkspace1/", "w/wTestWorkspace1/"]));
    expect(bucket.sent.every((call) => call.input.Bucket === "genaie-bucket")).toBe(true);
  });

  it("refuses an id that is not one, before it can become a prefix", async () => {
    const { deleteWorkspacePictures, picturePrefixes } = await pictures();
    for (const bad of ["", "..", "a/b", "short", "x".repeat(41)]) {
      await expect(deleteWorkspacePictures(bad)).rejects.toThrow("invalid");
    }
    expect(() => picturePrefixes("")).toThrow();
    expect(bucket.sent).toEqual([]);
    expect(bucket.objects).toContain("ads/borehole/aaaa.jpg");
  });

  it("has nothing to delete on a console that has no bucket to upload to", async () => {
    bucket.configured = false;
    const { deleteWorkspacePictures } = await pictures();
    expect(await deleteWorkspacePictures("wTestWorkspace1")).toBe(0);
    expect(bucket.sent).toEqual([]);
  });

  it("is a no-op the second time", async () => {
    const { deleteWorkspacePictures } = await pictures();
    await deleteWorkspacePictures("wTestWorkspace1");
    bucket.sent = [];
    expect(await deleteWorkspacePictures("wTestWorkspace1")).toBe(0);
    expect(bucket.sent.map((call) => call.kind)).toEqual(["list", "list"]);
  });
});
