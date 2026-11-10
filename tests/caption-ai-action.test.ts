import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ writable: true, generate: vi.fn() }));
vi.mock("@/src/config", () => ({ get WRITES_ENABLED() { return mock.writable; } }));
vi.mock("@/src/lib/caption-ai", async original => ({ ...await original<typeof import("@/src/lib/caption-ai")>(), generateCaptionReply: mock.generate }));
import { suggestCaptionAction } from "@/app/campaigns/caption-ai-actions";
const input = { caption: "Test {ref}", prompt: "Shorten", history: [] };
beforeEach(() => { vi.clearAllMocks(); mock.writable = true; mock.generate.mockResolvedValue({ message: "Done", suggestion: input.caption }); });
afterEach(() => vi.unstubAllEnvs());
describe("caption assistant server action", () => {
  it("gates direct calls in read-only mode", async () => {
    mock.writable = false;
    expect(await suggestCaptionAction(input)).toEqual({ ok: false, detail: "The console is in read-only mode." });
    expect(mock.generate).not.toHaveBeenCalled();
  });
  it("validates direct calls before contacting a provider", async () => {
    expect((await suggestCaptionAction({ ...input, prompt: "" })).ok).toBe(false);
    expect(mock.generate).not.toHaveBeenCalled();
  });
  it("returns the generated reply without any save operation", async () => {
    expect(await suggestCaptionAction(input)).toEqual({ ok: true, reply: { message: "Done", suggestion: input.caption } });
    expect(mock.generate).toHaveBeenCalledWith(input);
  });
  it("limits simultaneous paid calls and releases the limit after completion", async () => {
    const pending: ((value: { message: string }) => void)[] = [];
    mock.generate.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
    const calls = Array.from({ length: 4 }, () => suggestCaptionAction(input));
    expect(await suggestCaptionAction(input)).toMatchObject({ ok: false, detail: expect.stringContaining("busy") });
    pending.forEach(resolve => resolve({ message: "Done" }));
    await Promise.all(calls);
    mock.generate.mockResolvedValue({ message: "Ready" });
    expect((await suggestCaptionAction(input)).ok).toBe(true);
  });
  it("does not expose unexpected internal errors", async () => {
    mock.generate.mockRejectedValue(new Error("private credential data"));
    expect(await suggestCaptionAction(input)).toEqual({ ok: false, detail: "AI editing could not be completed. Your caption is unchanged; try again." });
  });
});
