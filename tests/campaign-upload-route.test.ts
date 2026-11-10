import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/campaigns/uploads/route";
import { validCampaign } from "./fixtures/new-campaign";

const mock = vi.hoisted(() => ({ sign: vi.fn(), overview: vi.fn(), writable: true, configured: true }));
vi.mock("@/src/config", async (original) => ({ ...await original<typeof import("@/src/config")>(), get WRITES_ENABLED() { return mock.writable; } }));
vi.mock("@/src/lib/campaign-upload", () => ({ imageUploadConfigured: () => mock.configured, signCampaignUpload: mock.sign }));
vi.mock("@/src/lib/bot-client", async (original) => ({ ...await original<typeof import("@/src/lib/bot-client")>(), getOverview: mock.overview }));

beforeEach(() => {
  vi.clearAllMocks();
  mock.writable = true;
  mock.configured = true;
  mock.sign.mockResolvedValue({ url: "https://storage.example/upload", headers: {} });
  mock.overview.mockResolvedValue({ writes: { enabled: true, affectsProduction: true, fields: {}, delete: [], campaignCreation: { create: true, images: true, scheduling: true } } });
});

function request(headers: Record<string, string>, url = "http://localhost:3000/api/campaigns/uploads") {
  const { slug, images } = validCampaign();
  return new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ slug, image: images[0] }) });
}

describe("campaign upload origin boundary", () => {
  it.each(["localhost:3000", "127.0.0.1:3000"])("uses the browser-facing host %s when Next normalizes the URL", async (host) => {
    const response = await POST(request({ host, origin: `http://${host}`, "sec-fetch-site": "same-origin" }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mock.sign).toHaveBeenCalledWith(validCampaign().images[0]);
  });
  it("retains same-origin HTTPS behavior", async () => {
    expect((await POST(request({ host: "console.example", origin: "https://console.example" }, "https://internal.example/api/campaigns/uploads"))).status).toBe(200);
  });
  it("uses the request URL when Host is absent", async () => {
    expect((await POST(request({ origin: "http://localhost:3000" }))).status).toBe(200);
  });
  it.each<Record<string, string>>([
    { origin: "https://another-site.example", host: "127.0.0.1:3000" },
    { origin: "http://localhost:3001", host: "localhost:3000" },
    { origin: "https://localhost:3000", host: "localhost:3000" },
    { origin: "null", host: "localhost:3000" },
    { host: "localhost:3000" },
    { origin: "http://localhost:3000", host: "localhost:3000", "sec-fetch-site": "cross-site" },
    { origin: "https://another-site.example", host: "localhost:3000", "x-forwarded-host": "another-site.example", "x-forwarded-proto": "https" },
  ])("refuses foreign, missing or cross-site origins before reading bot state: %j", async (headers) => {
    expect((await POST(request(headers))).status).toBe(403);
    expect(mock.overview).not.toHaveBeenCalled();
    expect(mock.sign).not.toHaveBeenCalled();
  });
  it("still requires console writes and upload storage", async () => {
    mock.writable = false;
    expect((await POST(request({ origin: "http://localhost:3000" }))).status).toBe(403);
    mock.writable = true;
    mock.configured = false;
    expect((await POST(request({ origin: "http://localhost:3000" }))).status).toBe(503);
    expect(mock.sign).not.toHaveBeenCalled();
  });
});

describe("campaign ID retirement boundary", () => {
  it.each([false, true])("refuses upload URLs for an already used ID (deleted=%s)", async (deleted) => {
    const { slug } = validCampaign();
    const current = await mock.overview();
    mock.overview.mockClear();
    mock.overview.mockResolvedValue({ ...current, campaigns: deleted ? [] : [{ slug }], deletedCampaigns: deleted ? [slug] : [] });
    expect((await POST(request({ origin: "http://localhost:3000" }))).status).toBe(409);
    expect(mock.overview).toHaveBeenCalledWith(undefined, { fresh: true });
    expect(mock.sign).not.toHaveBeenCalled();
  });
});
