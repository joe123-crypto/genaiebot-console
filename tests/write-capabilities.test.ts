import { describe, expect, it } from "vitest";
import {
  BOT_TOO_OLD_REASON,
  NO_WRITE_KEY_REASON,
  NOT_LIVE_WARNING,
  READ_ONLY_REASON,
  canDelete,
  canWrite,
} from "@/src/lib/write-capabilities";
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
