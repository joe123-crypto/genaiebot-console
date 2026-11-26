/**
 * The console never holds its own copy of operator state. Each signed-in user
 * has a workspace, and each workspace has its own bot: the console reaches it
 * at the URL its registry entry names (`src/lib/workspace`). Nothing here names
 * a bot, so there is no default for a request to fall back to.
 */

export const PRODUCT_NAME = "Genaie";

/** Where the bot's own tooling lives when we read it locally. */
export const GENAEBOT_CHECKOUT =
  process.env.GENAEBOT_CHECKOUT?.trim() || "/home/joseph/projects/genaebot";

export type BotSource = "local" | "remote";

/**
 * `remote` everywhere except an explicit `BOT_SOURCE=local` in development,
 * which runs the bridges from GENAEBOT_CHECKOUT for the signed-in user's
 * workspace. Production never shells out, whatever the variable says.
 */
export const BOT_SOURCE: BotSource =
  process.env.BOT_SOURCE?.trim() === "local" && process.env.NODE_ENV !== "production" ? "local" : "remote";

export type ProvisionSource = "railway" | "stub" | "none";

/**
 * How a new bot is built, and where. `railway` creates a service of its own for
 * the workspace from a published image; everything a run needs is here, because
 * a provisioner that discovered half its settings mid-run could leave a service
 * behind with no way to reach it.
 *
 * `token` is a Railway account token: it can create and delete services, so it
 * is server-only and never prefixed `NEXT_PUBLIC_`. `templateServiceId` is the
 * service a new bot copies its shared values from (the Firestore keys, R2, the
 * model keys); the console reads them at provision time rather than holding its
 * own copy of anybody's secrets.
 *
 * Every name is prefixed `BOT_`, including the Railway ones, because Railway
 * injects `RAILWAY_PROJECT_ID` and `RAILWAY_ENVIRONMENT_ID` into every service
 * it runs: a console deployed on Railway would read its own ids from those
 * names and create each user's bot inside the console's own project.
 */
export type RailwayProvisioning = {
  token: string;
  projectId: string;
  environmentId: string;
  templateServiceId: string;
  image: string;
  /** Only for a private package. Railway pulls with these; we never store them. */
  registry: { username: string; password: string } | null;
  mountPath: string;
  region: string;
  port: number;
};

/** The bot's state volume, and the port its console API listens on. Defaults are
 *  the running bot's own, so a deployment that sets neither matches it. */
const DEFAULT_MOUNT_PATH = "/home/joseph/.openclaw";
const DEFAULT_REGION = "europe-west4-drams3a";
const DEFAULT_PORT = 18790;
/**
 * Which tree a new workspace's `settings/defaults` is copied from: `root`, or
 * `workspace:<id>` once the root install is retired. The same vocabulary as
 * genaebot's `deploy/init-workspace.py --settings-from`. An unrecognised value
 * is empty here, which leaves provisioning off rather than seeding a bot from
 * somewhere nobody meant.
 */
const SETTINGS_TEMPLATE = /^(root|workspace:[A-Za-z0-9_-]{6,40})$/;
const settingsTemplate = process.env.BOT_SETTINGS_TEMPLATE?.trim() || "root";
export const BOT_SETTINGS_TEMPLATE = SETTINGS_TEMPLATE.test(settingsTemplate) ? settingsTemplate : "";

function railwayProvisioning(): RailwayProvisioning | null {
  const read = (name: string) => process.env[name]?.trim() || "";
  const token = read("BOT_RAILWAY_API_TOKEN");
  const projectId = read("BOT_RAILWAY_PROJECT_ID");
  const environmentId = read("BOT_RAILWAY_ENVIRONMENT_ID");
  const templateServiceId = read("BOT_TEMPLATE_SERVICE_ID");
  const image = read("BOT_IMAGE");
  // Half-configured is not configured. A run that got as far as creating a
  // service and then found no image would have spent money for nothing, so an
  // incomplete environment leaves provisioning off and `/setup` says so.
  if (!token || !projectId || !environmentId || !templateServiceId || !image) return null;
  const port = Number.parseInt(read("BOT_CONSOLE_API_PORT") || String(DEFAULT_PORT), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
  if (!BOT_SETTINGS_TEMPLATE) return null;
  const username = read("BOT_IMAGE_REGISTRY_USERNAME");
  const password = read("BOT_IMAGE_REGISTRY_PASSWORD");
  // Both or neither: one of the pair alone is a misconfiguration, not a public image.
  if (Boolean(username) !== Boolean(password)) return null;
  return {
    token, projectId, environmentId, templateServiceId, image,
    registry: username && password ? { username, password } : null,
    mountPath: read("BOT_VOLUME_MOUNT_PATH") || DEFAULT_MOUNT_PATH,
    region: read("BOT_RAILWAY_REGION") || DEFAULT_REGION,
    port,
  };
}

export const RAILWAY_PROVISIONING = railwayProvisioning();

/**
 * Whether `/setup` can create a workspace's bot itself.
 *
 * `railway` is the real provisioner and the only value production may use; it
 * needs its whole environment, or it resolves to `none` rather than failing a
 * run halfway. `stub` walks the creation screen through its stages without
 * building anything and is development-only -- a screen that claimed in
 * production to have created a bot would be lying to the one user who cannot
 * check. `none` leaves a bot to the runbook (`docs/provision-bot.md`).
 */
export const BOT_PROVISIONING: ProvisionSource =
  process.env.BOT_PROVISIONING?.trim() === "railway" && RAILWAY_PROVISIONING ? "railway"
  : process.env.BOT_PROVISIONING?.trim() === "stub" && process.env.NODE_ENV !== "production" ? "stub"
  : "none";

/**
 * Development only: a bot origin the stub's last stage really connects to, so
 * the finished run leaves a working console rather than a simulated one. Unset,
 * the stub writes nothing and the screen says the run was simulated.
 */
export const BOT_PROVISIONING_STUB_URL = process.env.BOT_PROVISIONING_STUB_URL?.trim() || "";

/** Reads and writes always reach the same bot: the workspace's own. */
export const WRITE_SOURCE: BotSource = BOT_SOURCE;

/**
 * Writes are opt-in and off by default.
 *
 * Every request requires a verified Google session. Authentication does not
 * arm editing: the console and bot write gates must still agree. Whether the
 * user's workspace has a bot to write to is checked per request.
 *
 * This is only the console's half: the bot reports separately whether it
 * holds a write key and which fields it will accept (`overview.writes`, see
 * `src/lib/write-capabilities`), and every control gates on both.
 */
export const WRITES_ENABLED = process.env.CONSOLE_WRITES?.trim() === "1";

/** Account controls share the console's opt-in switch but require the live
 * gateway API rather than the canonical group/campaign writer. */
export const ACCOUNT_WRITES_ENABLED = WRITES_ENABLED && BOT_SOURCE === "remote";

/** The zone campaign sends are planned in, and the clock the console shows
 *  until an operator picks the other one (see `src/lib/timezone`). Changing
 *  which clock is on screen never moves a send: that is the bot's own setting. */
export const BOT_TIMEZONE = "Africa/Harare";

export const SESSION_COOKIE_NAME = "genaie_console_session";
/** Which clock this browser reads the console on. A preference, not operator
 *  state: it is held by the browser that chose it and never reaches the bot. */
export const TIMEZONE_COOKIE_NAME = "genaie_console_timezone";
export const TIMEZONE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
/** Whether this browser reads the console light or dark (see `src/lib/theme`).
 *  Like the clock, a preference held by the browser that chose it: it never
 *  reaches the bot, and an unset cookie is light. */
export const THEME_COOKIE_NAME = "genaie_console_theme";
export const THEME_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
