import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The console reads JSON from a bridge it does not version-lock, so the real
 * risk is not a missing payload but an outdated one: the screens read a missing
 * `enabled` as `undefined`, which is falsy, which means "switched off". Left
 * unchecked that renders every campaign dead and an empty schedule, with no
 * error anywhere. These tests pin the refusal.
 */

type ConfigOverrides = Record<string, unknown>;

async function loadWith(source: "local" | "remote", overrides: ConfigOverrides = {}) {
  vi.resetModules();
  vi.doMock("@/src/config", () => ({
    BOT_SOURCE: source,
    BOT_API_BASE_URL: source === "remote" ? "https://bot.example" : "",
    BOT_API_TOKEN: "",
    GENAEBOT_CHECKOUT: "/checkout",
    // Writes are a separate target with a separate switch, so a read-only
    // console is the default here exactly as it is in production.
    BOT_WRITE_API_BASE_URL: "",
    BOT_WRITE_TOKEN: "",
    WRITE_SOURCE: "local",
    WRITES_ENABLED: false,
    ...overrides,
  }));
  return import("@/src/lib/bot-client");
}

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@/src/config");
});

const live = { slug: "genaie", enabled: true };

/** The screens render `detail`, not `message` — that is the text an operator
 *  actually sees on the BotError card, so that is what these assert on. */
function detailOf(fn: () => void) {
  try {
    fn();
  } catch (error) {
    return (error as { detail?: string }).detail ?? String(error);
  }
  throw new Error("expected a refusal, got none");
}

/** The async twin of `detailOf`, for the write path. */
async function detailOfAsync(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (error) {
    return (error as { detail?: string }).detail ?? String(error);
  }
  throw new Error("expected a refusal, got none");
}

/**
 * Stand in for the subprocess the local adapter runs. The real `execFile`
 * carries a `promisify.custom` that resolves `{stdout, stderr}`, and
 * `bot-client` destructures that, so the stub has to carry one too or the
 * promisified call resolves to a bare string.
 */
async function mockSpawn(
  { stdout = "{}", failWith }: { stdout?: string; failWith?: string } = {},
) {
  const { promisify } = await import("node:util");
  const spawned: Array<{ cmd: string; argv: string[]; stdin?: string }> = [];

  const execFile = () => {
    throw new Error("the callback form is never used");
  };
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = (
    cmd: string,
    argv: string[],
  ) => {
    const call = { cmd, argv, stdin: undefined as string | undefined };
    spawned.push(call);
    const result = failWith
      ? Promise.reject(Object.assign(new Error("exit 1"), { stdout: failWith, code: 1 }))
      : Promise.resolve({ stdout, stderr: "" });
    return Object.assign(result, { child: { stdin: { end: (input: string) => { call.stdin = input; } } } });
  };

  vi.doMock("node:child_process", () => ({ execFile }));
  vi.doMock("node:fs", () => ({ existsSync: () => true }));
  return spawned;
}

describe("checkShape", () => {
  it("accepts a payload that carries everything the screens read", async () => {
    const { checkShape } = await loadWith("remote");
    expect(() => checkShape("overview", { campaigns: [live] })).not.toThrow();
    expect(() => checkShape("campaigns", { campaigns: [live] })).not.toThrow();
    expect(() => checkShape("groups", { disabledPromos: [], groups: [] })).not.toThrow();
    expect(() => checkShape("preview/cv", { enabled: false })).not.toThrow();
  });

  it("refuses campaigns with no enabled flag rather than reading them as off", async () => {
    const { checkShape, BotUnavailableError } = await loadWith("remote");
    expect(() => checkShape("campaigns", { campaigns: [{ slug: "cv" }] })).toThrow(
      BotUnavailableError,
    );
  });

  it("names the campaign it could not read", async () => {
    const { checkShape } = await loadWith("remote");
    expect(detailOf(() => checkShape("overview", { campaigns: [live, { slug: "cv" }] })))
      .toMatch(/cv/);
  });

  it("refuses a groups payload with no disabledPromos", async () => {
    const { checkShape } = await loadWith("remote");
    expect(detailOf(() => checkShape("groups", { groups: [] }))).toMatch(/disabledPromos/);
  });

  it("refuses a preview that cannot say whether the campaign is on", async () => {
    const { checkShape } = await loadWith("remote");
    expect(detailOf(() => checkShape("preview/cv", { captions: [] }))).toMatch(/enabled/);
  });

  it("tells a local reader to update the checkout", async () => {
    const { checkShape } = await loadWith("local");
    expect(detailOf(() => checkShape("groups", {}))).toMatch(/pull --ff-only/);
  });

  it("tells a remote reader to redeploy the gateway instead", async () => {
    const { checkShape } = await loadWith("remote");
    expect(detailOf(() => checkShape("groups", {}))).toMatch(/redeploy the gateway/);
  });

  it("does not require configShadow, which older bridges do not send", async () => {
    // Unlike `enabled`, a missing shadow report is not read as a decision --
    // the screens show nothing rather than something false -- so refusing the
    // whole payload over it would be the worse answer.
    const { checkShape } = await loadWith("remote");
    expect(() => checkShape("overview", { campaigns: [live] })).not.toThrow();
    expect(() =>
      checkShape("overview", {
        campaigns: [live],
        configShadow: { mode: "shadow", warning: null, lastCheck: null },
      }),
    ).not.toThrow();
  });

  it("says nothing about routes it does not police", async () => {
    const { checkShape } = await loadWith("remote");
    expect(() => checkShape("something-else", {})).not.toThrow();
  });
});

/**
 * Deleting a group is the console's first write, and it fails differently from
 * a read. A read that goes wrong costs a page the operator can reload; a write
 * that goes wrong leaves them not knowing whether it happened. These pin the
 * three answers that difference demands: writes are off unless switched on, a
 * refusal keeps the bridge's own words, and a timeout is reported as unknown
 * rather than as failure.
 */
describe("deleteGroup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:fs");
  });

  const REMOTE = {
    BOT_WRITE_API_BASE_URL: "https://write.example/",
    BOT_WRITE_TOKEN: "write-token",
    WRITE_SOURCE: "remote",
    WRITES_ENABLED: true,
  };

  // Not `Partial<Response>`: there, `body` is a ReadableStream, and what these
  // tests want to hand back is the text the write service actually sends.
  function stubFetch(reply: { ok?: boolean; status?: number; body?: string }) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        text: async () => reply.body ?? "{}",
      } as Response;
    });
    return calls;
  }

  it("refuses while writes are switched off, before reaching anything", async () => {
    const { deleteGroup, WritesDisabledError } = await loadWith("remote");
    const calls = stubFetch({});
    await expect(deleteGroup("1203@g.us", { by: "Joseph" })).rejects.toBeInstanceOf(
      WritesDisabledError,
    );
    expect(calls).toHaveLength(0);
  });

  it("posts a delete to the bot's one config route", async () => {
    // The route the bot actually has: earlier versions called
    // groups/<jid>/delete, which never existed on the bot.
    const { deleteGroup } = await loadWith("remote", REMOTE);
    const result = { collection: "groups", id: "1203@g.us", change: "deleted",
                     fields: ["name"], warnings: [], audit: "20261108T000000Z-ab" };
    const calls = stubFetch({ body: JSON.stringify({ ok: true, status: 200, ...result }) });

    await expect(deleteGroup("1203@g.us", { by: "Joseph", reason: "left" }))
      .resolves.toMatchObject(result);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://write.example/internal/console/config/groups/1203%40g.us",
    );
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
      "Bearer write-token",
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual(
      { delete: true, reason: "left", actor: "Joseph" });
  });

  it("leaves the reason out when none was given", async () => {
    const { deleteGroup } = await loadWith("remote", REMOTE);
    const calls = stubFetch({ body: "{}" });
    await deleteGroup("1203@g.us", { by: "Joseph" });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ delete: true, actor: "Joseph" });
  });

  it("bounds the call, unlike the reads", async () => {
    const { deleteGroup } = await loadWith("remote", REMOTE);
    const calls = stubFetch({ body: "{}" });
    await deleteGroup("1203@g.us", { by: "Joseph" });
    expect(calls[0].init.signal).toBeDefined();
  });

  it("keeps the write service's own words on a refusal", async () => {
    const { deleteGroup } = await loadWith("remote", REMOTE);
    stubFetch({ ok: false, status: 404, body: '{"error": "no such group in the records"}' });
    expect(await detailOfAsync(() => deleteGroup("nope@g.us", { by: "Joseph" }))).toBe(
      "no such group in the records",
    );
  });

  it("falls back to the status when the body is not the bridge's error shape", async () => {
    const { deleteGroup } = await loadWith("remote", REMOTE);
    stubFetch({ ok: false, status: 503, body: "<html>busy</html>" });
    expect(await detailOfAsync(() => deleteGroup("1203@g.us", { by: "Joseph" }))).toMatch(/503/);
  });

  it("reports a timeout as an unknown outcome, not a failure", async () => {
    const { deleteGroup } = await loadWith("remote", REMOTE);
    vi.stubGlobal("fetch", async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    expect(await detailOfAsync(() => deleteGroup("1203@g.us", { by: "Joseph" }))).toMatch(
      /may still have been made/,
    );
  });

  it("runs the write bridge, not the read one, with the delete as JSON on stdin",
    async () => {
      // console-write has no delete-group subcommand: it reads one JSON request,
      // so the jid is a field of that, never an argument a shell could see.
      const spawned = await mockSpawn({ stdout: '{"ok":true,"change":"deleted"}' });
      const { deleteGroup } = await loadWith("local", {
        WRITE_SOURCE: "local",
        WRITES_ENABLED: true,
      });

      await deleteGroup("1203@g.us", { by: "Joseph", reason: "left" });

      expect(spawned).toHaveLength(1);
      expect(spawned[0].argv).toEqual(["-I", "/checkout/workspace/bin/console-write"]);
      expect(JSON.parse(spawned[0].stdin!)).toEqual({
        collection: "groups", id: "1203@g.us", delete: true, reason: "left", actor: "Joseph",
      });
    });

  it("surfaces the local bridge's curated error", async () => {
    await mockSpawn({ failWith: '{"error": "membership.json has no 1203@g.us"}' });
    const { deleteGroup } = await loadWith("local", {
      WRITE_SOURCE: "local",
      WRITES_ENABLED: true,
    });
    expect(await detailOfAsync(() => deleteGroup("1203@g.us", { by: "Joseph" }))).toBe(
      "membership.json has no 1203@g.us",
    );
  });
});

/**
 * Every config edit goes through one function, to one route, so these pin the
 * route per collection and -- most of all -- that a refusal arrives with the
 * bot's own reasons. "This change would stop the group being advertised to"
 * means little without the validator's line saying which field broke it.
 */
describe("writeConfig", () => {
  afterEach(() => {
    vi.unstubAllGlobals(); vi.doUnmock("node:child_process"); vi.doUnmock("node:fs");
  });

  const REMOTE = {
    BOT_WRITE_API_BASE_URL: "https://bot.example", BOT_WRITE_TOKEN: "t",
    WRITE_SOURCE: "remote", WRITES_ENABLED: true,
  };

  function stubFetch(reply: { ok?: boolean; status?: number; body?: string }) {
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return { ok: reply.ok ?? true, status: reply.status ?? 200,
               text: async () => reply.body ?? "{}" } as Response;
    });
    return calls;
  }

  it("routes each collection to config/<collection>/<id>", async () => {
    const client = await loadWith("remote", REMOTE);
    const calls = stubFetch({});
    await client.updateGroup("1@g.us", { status: "on-hold" }, { by: "Joseph" });
    await client.updateCampaign("cv", { enabled: false }, { by: "Joseph" });
    await client.updateLine("ads", { number: "+263700000000" }, { by: "Joseph" });
    await client.updateSettings({ caps_enabled: true }, { by: "Joseph" });
    expect(calls.map((call) => call.url)).toEqual([
      "https://bot.example/internal/console/config/groups/1%40g.us",
      "https://bot.example/internal/console/config/campaigns/cv",
      "https://bot.example/internal/console/config/lines/ads",
      "https://bot.example/internal/console/config/settings/defaults",
    ]);
    expect(calls[0].body).toEqual({ fields: { status: "on-hold" }, actor: "Joseph" });
  });

  it("passes a dry run through, and only when asked", async () => {
    const client = await loadWith("remote", REMOTE);
    const calls = stubFetch({});
    await client.updateGroup("1@g.us", { note: "x" }, { by: "Joseph", dryRun: true });
    await client.updateGroup("1@g.us", { note: "x" }, { by: "Joseph" });
    expect(calls[0].body).toMatchObject({ dryRun: true });
    expect(calls[1].body).not.toHaveProperty("dryRun");
  });

  it("refuses before contacting anything while writes are off", async () => {
    const { updateGroup, WritesDisabledError } = await loadWith("remote");
    const calls = stubFetch({});
    await expect(updateGroup("1@g.us", { note: "x" }, { by: "Joseph" }))
      .rejects.toBeInstanceOf(WritesDisabledError);
    expect(calls).toHaveLength(0);
  });

  it("carries the bot's reasons on a remote refusal", async () => {
    const { updateGroup, WriteRefusedError } = await loadWith("remote", REMOTE);
    stubFetch({ ok: false, status: 400, body: JSON.stringify({
      ok: false, status: 400, error: "this change would stop 1@g.us being advertised to",
      problems: ["group 1@g.us: paused_promos names promo 'cv' which is not in its promos"],
    }) });
    const error = await updateGroup("1@g.us", { paused_promos: ["cv"] }, { by: "Joseph" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteRefusedError);
    const refused = error as InstanceType<typeof WriteRefusedError>;
    expect(refused.detail).toBe("this change would stop 1@g.us being advertised to");
    expect(refused.problems).toEqual(
      ["group 1@g.us: paused_promos names promo 'cv' which is not in its promos"]);
    expect(refused.status).toBe(400);
  });

  it("carries them from the local bridge too", async () => {
    await mockSpawn({ failWith: JSON.stringify({
      ok: false, status: 400, error: "this change would be read differently",
      problems: ["caps_enabled must be true or false, got 'false'"] }) });
    const { updateSettings, WriteRefusedError } = await loadWith("local", { WRITES_ENABLED: true });
    const error = await updateSettings({ caps_enabled: "false" }, { by: "Joseph" })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WriteRefusedError);
    expect((error as InstanceType<typeof WriteRefusedError>).problems).toHaveLength(1);
  });

  it("is still a BotUnavailableError, so existing screens keep showing it", async () => {
    const { updateGroup, BotUnavailableError } = await loadWith("remote", REMOTE);
    stubFetch({ ok: false, status: 409, body: '{"ok":false,"status":409,"error":"cannot be read"}' });
    await expect(updateGroup("1@g.us", { note: "x" }, { by: "Joseph" }))
      .rejects.toBeInstanceOf(BotUnavailableError);
  });

  it("does not mistake the write route's own 503 for a refusal", async () => {
    // "Writes are not enabled" comes from the API, not from console-write, so it
    // has no `ok` field: the outcome is "could not write", not "refused".
    const { updateGroup, WriteRefusedError } = await loadWith("remote", REMOTE);
    stubFetch({ ok: false, status: 503,
                body: '{"error":"Operator-config writes are not enabled on this gateway."}' });
    const error = await updateGroup("1@g.us", { note: "x" }, { by: "Joseph" })
      .catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(WriteRefusedError);
    expect((error as { detail: string }).detail).toMatch(/not enabled/);
  });
});

describe("captionSaveUnavailableReason", () => {
  const WRITES = { enabled: true, affectsProduction: true,
                   fields: { campaigns: ["enabled"] }, delete: ["groups"] };

  it("says captions wait on the bot while it does not accept them", async () => {
    const { captionSaveUnavailableReason } = await loadWith("remote", {
      WRITE_SOURCE: "remote", WRITES_ENABLED: true });
    expect(captionSaveUnavailableReason(WRITES)).toMatch(/does not accept changes to captions/);
  });

  it("allows saving once the bot lists captions", async () => {
    const { captionSaveUnavailableReason } = await loadWith("remote", {
      WRITE_SOURCE: "remote", WRITES_ENABLED: true });
    expect(captionSaveUnavailableReason(
      { ...WRITES, fields: { campaigns: ["enabled", "captions"] } })).toBeUndefined();
  });
});

describe("updateCampaignCaptions", () => {
  afterEach(() => {
    vi.unstubAllGlobals(); vi.doUnmock("node:child_process"); vi.doUnmock("node:fs");
  });
  it("refuses writes before contacting the bot when disabled", async () => {
    const { updateCampaignCaptions, WritesDisabledError } = await loadWith("local");
    await expect(updateCampaignCaptions("cv", ["Copy"], { by: "Joseph" })).rejects.toBeInstanceOf(WritesDisabledError);
  });
  it("sends the canonical config request with the write service token", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{"ok":true}' });
    vi.stubGlobal("fetch", fetchMock);
    const { updateCampaignCaptions } = await loadWith("remote", {
      WRITE_SOURCE: "remote", WRITES_ENABLED: true,
      BOT_WRITE_API_BASE_URL: "https://write.example/", BOT_WRITE_TOKEN: "write-key",
    });
    await updateCampaignCaptions("borehole", ["💧 {bot_number}\n\n{ref_link}"], { by: "Joseph" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://write.example/internal/console/config/campaigns/borehole");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer write-key");
    expect(JSON.parse(init.body)).toEqual({ fields: { captions: ["💧 {bot_number}\n\n{ref_link}"] }, actor: "Joseph" });
  });
  it("passes local copy as JSON stdin to the write bridge without shell interpolation", async () => {
    const spawned = await mockSpawn({ stdout: '{"ok":true}' });
    const { updateCampaignCaptions } = await loadWith("local", { WRITES_ENABLED: true });
    const captions = ['💧 "$HOME" `whoami`\n\n{ref_link}'];
    await updateCampaignCaptions("cv", captions, { by: "Joseph" });
    expect(spawned[0].argv).toEqual(["-I", "/checkout/workspace/bin/console-write"]);
    expect(JSON.parse(spawned[0].stdin!)).toEqual({ collection: "campaigns", id: "cv", fields: { captions }, actor: "Joseph" });
  });
});

/**
 * Group actions are a different route from the config writer, because they are
 * a different kind of thing: they change WhatsApp and the volume, not the
 * config document. The bot gates them on the gateway rather than on its write
 * key, so these pin that the console asks at the right address and sends only
 * what was ticked.
 */
describe("groupAction", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:fs");
  });

  const REMOTE = {
    BOT_WRITE_API_BASE_URL: "https://write.example/",
    BOT_WRITE_TOKEN: "write-token",
    WRITE_SOURCE: "remote",
    WRITES_ENABLED: true,
  };

  function stubFetch(reply: { ok?: boolean; status?: number; body?: string }) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 200,
        text: async () => reply.body ?? "{}",
      } as Response;
    });
    return calls;
  }

  it("refuses while writes are switched off, before reaching anything", async () => {
    const { groupAction, WritesDisabledError } = await loadWith("remote");
    const calls = stubFetch({});
    await expect(groupAction("1203@g.us", { leave: true, clearRecords: false, by: "Joseph" }))
      .rejects.toBeInstanceOf(WritesDisabledError);
    expect(calls).toHaveLength(0);
  });

  it("posts to the group action route, not the config one", async () => {
    const { groupAction } = await loadWith("remote", REMOTE);
    const result = { jid: "1203@g.us", account: "ads",
                     leave: { requested: true, ok: true, already: false, error: null },
                     cleared: { requested: true, campaigns: {}, checked: 1 } };
    const calls = stubFetch({ body: JSON.stringify({ ok: true, status: 200, ...result }) });

    await expect(groupAction("1203@g.us",
      { leave: true, clearRecords: true, account: "ads", by: "Joseph" }))
      .resolves.toMatchObject(result);

    expect(calls[0].url).toBe(
      "https://write.example/internal/console/groups/1203%40g.us/actions",
    );
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
      "Bearer write-token",
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual(
      { leave: true, clearRecords: true, account: "ads", actor: "Joseph" });
  });

  it("sends only what was ticked, so an untouched box asks for nothing", async () => {
    const { groupAction } = await loadWith("remote", REMOTE);
    const calls = stubFetch({ body: "{}" });
    await groupAction("1203@g.us", { leave: false, clearRecords: true, by: "Joseph" });
    expect(JSON.parse(String(calls[0].init.body)))
      .toEqual({ clearRecords: true, actor: "Joseph" });
  });

  it("bounds the call, so an operator is never left waiting on a leave", async () => {
    const { groupAction } = await loadWith("remote", REMOTE);
    const calls = stubFetch({ body: "{}" });
    await groupAction("1203@g.us", { leave: true, clearRecords: false, by: "Joseph" });
    expect(calls[0].init.signal).toBeDefined();
  });

  it("keeps the bot's own words when it refuses", async () => {
    const { groupAction, WriteRefusedError } = await loadWith("remote", REMOTE);
    stubFetch({ ok: false, status: 400,
                body: JSON.stringify({ ok: false, status: 400,
                                       error: "jid must be a WhatsApp group id",
                                       problems: [] }) });

    await expect(groupAction("nope", { leave: true, clearRecords: false, by: "Joseph" }))
      .rejects.toBeInstanceOf(WriteRefusedError);
  });
});
