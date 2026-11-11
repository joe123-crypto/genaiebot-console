import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ enabled: true, capabilities: vi.fn(), save: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/src/config", async (original) => ({ ...await original<object>(), get WRITES_ENABLED() { return mock.enabled; }, OPERATOR_NAME: "Operator" }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("@/src/lib/bot-client", async (original) => ({ ...await original<object>(), getCapabilities: mock.capabilities, saveScheduleEntries: mock.save }));
import { saveScheduleEntriesAction } from "@/app/schedule/actions";
import { BotUnavailableError, WriteRefusedError } from "@/src/lib/bot-client";

const input = { operationId: "repeat-request", date: "2026-11-11", timezone: "Africa/Harare", changes: [
  { slug: "alpha", entryId: "repeat-1", expectedRevision: "a".repeat(64), create: true, time: "12:15", paused: false, skipped: false, deleted: false },
] };
beforeEach(() => { vi.clearAllMocks(); mock.enabled = true; mock.capabilities.mockResolvedValue({ enabled: true, affectsProduction: true, fields: {}, delete: [], scheduleEditing: { edit: true, entries: true } }); });
describe("entry server action", () => {
  it("checks capabilities, forwards the operation ID and invalidates live views", async () => {
    mock.save.mockResolvedValue({ operationId: input.operationId, entries: [] });
    expect(await saveScheduleEntriesAction(input)).toMatchObject({ ok: true, operationId: input.operationId });
    expect(mock.save).toHaveBeenCalledWith(input, { by: "Operator" });
    expect(mock.revalidate.mock.calls.map(([route]) => route)).toEqual(expect.arrayContaining(["/", "/schedule", "/campaigns/alpha"]));
  });
  it("refuses read-only and older bots before submitting", async () => {
    mock.enabled = false;
    expect(await saveScheduleEntriesAction(input)).toMatchObject({ ok: false });
    mock.enabled = true;
    mock.capabilities.mockResolvedValue({ enabled: true, affectsProduction: true, fields: {}, delete: [], scheduleEditing: { edit: true } });
    expect(await saveScheduleEntriesAction(input)).toMatchObject({ ok: false });
    expect(mock.save).not.toHaveBeenCalled();
  });
  it("validates untrusted requests before contacting the bot", async () => {
    for (const invalid of [{ ...input, timezone: "UTC" }, { ...input, date: "2026-02-30" }, { ...input, changes: [] },
      { ...input, changes: [{ ...input.changes[0], entryId: "../bad" }] }]) expect(await saveScheduleEntriesAction(invalid)).toMatchObject({ ok: false });
    expect(mock.capabilities).not.toHaveBeenCalled();
  });
  it("distinguishes conflicts from unknown outcomes without automatic replay", async () => {
    mock.save.mockRejectedValueOnce(new WriteRefusedError("Conflict", [], 409));
    expect(await saveScheduleEntriesAction(input)).toMatchObject({ ok: false, uncertain: false, detail: "Conflict" });
    mock.save.mockRejectedValueOnce(new BotUnavailableError("Timeout"));
    expect(await saveScheduleEntriesAction(input)).toMatchObject({ ok: false, uncertain: true, detail: expect.stringContaining("may have been saved") });
    expect(mock.save).toHaveBeenCalledTimes(2);
  });
});
