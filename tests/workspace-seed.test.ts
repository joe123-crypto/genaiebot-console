import { beforeEach, describe, expect, it, vi } from "vitest";
import { settingsSeed, settingsSeedProblems } from "@/src/domains/workspace-seed";
import { firestoreFake } from "./fixtures/firestore";
import { TEST_WORKSPACE } from "./auth-fixture";

/**
 * The one document the console writes into a workspace's own tree.
 *
 * Two things matter beyond "it copies": `contact_account` must go, because it
 * names a line the new workspace has not got and the bot's validator would
 * refuse the document; and nothing the bot's reader cannot decode may be copied,
 * because an undecodable settings document takes EVERY group out of sending
 * rather than just itself.
 */

const fake = firestoreFake();
vi.mock("@/src/lib/firebase-admin", () => ({ firestoreAdmin: () => fake.db }));

const WORKSPACE = { ...TEST_WORKSPACE, bot: null };
const TARGET = `workspaces/${WORKSPACE.id}/settings/defaults`;

const TEMPLATE = {
  version: 1,
  _comment: "the running install's settings",
  activity: { quiet: false },
  caps_enabled: true,
  rotation_enabled: true,
  contact_account: "ads",
  bands: [{ min: 1, max: 10, cap: 3 }],
};

const seed = () => import("@/src/lib/workspace-seed");

beforeEach(() => { fake.reset(); });

describe("the copy", () => {
  it("drops contact_account, which names a line this workspace has not got", () => {
    const copied = settingsSeed(TEMPLATE);
    expect(copied).not.toHaveProperty("contact_account");
    expect(copied).toMatchObject({ version: 1, caps_enabled: true, bands: TEMPLATE.bands });
  });

  it("keeps everything else, including the bands a new workspace starts on", () => {
    expect(Object.keys(settingsSeed(TEMPLATE)).sort())
      .toEqual(["_comment", "activity", "bands", "caps_enabled", "rotation_enabled", "version"]);
  });
});

describe("what may be copied", () => {
  it("accepts a template the bot would read", () => {
    expect(settingsSeedProblems(TEMPLATE)).toEqual([]);
  });

  it("refuses a version the bot's validator does not accept", () => {
    expect(settingsSeedProblems({ ...TEMPLATE, version: 2 })[0]).toMatch(/version/);
  });

  it("refuses values the bot's reader would raise on, naming the field", () => {
    class Timestamp { constructor(readonly seconds = 0) {} }
    for (const value of [new Timestamp(), Buffer.from("x"), Number.NaN, 2 ** 60]) {
      const problems = settingsSeedProblems({ ...TEMPLATE, activity: { quiet: value } });
      expect(problems.length).toBeGreaterThan(0);
      expect(problems[0]).toContain("settings.activity.quiet");
    }
  });

  it("refuses a template that is not a document at all", () => {
    for (const value of [null, undefined, [], "settings"]) {
      expect(settingsSeedProblems(value).length).toBeGreaterThan(0);
    }
  });
});

describe("seeding a workspace", () => {
  it("writes the one document, and nothing else", async () => {
    fake.put("settings/defaults", TEMPLATE);
    expect(await (await seed()).seedWorkspaceSettings(WORKSPACE)).toBe("written");
    expect(fake.read(TARGET)).not.toHaveProperty("contact_account");
    expect(fake.paths().filter((path) => path.startsWith(`workspaces/${WORKSPACE.id}/`))).toEqual([TARGET]);
  });

  it("never overwrites settings that are already there", async () => {
    fake.put("settings/defaults", TEMPLATE);
    fake.put(TARGET, { version: 1, caps_enabled: false, bands: [] });
    expect(await (await seed()).seedWorkspaceSettings(WORKSPACE)).toBe("already");
    expect(fake.read(TARGET)).toMatchObject({ caps_enabled: false });
  });

  // What a user reads is `detail`; the Error's own message is the generic one
  // every BotUnavailableError carries, which is what the route never shows.
  const detailOf = async (run: Promise<unknown>) => {
    try { await run; } catch (error) { return (error as { detail?: string }).detail ?? ""; }
    throw new Error("expected it to be refused");
  };

  it("says so when this console has no template to copy", async () => {
    expect(await detailOf((await seed()).seedWorkspaceSettings(WORKSPACE))).toMatch(/template settings/);
  });

  it("refuses to copy a template the bot could not read", async () => {
    fake.put("settings/defaults", { ...TEMPLATE, version: 7 });
    expect(await detailOf((await seed()).seedWorkspaceSettings(WORKSPACE))).toMatch(/could not be used/);
    expect(fake.has(TARGET)).toBe(false);
  });
});
