import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  BOT_API_BASE_URL,
  BOT_API_TOKEN,
  BOT_SOURCE,
  GENAEBOT_CHECKOUT,
} from "@/src/config";
import type {
  Campaign,
  CampaignPreview,
  GroupsPayload,
  Overview,
} from "@/src/lib/types";

const run = promisify(execFile);

/**
 * The console reads operator state from exactly one of two places: a local
 * genaebot checkout (development) or the console API beside the gateway
 * (production). Both return the same shapes, produced by the same Python
 * helpers, so a screen cannot behave differently depending on which is in use.
 */

export class BotUnavailableError extends Error {
  readonly detail: string;
  constructor(detail: string) {
    super("Could not reach the bot's state.");
    this.name = "BotUnavailableError";
    this.detail = detail;
  }
}

/**
 * The read bridge lives in genaebot rather than here, so this adapter and the
 * console API run the very same script and cannot drift apart.
 */
const BRIDGE = path.join(GENAEBOT_CHECKOUT, "workspace", "bin", "console-read");

/** The bridge reports a refusal as `{"error": ...}` and a non-zero exit. */
function reportedError(stdout: string | undefined) {
  if (!stdout) return null;
  try {
    const payload: unknown = JSON.parse(stdout);
    if (payload && typeof payload === "object" && "error" in payload) {
      return String((payload as { error: unknown }).error);
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * `-I` runs Python in isolated mode so the bot's own directories can never put
 * a module on the import path ahead of the standard library. The bridge puts
 * genaebot's `workspace/lib` on the path itself.
 */
async function readLocal<T>(args: string[]): Promise<T> {
  // Checked up front: python3 exists, so spawning it against a missing script
  // succeeds and python reports the problem as exit 2, which reads far worse
  // than saying which path we looked at.
  if (!existsSync(BRIDGE)) {
    throw new BotUnavailableError(
      `no read bridge at ${BRIDGE} — point GENAEBOT_CHECKOUT at a genaebot checkout that has workspace/bin/console-read`,
    );
  }

  let stdout: string;
  try {
    ({ stdout } = await run("python3", ["-I", BRIDGE, ...args], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
    }));
  } catch (error) {
    const err = error as Error & { stderr?: string; stdout?: string; code?: string };
    if (err.code === "ENOENT") {
      throw new BotUnavailableError("python3 is not on PATH");
    }
    throw new BotUnavailableError(
      reportedError(err.stdout) || err.stderr?.trim() || err.message,
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new BotUnavailableError(`bridge returned non-JSON: ${stdout.slice(0, 400)}`);
  }
  if (payload && typeof payload === "object" && "error" in payload) {
    throw new BotUnavailableError(String((payload as { error: unknown }).error));
  }
  return payload as T;
}

async function readRemote<T>(route: string, params: URLSearchParams): Promise<T> {
  const url = `${BOT_API_BASE_URL.replace(/\/$/, "")}/internal/console/${route}?${params}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (BOT_API_TOKEN) headers.authorization = `Bearer ${BOT_API_TOKEN}`;

  let response: Response;
  try {
    response = await fetch(url, { headers, cache: "no-store" });
  } catch (error) {
    throw new BotUnavailableError((error as Error).message);
  }
  if (!response.ok) {
    throw new BotUnavailableError(`${route} returned ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Why a shape check stands between the adapters and the screens.
 *
 * Both adapters end in a bare cast, so a bridge older than the payload these
 * screens expect goes straight through. The damage is not a blank page: a
 * missing `enabled` reads as `undefined`, which is falsy, which every screen
 * understands as "switched off". A console one commit behind therefore reports
 * all ten campaigns dead and an empty schedule, confidently and without error.
 * An inverted answer is worse than no answer, so a payload that cannot support
 * the screens is refused here and surfaces as the BotError card instead.
 */
function staleBridge(missing: string): never {
  const remedy =
    BOT_SOURCE === "remote"
      ? `the console API at ${BOT_API_BASE_URL} is serving an older read bridge — redeploy the gateway`
      : `the read bridge at ${BRIDGE} is older than this console expects — git -C ${GENAEBOT_CHECKOUT} pull --ff-only`;
  throw new BotUnavailableError(`${missing}; ${remedy}`);
}

function requireCampaigns(campaigns: unknown, where: string) {
  if (!Array.isArray(campaigns)) staleBridge(`${where} carried no campaigns array`);
  for (const campaign of campaigns) {
    if (typeof campaign?.enabled !== "boolean") {
      staleBridge(`${where} omits enabled on campaign ${campaign?.slug ?? "?"}`);
    }
  }
}

/** Only the fields a screen would silently misread are checked. Everything
 *  else fails visibly on its own. Exported so the contract can be tested
 *  without standing up either adapter. */
export function checkShape(route: string, payload: unknown): void {
  const body = payload as Record<string, unknown>;
  if (route === "overview") return requireCampaigns(body?.campaigns, "overview");
  if (route === "campaigns") return requireCampaigns(body?.campaigns, "campaigns");
  if (route === "groups") {
    if (!Array.isArray(body?.disabledPromos)) {
      staleBridge("groups omits disabledPromos");
    }
    return;
  }
  if (route.startsWith("preview/") && typeof body?.enabled !== "boolean") {
    staleBridge(`${route} omits enabled`);
  }
}

function query(date?: string) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  return params;
}

function localArgs(command: string, date?: string, slug?: string) {
  const args = [command];
  if (slug) args.push(slug);
  if (date) args.push("--date", date);
  return args;
}

async function read<T>(command: string, date?: string, slug?: string): Promise<T> {
  const route = slug ? `${command}/${slug}` : command;
  const payload =
    BOT_SOURCE === "remote"
      ? await readRemote<T>(route, query(date))
      : await readLocal<T>(localArgs(command, date, slug));
  // One gate for both adapters, so neither can serve a shape the other would
  // have been refused for.
  checkShape(route, payload);
  return payload;
}

export function getOverview(date?: string) {
  return read<Overview>("overview", date);
}

/** The whole payload, not just the rows. `disabledPromos` is what lets a screen
 *  say WHY a configured campaign is not posting today, instead of implying the
 *  daily cap held it back. */
export async function getGroups(date?: string) {
  return read<GroupsPayload>("groups", date);
}

export async function getCampaigns(date?: string) {
  const payload = await read<{ date: string; campaigns: Campaign[] }>("campaigns", date);
  return payload.campaigns;
}

export function getCampaignPreview(slug: string, date?: string) {
  return read<CampaignPreview>("preview", date, slug);
}
