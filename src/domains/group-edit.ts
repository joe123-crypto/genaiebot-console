import type { DiscoveredGroup, Group, GroupStatus } from "@/src/lib/types";

/**
 * Editing one group's own settings: what the Edit dialog offers, how a form maps
 * to a change, and the checks worth making before the bot is asked.
 *
 * The bot's writer is the authority -- it runs the same validator that decides
 * whether a campaign may post to the group, and its refusal carries the reasons.
 * These checks exist so an obviously malformed form never becomes a request, and
 * so the dialog can say what is wrong next to the field rather than after a round
 * trip. Pure and free of server imports: the dialog and the server action share it.
 *
 * Campaign assignments (`promos`, `paused_promos`, `weekly`) are not edited here.
 * They belong to the campaign page, where removing one has to take all three
 * fields out together.
 */
export const GROUP_EDIT_FIELDS = [
  "name", "status", "activity", "account", "daily_cap", "note",
] as const;
export type GroupEditField = (typeof GROUP_EDIT_FIELDS)[number];
export type GroupEditValue = string | number | null;
export type GroupEdit = Partial<Record<GroupEditField, GroupEditValue>>;

export const GROUP_STATUSES: GroupStatus[] = ["active", "on-hold", "admin-only", "not-a-member"];

/** What each field means to an operator, for labels and reasons. */
export const GROUP_FIELD_LABEL: Record<GroupEditField, string> = {
  name: "Name",
  status: "Status",
  activity: "Tier",
  account: "Line",
  daily_cap: "Daily cap",
  note: "Note",
};

/** The group's current value for each editable field, in the bot's own terms.
 *  The read model renames `daily_cap` to `dailyCapOverride`; nothing else moves. */
export function currentGroupValues(group: Group): Record<GroupEditField, GroupEditValue> {
  return {
    name: group.name,
    status: group.status,
    activity: group.activity,
    account: group.account,
    daily_cap: group.dailyCapOverride,
    note: group.note,
  };
}

/** Blank text means "none", which the bot stores as null. */
function normalise(field: GroupEditField, value: GroupEditValue): GroupEditValue {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (field === "daily_cap") return trimmed === "" ? null : Number(trimmed);
    return trimmed === "" ? null : trimmed;
  }
  return value;
}

/** Only the fields whose value actually changes, so an untouched field is never
 *  written -- and never trips a stale-edit check it had no part in. */
export function changedGroupFields(group: Group, form: GroupEdit): GroupEdit {
  const current = currentGroupValues(group);
  const out: GroupEdit = {};
  for (const field of GROUP_EDIT_FIELDS) {
    if (!(field in form)) continue;
    const next = normalise(field, form[field] ?? null);
    if (next !== current[field]) out[field] = next;
  }
  return out;
}

/** Problems with a change, in operator words; empty means worth sending. */
export function groupEditProblems(
  edit: GroupEdit,
  { lines, tiers }: { lines: string[]; tiers: string[] },
): string[] {
  const problems: string[] = [];
  for (const field of Object.keys(edit)) {
    if (!(GROUP_EDIT_FIELDS as readonly string[]).includes(field)) {
      problems.push(`${field} is not something this dialog edits.`);
    }
  }
  if ("status" in edit && !GROUP_STATUSES.includes(edit.status as GroupStatus)) {
    problems.push(`Status must be one of ${GROUP_STATUSES.join(", ")}.`);
  }
  if ("activity" in edit && !tiers.includes(String(edit.activity))) {
    problems.push(`Tier must be one of ${tiers.join(", ")}.`);
  }
  if ("account" in edit && !lines.includes(String(edit.account))) {
    problems.push(`Line must be one of ${lines.join(", ")}.`);
  }
  if ("daily_cap" in edit && edit.daily_cap !== null &&
      !(Number.isInteger(edit.daily_cap) && (edit.daily_cap as number) >= 0)) {
    problems.push("Daily cap must be a whole number of ads, 0 or more -- or blank to use the tier's band.");
  }
  for (const field of ["name", "note"] as const) {
    if (field in edit && edit[field] !== null && typeof edit[field] !== "string") {
      problems.push(`${GROUP_FIELD_LABEL[field]} must be text.`);
    }
  }
  if (typeof edit.note === "string" && edit.note.length > 500) {
    problems.push("Note must be 500 characters or fewer.");
  }
  return problems;
}

/**
 * The record a discovered group starts with when it is added: active, on the line
 * that saw it, and in NO campaign. Nothing is advertised to it until a campaign
 * page assigns it, so adding a group can never start sending on its own.
 *
 * The default line is preferred whenever it saw the group; otherwise the first line
 * that did. The bot refuses a line it does not know, with the reason.
 */
export function newGroupFromDiscovered(found: DiscoveredGroup): Record<string, unknown> {
  const seenBy = found.accounts.map((account) => account.accountId);
  const record: Record<string, unknown> = {
    name: found.name?.trim() || null,
    source: "whatsapp",
    status: "active",
    promos: [],
    daily_cap: null,
  };
  if (seenBy.length > 0 && !seenBy.includes("default")) record.account = seenBy[0];
  return record;
}
