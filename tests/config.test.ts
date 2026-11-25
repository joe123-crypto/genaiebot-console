import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Where reads and writes go. No environment variable names a bot any more:
 * each workspace's bot comes from its registry entry (src/lib/workspace), so a
 * request can never fall back to a bot configured for the whole console. These
 * pin what the environment still decides: whether writes are armed, and the
 * development-only local adapter that production can never use.
 */

/**
 * What the real provisioner needs. Every one of them, or `BOT_PROVISIONING`
 * resolves to "none": a run that found half its settings missing after creating
 * a service would have spent money for nothing.
 */
const RAILWAY_ENV = {
  BOT_RAILWAY_API_TOKEN: "railway-token",
  BOT_RAILWAY_PROJECT_ID: "project-1",
  BOT_RAILWAY_ENVIRONMENT_ID: "environment-1",
  BOT_TEMPLATE_SERVICE_ID: "service-1",
  BOT_IMAGE: "ghcr.io/example/genaebot:released",
};

async function configWith(env: Record<string, string>) {
  vi.resetModules();
  for (const name of ["BOT_SOURCE", "CONSOLE_WRITES", "NODE_ENV", "BOT_PROVISIONING",
                      "BOT_API_BASE_URL", "BOT_API_TOKEN", "BOT_WRITE_API_BASE_URL", "BOT_WRITE_TOKEN",
                      ...Object.keys(RAILWAY_ENV), "BOT_CONSOLE_API_PORT", "BOT_SETTINGS_TEMPLATE",
                      "BOT_IMAGE_REGISTRY_USERNAME", "BOT_IMAGE_REGISTRY_PASSWORD"]) {
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
    expect((await configWith({ ...RAILWAY_ENV })).BOT_PROVISIONING).toBe("none");
  });

  it("stubs a run only outside production, whatever production is told", async () => {
    expect((await configWith({ BOT_PROVISIONING: "stub", NODE_ENV: "development" })).BOT_PROVISIONING).toBe("stub");
    expect((await configWith({ BOT_PROVISIONING: "stub", NODE_ENV: "production" })).BOT_PROVISIONING).toBe("none");
  });

  it("does not arm itself off the editing switch: a workspace with no bot has nothing to write to", async () => {
    expect((await configWith({ CONSOLE_WRITES: "1" })).BOT_PROVISIONING).toBe("none");
  });

  it("builds bots for real in production, which the stub may never do", async () => {
    const config = await configWith({ BOT_PROVISIONING: "railway", NODE_ENV: "production", ...RAILWAY_ENV });
    expect(config.BOT_PROVISIONING).toBe("railway");
    expect(config.RAILWAY_PROVISIONING).toMatchObject({
      projectId: "project-1", environmentId: "environment-1", image: RAILWAY_ENV.BOT_IMAGE,
    });
  });

  it("stays off when any one thing a run needs is missing", async () => {
    for (const name of Object.keys(RAILWAY_ENV)) {
      const partial = { ...RAILWAY_ENV, [name]: "" };
      expect((await configWith({ BOT_PROVISIONING: "railway", ...partial })).BOT_PROVISIONING).toBe("none");
    }
  });

  it("uses the running bot's own volume and port unless told otherwise", async () => {
    const config = await configWith({ BOT_PROVISIONING: "railway", ...RAILWAY_ENV });
    expect(config.RAILWAY_PROVISIONING).toMatchObject({ mountPath: "/home/joseph/.openclaw", port: 18790 });
    const chosen = await configWith({ BOT_PROVISIONING: "railway", ...RAILWAY_ENV, BOT_CONSOLE_API_PORT: "9000" });
    expect(chosen.RAILWAY_PROVISIONING?.port).toBe(9000);
  });

  it("refuses a port or a settings template it cannot make sense of", async () => {
    const nonsense: Record<string, string>[] = [
      { BOT_CONSOLE_API_PORT: "not-a-port" }, { BOT_CONSOLE_API_PORT: "70000" },
      { BOT_SETTINGS_TEMPLATE: "somewhere" }, { BOT_SETTINGS_TEMPLATE: "workspace:no" },
    ];
    for (const env of nonsense) {
      expect((await configWith({ BOT_PROVISIONING: "railway", ...RAILWAY_ENV, ...env })).BOT_PROVISIONING).toBe("none");
    }
  });

  it("wants both halves of a registry credential, or neither", async () => {
    const half = await configWith({ BOT_PROVISIONING: "railway", ...RAILWAY_ENV,
                                    BOT_IMAGE_REGISTRY_USERNAME: "someone" });
    expect(half.BOT_PROVISIONING).toBe("none");
    const both = await configWith({ BOT_PROVISIONING: "railway", ...RAILWAY_ENV,
                                    BOT_IMAGE_REGISTRY_USERNAME: "someone", BOT_IMAGE_REGISTRY_PASSWORD: "secret" });
    expect(both.RAILWAY_PROVISIONING?.registry).toEqual({ username: "someone", password: "secret" });
  });

  it("copies a new workspace's settings from the root install by default", async () => {
    expect((await configWith({})).BOT_SETTINGS_TEMPLATE).toBe("root");
    expect((await configWith({ BOT_SETTINGS_TEMPLATE: "workspace:wAbcdef12" })).BOT_SETTINGS_TEMPLATE)
      .toBe("workspace:wAbcdef12");
  });
});
