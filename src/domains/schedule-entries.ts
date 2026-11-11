import type { ScheduleEntriesRequest, ScheduleEntriesResult } from "@/src/lib/types";
import { slotKey } from "./schedule";

const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,63}$/;
const REVISION = /^[a-f0-9]{64}$/;
const TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function validScheduleEntriesRequest(input: ScheduleEntriesRequest): boolean {
  if (!input || typeof input !== "object" || typeof input.operationId !== "string" || !IDENTIFIER.test(input.operationId) ||
    typeof input.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !Number.isFinite(Date.parse(`${input.date}T00:00:00Z`)) || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0, 10) !== input.date ||
    typeof input.timezone !== "string" || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > 100) return false;
  return new Set(input.changes.map((change) => change && slotKey(change))).size === input.changes.length && input.changes.every((change) =>
    change && typeof change.slug === "string" && IDENTIFIER.test(change.slug) && change.slug !== "new" &&
    typeof change.entryId === "string" && IDENTIFIER.test(change.entryId) &&
    typeof change.expectedRevision === "string" && REVISION.test(change.expectedRevision) && typeof change.time === "string" && TIME.test(change.time) &&
    [change.create, change.paused, change.skipped, change.deleted].every((value) => typeof value === "boolean") &&
    !(change.create && (change.entryId === "primary" || change.deleted)));
}

export function isScheduleEntriesResult(value: unknown, input: ScheduleEntriesRequest): value is ScheduleEntriesResult {
  const result = value as ScheduleEntriesResult | null;
  if (!result || result.operationId !== input.operationId || !Array.isArray(result.entries) || result.entries.length !== input.changes.length) return false;
  const keys = new Set<string>();
  return result.entries.every((entry) => {
    if (!entry || keys.has(slotKey(entry))) return false;
    keys.add(slotKey(entry));
    const change = input.changes.find((row) => slotKey(row) === slotKey(entry));
    const validMinutes = (minutes: unknown) => Number.isInteger(minutes) && Number(minutes) >= 0 && Number(minutes) < 1440;
    return Boolean(change && entry.time === change.time && entry.minutes === Number(change.time.slice(0, 2)) * 60 + Number(change.time.slice(3)) &&
      entry.paused === change.paused && entry.skipped === change.skipped && entry.deleted === change.deleted &&
      typeof entry.campaignEnabled === "boolean" && entry.recurrence && typeof entry.recurrence.timezone === "string" &&
      Array.isArray(entry.recurrence.weekdays) && entry.recurrence.weekdays.length > 0 && entry.recurrence.weekdays.every((day) => Number.isInteger(day) && day >= 0 && day <= 6) &&
      entry.scheduleEdit && REVISION.test(entry.scheduleEdit.revision) && typeof entry.scheduleEdit.editable === "boolean" &&
      ["ready", "pending"].includes(entry.scheduleEdit.status) &&
      (entry.confirmed === null || (entry.confirmed && validMinutes(entry.confirmed.minutes) &&
        [entry.confirmed.paused, entry.confirmed.skipped, entry.confirmed.deleted].every((state) => typeof state === "boolean"))) &&
      (entry.scheduleEdit.status !== "ready" || (entry.confirmed && entry.confirmed.minutes === entry.minutes &&
        entry.confirmed.paused === entry.paused && entry.confirmed.skipped === entry.skipped && entry.confirmed.deleted === entry.deleted)));
  });
}
