import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Where writes go. With only the read URL set, writes used to fall back to a
 * local checkout -- validated by whatever branch it had checked out, needing a
 * write key on the laptop -- while the screens showed production. These pin the
 * fix: writes follow the reads unless told otherwise, and a token is never sent
 * to a host other than the one it belongs to.
 */
async function configWith(env: Record<string, string>) {
  vi.resetModules();
  for (const name of ["BOT_API_BASE_URL", "BOT_API_TOKEN", "BOT_WRITE_API_BASE_URL",
                      "BOT_WRITE_TOKEN", "CONSOLE_WRITES"]) {
    vi.stubEnv(name, env[name] ?? "");
  }
  return import("@/src/config");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("write target", () => {
  it("follows the read API when no write URL is given", async () => {
    const config = await configWith({ BOT_API_BASE_URL: "https://bot.example",
                                      BOT_API_TOKEN: "read-token" });
    expect(config.BOT_WRITE_API_BASE_URL).toBe("https://bot.example");
    expect(config.BOT_WRITE_TOKEN).toBe("read-token");
    expect(config.WRITE_SOURCE).toBe(config.BOT_SOURCE);
    expect(config.WRITE_SOURCE).toBe("remote");
  });

  it("stays local when the reads are local", async () => {
    const config = await configWith({});
    expect(config.WRITE_SOURCE).toBe("local");
    expect(config.BOT_SOURCE).toBe("local");
  });

  it("honours an explicit write URL and token", async () => {
    const config = await configWith({ BOT_API_BASE_URL: "https://bot.example",
                                      BOT_API_TOKEN: "read-token",
                                      BOT_WRITE_API_BASE_URL: "https://other.example",
                                      BOT_WRITE_TOKEN: "write-token" });
    expect(config.BOT_WRITE_API_BASE_URL).toBe("https://other.example");
    expect(config.BOT_WRITE_TOKEN).toBe("write-token");
  });

  it("never sends the read token to a different write host", async () => {
    const config = await configWith({ BOT_API_BASE_URL: "https://bot.example",
                                      BOT_API_TOKEN: "read-token",
                                      BOT_WRITE_API_BASE_URL: "https://other.example" });
    expect(config.BOT_WRITE_TOKEN).toBe("");
  });

  it("arms writes from the read settings alone once CONSOLE_WRITES is on", async () => {
    const config = await configWith({ BOT_API_BASE_URL: "https://bot.example",
                                      BOT_API_TOKEN: "read-token", CONSOLE_WRITES: "1" });
    expect(config.WRITES_ENABLED).toBe(true);
  });

  it("stays read-only without CONSOLE_WRITES whatever else is set", async () => {
    const config = await configWith({ BOT_API_BASE_URL: "https://bot.example",
                                      BOT_API_TOKEN: "read-token" });
    expect(config.WRITES_ENABLED).toBe(false);
  });
});
