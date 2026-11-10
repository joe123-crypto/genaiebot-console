import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ScheduleRequest } from "@/src/lib/types";
const mock = vi.hoisted(() => ({ enabled: true, capabilities: vi.fn(), save: vi.fn(), campaigns: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/src/config", async (original) => ({ ...await original<object>(), get WRITES_ENABLED() { return mock.enabled; }, OPERATOR_NAME: "Operator" }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("@/src/lib/bot-client", async (original) => ({ ...await original<object>(), getCapabilities: mock.capabilities, saveSchedule: mock.save, getCampaigns: mock.campaigns }));
import { saveScheduleAction } from "@/app/schedule/actions";
import { BotUnavailableError, WriteRefusedError } from "@/src/lib/bot-client";
import { canEditSchedule } from "@/src/lib/write-capabilities";
const writes = { enabled: true, affectsProduction: true, fields: {}, delete: [], scheduleEditing: { edit: true } };
const input: ScheduleRequest = { date: "2026-11-10", timezone: "Africa/Harare", changes: [{ slug: "borehole-drilling", time: "07:10", expectedRevision: "a".repeat(64) }] };
const saved = { slug: "borehole-drilling", minutes: 430, scheduleEdit: { revision: "b".repeat(64), editable: true, status: "pending", confirmedMinutes: 435 } };
beforeEach(() => { vi.clearAllMocks(); mock.enabled = true; mock.capabilities.mockResolvedValue(writes); mock.save.mockResolvedValue({ campaigns: [saved] }); mock.campaigns.mockResolvedValue([]); });
describe("schedule saving", () => {
  it("checks capabilities and sends changed times with actor and revisions", async () => {
    expect(await saveScheduleAction(input)).toEqual({ ok: true, campaigns: [saved] });
    expect(mock.save).toHaveBeenCalledWith(input, { by: "Operator" });
    expect(mock.revalidate.mock.calls.map(([path]) => path)).toEqual(expect.arrayContaining(["/schedule", "/", "/campaigns", "/campaigns/borehole-drilling"]));
  });
  it("refuses read-only mode before contacting the bot", async () => {
    mock.enabled = false;
    expect(await saveScheduleAction(input)).toMatchObject({ ok: false });
    expect(mock.capabilities).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
  });
  it("keeps older bots and file mode read-only", async () => {
    for (const value of [undefined, { ...writes, scheduleEditing: undefined }, { ...writes, enabled: false }, { ...writes, affectsProduction: false }]) {
      mock.capabilities.mockResolvedValue(value);
      expect(await saveScheduleAction(input)).toMatchObject({ ok: false });
    }
    expect(mock.save).not.toHaveBeenCalled();
    expect(canEditSchedule(true, { ...writes, scheduleEditing: { edit: false, reason: "Unavailable" } })).toEqual({ allowed: false, reason: "Unavailable" });
  });
  it.each([
    { changes: [] }, { changes: [input.changes[0], input.changes[0]] }, { timezone: "UTC" }, { date: "no" },
    { changes: [{ ...input.changes[0], slug: "../bad" }] }, { changes: [{ ...input.changes[0], time: "24:00" }] },
    { changes: [{ ...input.changes[0], expectedRevision: "bad" }] },
  ])("validates untrusted input %j before reads", async (patch) => {
    expect(await saveScheduleAction({ ...input, ...patch })).toMatchObject({ ok: false });
    expect(mock.capabilities).not.toHaveBeenCalled(); expect(mock.save).not.toHaveBeenCalled();
  });
  it("preserves conflict errors and does not pretend the draft succeeded", async () => {
    mock.save.mockRejectedValue(new WriteRefusedError("Schedule changed", ["Reset first"], 409));
    expect(await saveScheduleAction(input)).toMatchObject({ ok: false, detail: "Schedule changed", problems: ["Reset first"] });
    expect(mock.campaigns).not.toHaveBeenCalled();
  });
  it("recovers a lost acknowledgement by reading live desired and applied times", async () => {
    mock.save.mockRejectedValue(new BotUnavailableError("Timeout; change may have been made"));
    mock.campaigns.mockResolvedValue([{ ...saved, scheduleMinutes: saved.minutes }]);
    expect(await saveScheduleAction(input)).toEqual({ ok: true, campaigns: [saved] });
    expect(mock.campaigns).toHaveBeenCalledWith(input.date, { fresh: true });
  });
  it("keeps an unknown outcome if live confirmation fails or times do not match", async () => {
    mock.save.mockRejectedValue(new BotUnavailableError("Timeout; change may have been made"));
    mock.campaigns.mockResolvedValue([{ ...saved, scheduleMinutes: 435 }]);
    expect(await saveScheduleAction(input)).toMatchObject({ ok: false, detail: expect.stringContaining("may have been made") });
    mock.campaigns.mockRejectedValue(new BotUnavailableError("read unavailable"));
    expect(await saveScheduleAction(input)).toMatchObject({ ok: false, detail: expect.stringContaining("may have been made") });
  });
  it("does not absorb malformed recovery metadata or an occurrence removed from that day", async () => {
    mock.save.mockRejectedValue(new BotUnavailableError("Timeout"));
    for (const row of [
      { ...saved, hour: 7, minute: 10, scheduleMinutes: null },
      { ...saved, scheduleMinutes: 430, scheduleEdit: { ...saved.scheduleEdit, revision: "" } },
    ]) {
      mock.campaigns.mockResolvedValue([row]);
      expect(await saveScheduleAction(input)).toMatchObject({ ok: false });
    }
  });
  it("checks live desired state after a server error that may follow a commit", async () => {
    mock.save.mockRejectedValue(new WriteRefusedError("Commit acknowledgement unavailable", [], 503));
    mock.campaigns.mockResolvedValue([{ ...saved, scheduleMinutes: saved.minutes }]);
    expect(await saveScheduleAction(input)).toEqual({ ok: true, campaigns: [saved] });
  });
});
