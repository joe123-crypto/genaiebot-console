import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const local = vi.hoisted(() => ({ checkout: "" }));
vi.mock("@/src/config", () => ({ BOT_SOURCE: "local", BOT_API_BASE_URL: "", BOT_API_TOKEN: "", get GENAEBOT_CHECKOUT() { return local.checkout; }, WRITE_SOURCE: "local", WRITES_ENABLED: true, BOT_WRITE_API_BASE_URL: "", BOT_WRITE_TOKEN: "" }));
beforeEach(() => { local.checkout = mkdtempSync(path.join(tmpdir(), "schedule-save-")); mkdirSync(path.join(local.checkout, "workspace/bin"), { recursive: true }); vi.resetModules(); });
afterEach(() => rmSync(local.checkout, { recursive: true, force: true }));
it("uses the same stdin schedule protocol through a local bridge", async () => {
  writeFileSync(path.join(local.checkout, "workspace/bin/console-schedule"), 'import json,sys\nassert sys.argv[1:]==["--apply"]\nr=json.load(sys.stdin)\nassert r["changes"][0]["time"]=="07:10" and r["actor"]=="Operator"\nprint(json.dumps({"campaigns":[{"slug":"borehole-drilling","minutes":430,"scheduleEdit":{"revision":"b"*64,"editable":True,"status":"pending","confirmedMinutes":435}}]}))\n');
  const { saveSchedule } = await import("@/src/lib/bot-client");
  expect(await saveSchedule({ date: "2026-11-10", timezone: "Africa/Harare", changes: [{ slug: "borehole-drilling", time: "07:10", expectedRevision: "a".repeat(64) }] }, { by: "Operator" })).toMatchObject({ campaigns: [{ minutes: 430 }] });
});
