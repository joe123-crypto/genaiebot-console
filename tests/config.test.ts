import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Where reads and writes go. No environment variable names a bot any more:
 * each workspace's bot comes from its registry entry (src/lib/workspace), so a
 * request can never fall back to a bot configured for the whole console. These
 * pin what the environment still decides: whether writes are armed, and the
 * development-only local adapter that production can never use.
 */
async function configWith(env: Record<string, string>) {
  vi.resetModules();
  for (const name of ["BOT_SOURCE", "CONSOLE_WRITES", "NODE_ENV", "BOT_PROVISIONING",
                      "BOT_API_BASE_URL", "BOT_API_TOKEN", "BOT_WRITE_API_BASE_URL", "BOT_WRITE_TOKEN"]) {
    vi.stubEnv(name, env[name] ?? "");
  }
  return import("@/src/config");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("bot source", () => {
  it("is remote by default, and reads and writes always agree", async () => {
    const config = await configWith({});
    expect(config.BOT_SOURCE).toBe("remote");
    expect(config.WRITE_SOURCE).toBe(config.BOT_SOURCE);
  });

  it("is local only when asked for outside production", async () => {
    expect((await configWith({ BOT_SOURCE: "local", NODE_ENV: "development" })).BOT_SOURCE).toBe("local");
    expect((await configWith({ BOT_SOURCE: "local", NODE_ENV: "production" })).BOT_SOURCE).toBe("remote");
  });

  it("no longer exposes a console-wide bot address or token", async () => {
    const config = await configWith({ BOT_API_BASE_URL: "https://bot.example", BOT_API_TOKEN: "read-token",
                                      BOT_WRITE_API_BASE_URL: "https://other.example", BOT_WRITE_TOKEN: "write-token" });
    for (const name of ["BOT_API_BASE_URL", "BOT_API_TOKEN", "BOT_WRITE_API_BASE_URL", "BOT_WRITE_TOKEN"]) {
      expect(config).not.toHaveProperty(name);
    }
  });
});

describe("write switch", () => {
  it("arms writes once CONSOLE_WRITES is on", async () => {
    const config = await configWith({ CONSOLE_WRITES: "1" });
    expect(config.WRITES_ENABLED).toBe(true);
    expect(config.ACCOUNT_WRITES_ENABLED).toBe(true);
  });

  it("stays read-only without CONSOLE_WRITES whatever else is set", async () => {
    const config = await configWith({ BOT_API_BASE_URL: "https://bot.example", BOT_API_TOKEN: "read-token" });
    expect(config.WRITES_ENABLED).toBe(false);
    expect(config.ACCOUNT_WRITES_ENABLED).toBe(false);
  });

  it("keeps account controls off with the local adapter, which has no gateway", async () => {
    const config = await configWith({ CONSOLE_WRITES: "1", BOT_SOURCE: "local", NODE_ENV: "development" });
    expect(config.WRITES_ENABLED).toBe(true);
    expect(config.ACCOUNT_WRITES_ENABLED).toBe(false);
  });
});

describe("creating a bot from the console", () => {
  it("is off unless this deployment asks for it", async () => {
    expect((await configWith({})).BOT_PROVISIONING).toBe("none");
    expect((await configWith({ BOT_PROVISIONING: "railway" })).BOT_PROVISIONING).toBe("none");
  });

  it("stubs a run only outside production, whatever production is told", async () => {
    expect((await configWith({ BOT_PROVISIONING: "stub", NODE_ENV: "development" })).BOT_PROVISIONING).toBe("stub");
    expect((await configWith({ BOT_PROVISIONING: "stub", NODE_ENV: "production" })).BOT_PROVISIONING).toBe("none");
  });

  it("does not arm itself off the editing switch: a workspace with no bot has nothing to write to", async () => {
    expect((await configWith({ CONSOLE_WRITES: "1" })).BOT_PROVISIONING).toBe("none");
  });
});
