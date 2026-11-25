/**
 * What a new bot's Railway service holds, built from the template bot's.
 *
 * A bot needs around forty variables, most of them shared with every other bot:
 * the Firestore keys, the R2 bucket, the model keys, the feature switches. The
 * console does not keep its own copy of any of them. It reads them off the
 * template service when a run starts and writes them straight onto the new one,
 * so the only secret this console holds is the one it derives
 * (`CONSOLE_API_TOKEN`) and the credentials it needs to do the asking.
 *
 * Pure, and separate from the Railway client, so what a new bot ends up holding
 * can be checked against a plain record -- including the things that must be
 * ABSENT, which is the part worth testing.
 */

/** Set per bot, never taken from the template. */
export const PER_BOT = [
  "GENAIE_WORKSPACE_ID",
  "CONSOLE_API_TOKEN",
  "GATEWAY_AUTH_TOKEN",
  "GENAIE_CONSOLE_API",
  "GENAIE_COLD_START",
  "GENAIE_CAMPAIGN_CLICK_BASE_URL",
  "PUBLIC_BASE_URL",
] as const;

/**
 * Dropped, each for its own reason:
 *
 * * `GENAIE_ASSET_KEY_PREFIX` -- unset is what puts this bot's pictures under
 *   `w/<id>/ads/` instead of the shared `ads/` (`docs/provision-bot.md`).
 *   Absent is the setting, which is why the upsert replaces rather than merges.
 * * `CONSOLE_API_GATE_TOKEN` -- the read-scoped bearer the release gates hold.
 *   A per-user bot has no business accepting CI's token.
 * * `SOURCE_COMMIT` -- described the template's uploaded build. A bot created
 *   from an image is whatever that image is; a stale commit here would misreport
 *   which code is running.
 *
 * `RAILWAY_`-prefixed names are dropped too: Railway injects its own into every
 * service, and copying them would hand a new bot the template's identity.
 */
export const NOT_COPIED = [
  "GENAIE_ASSET_KEY_PREFIX",
  "CONSOLE_API_GATE_TOKEN",
  "SOURCE_COMMIT",
] as const;

/**
 * Shared values a bot cannot work without, checked before anything is built.
 *
 * A sealed Railway variable is listed by name with no value and can never be
 * read back, so it cannot be copied -- and a bot missing its Firestore key
 * cannot read its own config, which fails every send closed. Checking first
 * means the user is told why instead of watching a run build a bot that can
 * serve nothing.
 *
 * Deliberately not the whole shared set: the model and job-search keys are
 * feature-level, and a bot without them still runs and still shows a console.
 * These seven are the ones whose absence makes the bot pointless.
 */
export const REQUIRED_SHARED = [
  "GCP_SERVICE_ACCOUNT_B64",
  "GCP_SERVICE_ACCOUNT_WRITE_B64",
  "R2_ACCOUNT_ID",
  "R2_BUCKET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "OPENROUTER_API_KEY",
] as const;

/** Which required values the template would not give us, in order. Empty is good. */
export function unreadableShared(template: Record<string, string>): string[] {
  return REQUIRED_SHARED.filter((name) => !template[name]?.trim());
}

export type BotIdentity = {
  workspaceId: string;
  /** The bot's own Railway domain, host only. */
  domain: string;
  /** `deriveBotToken(workspaceId)`: what the bot must hold to be believed. */
  consoleToken: string;
  /** Fresh for this bot; the template's is another bot's gateway password. */
  gatewayToken: string;
};

/**
 * The new service's whole variable set.
 *
 * `APP_BASE_URL` is copied rather than pointed at the new bot. It is not this
 * bot's own address: genaebot reads it as the shared agent app's base
 * (`workspace/cv-maker/cvmaker/common.py:agent_base_url`), so repointing it at
 * a user's bot would send those requests nowhere.
 */
export function botVariables(template: Record<string, string>, identity: BotIdentity): Record<string, string> {
  const dropped = new Set<string>([...NOT_COPIED, ...PER_BOT]);
  const variables: Record<string, string> = {};
  for (const [name, value] of Object.entries(template)) {
    if (dropped.has(name) || name.startsWith("RAILWAY_")) continue;
    variables[name] = value;
  }
  const origin = `https://${identity.domain}`;
  variables.GENAIE_WORKSPACE_ID = identity.workspaceId;
  variables.CONSOLE_API_TOKEN = identity.consoleToken;
  variables.GATEWAY_AUTH_TOKEN = identity.gatewayToken;
  // The entrypoint starts the console API only when this is exactly "1"; without
  // it the bot never answers, and the run could only ever time out waiting.
  variables.GENAIE_CONSOLE_API = "1";
  // This bot's volume is brand new and empty, and nothing can put a file on a
  // Railway volume before its first boot. Without this the bot refuses to start
  // (`exit 78`) rather than writing its initial config from the baked template.
  // It is set only on a bot created from nothing, which is every bot this
  // provisioner makes; the template bot must never have it.
  variables.GENAIE_COLD_START = "1";
  variables.GENAIE_CAMPAIGN_CLICK_BASE_URL = origin;
  variables.PUBLIC_BASE_URL = origin;
  return variables;
}
