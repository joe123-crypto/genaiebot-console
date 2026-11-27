import { TEST_ACTOR } from "./auth-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ writable: true }));
vi.mock("@/src/config", () => ({
  get ACCOUNT_WRITES_ENABLED() { return config.writable; },
}));
import { setCustomerBotRepliesAction } from "@/app/customer-bot/actions";
import { customerBotRequest } from "@/src/lib/customer-bot-client";

const saved = { mode: "ref", updatedAt: "2026-11-27T10:00:00+00:00", updatedBy: TEST_ACTOR };
const version = { instructions: "Reply directly.", sources: [{ id: "campaigns", label: "Live campaigns", description: "Offers." }],
  revision: "b".repeat(32), publishedAt: "2026-11-15T00:00:00Z", publishedBy: "Operator" };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  config.writable = true;
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("customer bot reply mode", () => {
  it("does not contact the bot with writes off or an unknown mode", async () => {
    config.writable = false;
    expect((await setCustomerBotRepliesAction("off")).kind).toBe("error");
    config.writable = true;
    expect((await setCustomerBotRepliesAction("nobody")).kind).toBe("error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves the mode as the operator", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(saved));
    expect(await setCustomerBotRepliesAction("ref")).toEqual({ kind: "saved", replies: saved });
    expect(fetchMock.mock.calls[0][0]).toBe("https://bot.example/internal/console/customer-bot/replies");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({ mode: "ref", actor: TEST_ACTOR });
  });

  it("explains an older bot without retrying", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
    expect(await setCustomerBotRepliesAction("off")).toMatchObject({ kind: "error", detail: expect.stringContaining("Update the bot") });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ ...version, replies: saved }, { kind: "saved", replies: saved }],
    [{ ...version, replies: { ...saved, mode: "everyone" } }, { kind: "error", replies: { ...saved, mode: "everyone" } }],
    [version, { kind: "error" }],
  ] as const)("reads the live setting once after an unconfirmed save (%#)", async (checked, outcome) => {
    fetchMock.mockRejectedValueOnce(new DOMException("Timed out", "TimeoutError"))
      .mockResolvedValueOnce(Response.json(checked));
    const result = await setCustomerBotRepliesAction("ref");
    expect(result).toMatchObject(outcome);
    if (!("replies" in outcome)) expect("replies" in result).toBe(false);
    expect(fetchMock.mock.calls.map((call) => call[1]?.method)).toEqual(["POST", "GET"]);
  });

  it("tells an old bot, an unreadable setting and a real one apart", async () => {
    fetchMock.mockResolvedValueOnce(Response.json(version))
      .mockResolvedValueOnce(Response.json({ ...version, replies: null }))
      .mockResolvedValueOnce(Response.json({ ...version, replies: { mode: "nobody" } }))
      .mockResolvedValueOnce(Response.json({ ...version, replies: saved }));
    const read = async () => {
      const result = await customerBotRequest();
      if (result.kind !== "live") throw new Error(`expected a live read, got ${result.kind}`);
      return result.live;
    };
    expect("replies" in await read()).toBe(false);
    expect((await read()).replies).toBeNull();
    expect((await read()).replies).toBeNull();
    expect((await read()).replies).toEqual(saved);
  });
});
