import { describe, expect, it } from "vitest";
import {
  BOT_TOO_OLD_REASON,
  NO_WRITE_KEY_REASON,
  NOT_LIVE_WARNING,
  READ_ONLY_REASON,
  canDelete,
  canEditSchedule,
  canEditScheduleEntries,
  canWrite,
} from "@/src/lib/write-capabilities";
import type { WriteGate } from "@/src/lib/write-capabilities";
import type { WriteCapabilities } from "@/src/lib/types";

/**
 * Two parties have to agree before a control is armed: this console's own
 * switch, and the bot's report of what it will accept. These pin the order the
 * reasons come in -- each names the FIRST thing actually in the way -- and that
 * an older bot reads as "cannot write", never as "can write anything".
 */
const LIVE: WriteCapabilities = {
  enabled: true,
  affectsProduction: true,
  fields: { groups: ["status", "promos", "paused_promos", "weekly"], campaigns: ["enabled"] },
  delete: ["groups"],
};

describe("canWrite", () => {
  it("allows a field the bot accepts", () => {
    expect(canWrite(true, LIVE, "groups", "status")).toEqual({ allowed: true });
  });

  it("puts the console's own switch first", () => {
    expect(canWrite(false, LIVE, "groups", "status"))
      .toEqual({ allowed: false, reason: READ_ONLY_REASON });
  });

  it("reads a bot with no writes block as unable to write", () => {
    expect(canWrite(true, undefined, "groups", "status"))
      .toEqual({ allowed: false, reason: BOT_TOO_OLD_REASON });
  });

  it("says when the bot holds no write key", () => {
    expect(canWrite(true, { ...LIVE, enabled: false }, "groups", "status"))
      .toEqual({ allowed: false, reason: NO_WRITE_KEY_REASON });
  });

  it("names a field the bot does not accept", () => {
    const gate = canWrite(true, LIVE, "campaigns", "captions");
    expect(gate.allowed).toBe(false);
    expect(gate.allowed || gate.reason).toMatch(/captions/);
  });

  it("refuses a change touching several fields if any one is not accepted", () => {
    // Removing an assignment writes promos, paused_promos and weekly together.
    expect(canWrite(true, LIVE, "groups", "promos", "paused_promos", "weekly").allowed).toBe(true);
    const gate = canWrite(true, { ...LIVE, fields: { groups: ["promos", "weekly"] } },
                          "groups", "promos", "paused_promos", "weekly");
    expect(gate.allowed || gate.reason).toMatch(/paused_promos/);
  });

  it("allows but warns when a save would not reach the campaigns", () => {
    expect(canWrite(true, { ...LIVE, affectsProduction: false }, "groups", "status"))
      .toEqual({ allowed: true, warning: NOT_LIVE_WARNING });
  });

  it("knows nothing about a collection the bot did not list", () => {
    expect(canWrite(true, LIVE, "lines", "number").allowed).toBe(false);
  });
});

describe("canDelete", () => {
  it("allows deleting where the bot does", () => {
    expect(canDelete(true, LIVE, "groups")).toEqual({ allowed: true });
  });

  it("refuses where it does not", () => {
    expect(canDelete(true, LIVE, "campaigns").allowed).toBe(false);
  });

  it("applies the same switches as an edit", () => {
    expect(canDelete(false, LIVE, "groups").allowed).toBe(false);
    expect(canDelete(true, undefined, "groups").allowed).toBe(false);
    expect(canDelete(true, { ...LIVE, enabled: false }, "groups").allowed).toBe(false);
  });
});

/**
 * Group actions are gated apart from writes on purpose.
 *
 * `writes.enabled` means precisely "the bot holds the Firestore write key".
 * Leaving a WhatsApp group and clearing a group's stored records write no
 * document, so asking that question about them would hide a working control
 * behind a credential it never uses.
 */
describe("canAct", () => {
  it("allows an action the bot offers", async () => {
    const { canAct } = await import("@/src/lib/write-capabilities");
    expect(canAct(true, { leaveGroup: true, clearRecords: true }, "leaveGroup"))
      .toEqual({ allowed: true });
  });

  it("refuses while the console is read-only", async () => {
    const { canAct, READ_ONLY_REASON } = await import("@/src/lib/write-capabilities");
    expect(canAct(false, { leaveGroup: true, clearRecords: true }, "leaveGroup"))
      .toEqual({ allowed: false, reason: READ_ONLY_REASON });
  });

  it("reads an older bot's silence as cannot, never as everything", async () => {
    const { canAct, NO_ACTIONS_REASON } = await import("@/src/lib/write-capabilities");
    expect(canAct(true, undefined, "leaveGroup"))
      .toEqual({ allowed: false, reason: NO_ACTIONS_REASON });
  });

  it("says when the bot has the surface switched off", async () => {
    const { canAct, ACTIONS_OFF_REASON } = await import("@/src/lib/write-capabilities");
    expect(canAct(true, { leaveGroup: false, clearRecords: true }, "leaveGroup"))
      .toEqual({ allowed: false, reason: ACTIONS_OFF_REASON });
  });

  it("judges each action on its own", async () => {
    const { canAct } = await import("@/src/lib/write-capabilities");
    const actions = { leaveGroup: false, clearRecords: true };
    expect(canAct(true, actions, "clearRecords").allowed).toBe(true);
    expect(canAct(true, actions, "leaveGroup").allowed).toBe(false);
  });

  it("does not depend on the write key", async () => {
    const { canAct, canDelete } = await import("@/src/lib/write-capabilities");
    const writes = { enabled: false, affectsProduction: true, fields: {}, delete: [] };
    // The bot cannot write config, and can still act on the WhatsApp group.
    expect(canDelete(true, writes, "groups").allowed).toBe(false);
    expect(canAct(true, { leaveGroup: true, clearRecords: true }, "leaveGroup").allowed)
      .toBe(true);
  });
});

/**
 * The two schedule gates are nested: entries is a strict superset of edit. One timeline now
 * renders for both bot generations, so the gap between them is what decides whether the entry
 * actions appear — and a bot that can move times but not act on entries must keep its save.
 */
describe("the schedule gates", () => {
  const live = (scheduleEditing: WriteCapabilities["scheduleEditing"]): WriteCapabilities => ({ ...LIVE, scheduleEditing });
  const why = (gate: WriteGate) => (gate.allowed ? undefined : gate.reason);

  it("refuses both when the console is read-only", () => {
    expect(canEditSchedule(false, live({ edit: true, entries: true }))).toEqual({ allowed: false, reason: READ_ONLY_REASON });
    expect(canEditScheduleEntries(false, live({ edit: true, entries: true }))).toEqual({ allowed: false, reason: READ_ONLY_REASON });
  });

  it("refuses both when the bot predates console writes", () => {
    expect(canEditSchedule(true, undefined)).toEqual({ allowed: false, reason: BOT_TOO_OLD_REASON });
    expect(canEditScheduleEntries(true, undefined)).toEqual({ allowed: false, reason: BOT_TOO_OLD_REASON });
  });

  it("refuses both without a write key", () => {
    const writes: WriteCapabilities = { ...LIVE, enabled: false, scheduleEditing: { edit: true, entries: true } };
    expect(canEditSchedule(true, writes)).toEqual({ allowed: false, reason: NO_WRITE_KEY_REASON });
    expect(canEditScheduleEntries(true, writes)).toEqual({ allowed: false, reason: NO_WRITE_KEY_REASON });
  });

  it("requires live configuration, not a file-backed checkout", () => {
    const writes: WriteCapabilities = { ...LIVE, affectsProduction: false, scheduleEditing: { edit: true, entries: true } };
    expect(why(canEditSchedule(true, writes))).toBe("Schedule editing requires live Firestore configuration.");
    expect(why(canEditScheduleEntries(true, writes))).toBe("Schedule editing requires live Firestore configuration.");
  });

  it("prefers the bot's own reason for refusing schedule editing", () => {
    expect(why(canEditSchedule(true, live({ edit: false, reason: "Cron source is read-only." }))))
      .toBe("Cron source is read-only.");
    expect(why(canEditSchedule(true, live({ edit: false }))))
      .toBe("Deploy the companion bot update for schedule editing to save times here.");
  });

  /** The case the single timeline exists to serve, and the one production is in today. */
  it("allows moving times while refusing entry actions when the bot has no entry support", () => {
    expect(canEditSchedule(true, live({ edit: true })).allowed).toBe(true);
    expect(canEditScheduleEntries(true, live({ edit: true })))
      .toEqual({ allowed: false, reason: "Deploy the companion bot update for repeat, pause, skip and delete controls." });
  });

  it("allows both once the bot advertises entry support", () => {
    expect(canEditSchedule(true, live({ edit: true, entries: true })).allowed).toBe(true);
    expect(canEditScheduleEntries(true, live({ edit: true, entries: true })).allowed).toBe(true);
  });
});
