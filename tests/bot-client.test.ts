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
  const spawned: Array<{ cmd: string; argv: string[] }> = [];

  const execFile = () => {
    throw new Error("the callback form is never used");
  };
  (execFile as unknown as Record<symbol, unknown>)[promisify.custom] = async (
    cmd: string,
    argv: string[],
  ) => {
    spawned.push({ cmd, argv });
    if (failWith) throw Object.assign(new Error("exit 1"), { stdout: failWith, code: 1 });
    return { stdout, stderr: "" };
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

  it("posts to the write service with its own token", async () => {
    const { deleteGroup } = await loadWith("remote", REMOTE);
    const calls = stubFetch({ body: '{"jid":"1203@g.us"}' });

    await expect(deleteGroup("1203@g.us", { by: "Joseph", reason: "left" })).resolves.toEqual({
      jid: "1203@g.us",
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(
      "https://write.example/internal/console/groups/1203%40g.us/delete",
    );
    expect(calls[0].init.method).toBe("POST");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(
      "Bearer write-token",
    );
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ by: "Joseph", reason: "left" });
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

  it("runs the write bridge, not the read one, and passes the jid as one argument",
    async () => {
      const spawned = await mockSpawn({ stdout: '{"jid":"1203@g.us"}' });
      const { deleteGroup } = await loadWith("local", {
        WRITE_SOURCE: "local",
        WRITES_ENABLED: true,
      });

      await deleteGroup("1203@g.us", { by: "Joseph", reason: "left" });

      expect(spawned).toHaveLength(1);
      expect(spawned[0].argv).toEqual([
        "-I",
        "/checkout/workspace/bin/console-write",
        "delete-group",
        "1203@g.us",
        "--by",
        "Joseph",
        "--reason",
        "left",
      ]);
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
