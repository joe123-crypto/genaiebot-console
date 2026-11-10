import { describe, expect, it } from "vitest";
import { validScheduleEntriesRequest, isScheduleEntriesResult } from "@/src/domains/schedule-entries";
import { clashes, nextUp, runningNow } from "@/src/domains/schedule";
import type { DaySlot } from "@/src/domains/schedule";

export const request = { operationId: "operation-1", date: "2026-11-11", timezone: "Africa/Harare", changes: [
  { slug: "alpha", entryId: "repeat-1", expectedRevision: "a".repeat(64), create: true, time: "12:15", paused: false, skipped: false, deleted: false },
] };

describe("schedule entry contracts", () => {
  it("accepts independent entries and rejects duplicates and impossible dates", () => {
    expect(validScheduleEntriesRequest(request)).toBe(true);
    expect(validScheduleEntriesRequest({ ...request, changes: [...request.changes, request.changes[0]] })).toBe(false);
    expect(validScheduleEntriesRequest({ ...request, date: "2026-02-30" })).toBe(false);
    expect(validScheduleEntriesRequest({ ...request, changes: [{ ...request.changes[0], entryId: "primary" }] })).toBe(false);
    expect(validScheduleEntriesRequest({ ...request, changes: [...request.changes, { ...request.changes[0], entryId: "repeat-2" }] })).toBe(true);
  });

  it("requires the matching receipt and independently verified entry states", () => {
    const entry = { slug: "alpha", entryId: "repeat-1", minutes: 735, time: "12:15", paused: false, skipped: false, deleted: false,
      campaignEnabled: true, recurrence: { timezone: "Africa/Harare", weekdays: [0, 1, 2, 3, 4, 5, 6] }, confirmed: null,
      scheduleEdit: { editable: true, revision: "b".repeat(64), status: "pending", confirmedMinutes: null } };
    const result = { operationId: request.operationId, entries: [entry] };
    expect(isScheduleEntriesResult(result, request)).toBe(true);
    expect(isScheduleEntriesResult({ ...result, operationId: "other" }, request)).toBe(false);
    expect(isScheduleEntriesResult({ ...result, entries: [{ ...entry, paused: true }] }, request)).toBe(false);
    expect(isScheduleEntriesResult({ ...result, entries: [{ ...entry, scheduleEdit: { ...entry.scheduleEdit, status: "ready" } }] }, request)).toBe(false);
  });

  it("excludes paused, skipped, deleted and campaign-disabled entries from active calculations", () => {
    const base: DaySlot = { slug: "alpha", name: "Alpha", minutes: 600, time: "10:00", targetCount: 20, accounts: { default: 20 } };
    const inactive = [{ ...base, paused: true }, { ...base, skipped: true }, { ...base, deleted: true }, { ...base, campaignEnabled: false }];
    expect(clashes(inactive)).toEqual([]);
    expect(runningNow(inactive, 610)).toEqual([]);
    expect(nextUp(inactive, 500)).toBeUndefined();
    expect(nextUp([{ ...base, minutes: 900 }, base], 500)?.minutes).toBe(600);
  });
});
