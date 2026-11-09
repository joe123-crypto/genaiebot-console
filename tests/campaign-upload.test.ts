import { afterEach, describe, expect, it, vi } from "vitest";
import { imageUploadConfigured, signCampaignUpload } from "@/src/lib/campaign-upload";
import { validCampaign } from "./fixtures/new-campaign";
afterEach(() => vi.unstubAllEnvs());
describe("R2 signing", () => {
  it("requires all storage settings", () => { for (const key of ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) vi.stubEnv(key, ""); expect(imageUploadConfigured()).toBe(false); });
  it("signs the exact immutable key and content type without an empty-body checksum", async () => {
    vi.stubEnv("R2_ACCOUNT_ID", "testaccount"); vi.stubEnv("R2_BUCKET", "testbucket"); vi.stubEnv("R2_ACCESS_KEY_ID", "testaccess"); vi.stubEnv("R2_SECRET_ACCESS_KEY", "testsecret");
    const signed = await signCampaignUpload(validCampaign().images[0]);
    const url = new URL(signed.url);
    expect(url.hostname).toBe("testaccount.r2.cloudflarestorage.com");
    expect(url.pathname).toBe(`/testbucket/${validCampaign().images[0].key}`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("300");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("if-none-match");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.has("x-amz-checksum-crc32")).toBe(false);
    expect(signed.headers).toEqual({ "Content-Type": "image/png", "If-None-Match": "*" });
    expect(signed.url).not.toContain("testsecret");
  });
});
