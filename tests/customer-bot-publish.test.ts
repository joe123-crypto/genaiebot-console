import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ writable: true }));
vi.mock("@/src/config", () => ({
  get ACCOUNT_WRITES_ENABLED() { return config.writable; },
  BOT_API_BASE_URL: "https://bot.example", BOT_API_TOKEN: "fixture-token", OPERATOR_NAME: "Operator",
}));
import { publishCustomerBotAction } from "@/app/customer-bot/actions";
import { customerBotRequest } from "@/src/lib/customer-bot-client";

const draft = { instructions: "Start with the answer.", knowledge: "Bricks: US$107" };
const revision = "a".repeat(32);
const live = { ...draft, revision: "b".repeat(32), publishedAt: "2026-11-15T00:00:00Z", publishedBy: "Operator" };
const prior = { ...live, revision, knowledge: "Bricks: US$95" };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  config.writable = true;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("customer bot actions", () => {
  it("does not contact the bot with writes off or a malformed draft", async () => {
    config.writable = false;
    expect((await publishCustomerBotAction(draft, revision)).kind).toBe("error");
    config.writable = true;
    expect((await publishCustomerBotAction({ ...draft, knowledge: "é".repeat(8193) }, revision)).kind).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [live, "published"],
    [prior, "unchanged"],
    [{ ...live, knowledge: "Someone else's text." }, "conflict"],
  ] as const)("checks live state once after a timeout and classifies it as %s %s", async (checked, outcome) => {
    fetchMock.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"))
      .mockResolvedValueOnce(Response.json(checked));
    expect((await publishCustomerBotAction(draft, revision)).kind).toBe(outcome);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "GET"]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://bot.example/internal/console/customer-bot");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ ...draft, expectedRevision: revision, actor: "Operator" });
  });

  it("reports an older bot as unavailable and surfaces a revision conflict without retrying", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await customerBotRequest()).toMatchObject({ kind: "error", detail: expect.stringContaining("does not support") });
    fetchMock.mockResolvedValueOnce(Response.json({ current: prior }, { status: 409 }));
    expect(await publishCustomerBotAction(draft, revision)).toEqual({ kind: "conflict", live: prior });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
