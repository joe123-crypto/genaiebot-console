import { describe, expect, it } from "vitest";
import { PER_BOT, RELEASE_PROFILE, botVariables, unreadableShared } from "@/src/domains/bot-variables";

/**
 * What a new bot ends up holding. The interesting half is what must be ABSENT:
 * an asset prefix it inherited would put a user's pictures in the shared folder,
 * and CI's read-scoped token on a per-user bot would be a credential nobody
 * meant to hand out.
 */

const TEMPLATE: Record<string, string> = {
  GCP_SERVICE_ACCOUNT_B64: "read-key",
  GCP_SERVICE_ACCOUNT_WRITE_B64: "write-key",
  R2_ACCOUNT_ID: "acct", R2_BUCKET: "bucket", R2_ACCESS_KEY_ID: "id", R2_SECRET_ACCESS_KEY: "secret",
  OPENROUTER_API_KEY: "openrouter",
  GENAIE_ASSET_KEY_PREFIX: "ads/",
  CONSOLE_API_GATE_TOKEN: "ci-gate",
  SOURCE_COMMIT: "deadbeef",
  CONSOLE_API_TOKEN: "the-template-bots-token",
  GATEWAY_AUTH_TOKEN: "the-template-bots-gateway",
  GENAIE_WORKSPACE_ID: "w-template",
  GENAIE_CAMPAIGN_CLICK_BASE_URL: "https://gateway.example",
  PUBLIC_BASE_URL: "https://gateway.example",
  APP_BASE_URL: "https://agent.example",
  RAILWAY_SERVICE_ID: "the-template-service",
  GENAIE_OVERNIGHT_STANDBY: "1",
  GENAIE_CAMPAIGN_TRANSPORT: "rpc-once",
  MALLOC_ARENA_MAX: "2",
  GENAIE_CAMPAIGN_DELETION: "1",
  GENAIE_COLD_START: "0",
};

const IDENTITY = {
  workspaceId: "wNewWorkspace1",
  domain: "bot-wnew-production-ab12.up.railway.app",
  consoleToken: "derived-token",
  gatewayToken: "fresh-gateway",
};

describe("a new bot's variables", () => {
  const variables = botVariables(TEMPLATE, IDENTITY);

  it("leaves the asset prefix unset, so pictures go under this workspace's own folder", () => {
    expect(variables).not.toHaveProperty("GENAIE_ASSET_KEY_PREFIX");
  });

  it("does not hand a user's bot CI's token or the template's build", () => {
    expect(variables).not.toHaveProperty("CONSOLE_API_GATE_TOKEN");
    expect(variables).not.toHaveProperty("SOURCE_COMMIT");
  });

  it("does not copy Railway's own names, which would give it the template's identity", () => {
    expect(Object.keys(variables).some((name) => name.startsWith("RAILWAY_"))).toBe(false);
  });

  it("replaces every per-bot value rather than inheriting one", () => {
    for (const name of PER_BOT) expect(variables[name]).not.toBe(TEMPLATE[name]);
    expect(variables.GENAIE_WORKSPACE_ID).toBe(IDENTITY.workspaceId);
    expect(variables.CONSOLE_API_TOKEN).toBe(IDENTITY.consoleToken);
    expect(variables.GATEWAY_AUTH_TOKEN).toBe(IDENTITY.gatewayToken);
  });

  it("turns the console API on, which is what makes the bot answer at all", () => {
    expect(variables.GENAIE_CONSOLE_API).toBe("1");
  });

  it("lets the bot write its own first config, since its volume starts empty", () => {
    // Without this the bot exits 78 instead of booting: nothing can seed a
    // Railway volume before its first boot.
    expect(variables.GENAIE_COLD_START).toBe("1");
  });

  it("points the bot's own links at its own domain", () => {
    const origin = `https://${IDENTITY.domain}`;
    expect(variables.GENAIE_CAMPAIGN_CLICK_BASE_URL).toBe(origin);
    expect(variables.PUBLIC_BASE_URL).toBe(origin);
  });

  it("copies APP_BASE_URL, which names the shared agent app and not this bot", () => {
    expect(variables.APP_BASE_URL).toBe(TEMPLATE.APP_BASE_URL);
  });

  it("carries the shared values across untouched", () => {
    expect(variables.GCP_SERVICE_ACCOUNT_B64).toBe("read-key");
    expect(variables.R2_SECRET_ACCESS_KEY).toBe("secret");
    expect(variables.GENAIE_CAMPAIGN_DELETION).toBe("1");
  });

  it("leaves out the gateway's release-profile trials, so a bot runs the baseline", () => {
    // genaebot's release job switches these on the gateway alone; absent, each
    // is its baseline default. Copied, a trial would spread to every bot.
    for (const name of ["GENAIE_OVERNIGHT_STANDBY", "GENAIE_CAMPAIGN_TRANSPORT", "MALLOC_ARENA_MAX"]) {
      expect(variables[name], name).toBeUndefined();
    }
    for (const name of RELEASE_PROFILE) expect(name in variables, name).toBe(false);
  });
});

describe("what the template must give us", () => {
  it("is happy with a template that has everything", () => {
    expect(unreadableShared(TEMPLATE)).toEqual([]);
  });

  it("names a value a sealed variable would not give back", () => {
    const sealed = { ...TEMPLATE, GCP_SERVICE_ACCOUNT_WRITE_B64: "" };
    expect(unreadableShared(sealed)).toEqual(["GCP_SERVICE_ACCOUNT_WRITE_B64"]);
  });

  it("treats a missing key and a blank one alike", () => {
    const { R2_BUCKET: _dropped, ...missing } = TEMPLATE;
    expect(unreadableShared({ ...missing, OPENROUTER_API_KEY: "   " })).toContain("R2_BUCKET");
    expect(unreadableShared({ ...missing, OPENROUTER_API_KEY: "   " })).toContain("OPENROUTER_API_KEY");
  });
});
