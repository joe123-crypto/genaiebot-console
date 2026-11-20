import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/src/lib/live-client", () => ({ getLiveView: mocks.read }));
import { GET } from "@/app/api/live/[view]/route";
import { BotUnavailableError } from "@/src/lib/bot-client";
import { apiOperator } from "@/src/lib/auth";
const request = () => new Request("https://console.example/api/live/groups");
const context = () => ({ params: Promise.resolve({ view: "groups" }) });
// A hook that returns a function registers it as teardown; mockReset returns the mock.
beforeEach(() => { mocks.read.mockReset(); });
it.each([[401, 502], [403, 502], [404, 503], [503, 503]])("maps upstream %s to %s without expiring the operator's session", async (upstream, expected) => {
  mocks.read.mockRejectedValue(new BotUnavailableError("The bot could not be reached.", upstream));
  const response = await GET(request(), context());
  expect(response.status).toBe(expected); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ error: "The bot could not be reached." });
});
it("keeps 401 exclusively for unauthenticated browser requests", async () => {
  vi.mocked(apiOperator).mockResolvedValueOnce(Response.json({ error: "Sign in" }, { status: 401 }));
  expect((await GET(request(), context())).status).toBe(401); expect(mocks.read).not.toHaveBeenCalled();
});
