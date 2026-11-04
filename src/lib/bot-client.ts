import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import {
  BOT_API_BASE_URL,
  BOT_API_TOKEN,
  BOT_SOURCE,
  GENAEBOT_CHECKOUT,
} from "@/src/config";
import type { Campaign, CampaignPreview, Group, Overview } from "@/src/lib/types";

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

const BRIDGE = path.join(process.cwd(), "scripts", "genaebot_read.py");

/**
 * `-I` runs Python in isolated mode so the bot's own directories can never put
 * a module on the import path ahead of the standard library.
 */
async function readLocal<T>(args: string[]): Promise<T> {
  let stdout: string;
  try {
    ({ stdout } = await run(
      "python3",
      ["-I", BRIDGE, "--checkout", GENAEBOT_CHECKOUT, ...args],
      { maxBuffer: 32 * 1024 * 1024, timeout: 120_000 },
    ));
  } catch (error) {
    const err = error as Error & { stderr?: string };
    throw new BotUnavailableError(err.stderr?.trim() || err.message);
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
  return BOT_SOURCE === "remote"
    ? readRemote<T>(route, query(date))
    : readLocal<T>(localArgs(command, date, slug));
}

export function getOverview(date?: string) {
  return read<Overview>("overview", date);
}

export async function getGroups(date?: string) {
  const payload = await read<{ date: string; groups: Group[] }>("groups", date);
  return payload.groups;
}

export async function getCampaigns(date?: string) {
  const payload = await read<{ date: string; campaigns: Campaign[] }>("campaigns", date);
  return payload.campaigns;
}

export function getCampaignPreview(slug: string, date?: string) {
  return read<CampaignPreview>("preview", date, slug);
}
