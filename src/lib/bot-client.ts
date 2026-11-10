import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  BOT_API_BASE_URL,
  BOT_API_TOKEN,
  BOT_SOURCE,
  BOT_WRITE_API_BASE_URL,
  BOT_WRITE_TOKEN,
  GENAEBOT_CHECKOUT,
  WRITE_SOURCE,
  WRITES_ENABLED,
} from "@/src/config";
import type {
  AdAssets,
  Campaign,
  CampaignDeletion,
  CampaignPreview,
  GroupsPayload,
  Overview,
  WriteCapabilities,
  WriteResult,
} from "@/src/lib/types";
import { canWrite } from "@/src/lib/write-capabilities";
import { isScheduleSaveResult } from "@/src/domains/schedule";
import { deduplicateRead, invalidateRemoteReads, withReadSlot } from "@/src/lib/remote-read";
import { botErrorMetadata, type BotErrorMetadata } from "@/src/lib/bot-error-metadata";

const run = promisify(execFile);

/**
 * The console reads operator state from exactly one of two places: a local
 * genaebot checkout (development) or the console API beside the gateway
 * (production). Both return the same shapes, produced by the same Python
 * helpers, so a screen cannot behave differently depending on which is in use.
 */

export class BotUnavailableError extends Error {
  readonly detail: string;
  readonly status?: number;
  readonly metadata: BotErrorMetadata;
  constructor(detail: string, status?: number, metadata: BotErrorMetadata = {}) {
    super("Could not reach the bot's state.");
    this.name = "BotUnavailableError";
    this.detail = detail;
    this.status = status;
    this.metadata = botErrorMetadata(metadata);
  }
}

/**
 * The read bridge lives in genaebot rather than here, so this adapter and the
 * console API run the very same script and cannot drift apart.
 */
const BRIDGE = path.join(GENAEBOT_CHECKOUT, "workspace", "bin", "console-read");

/**
 * Writes go through a different script: `console-write`, which judges every
 * change with the bot's own validator. Remotely it is the same console API as
 * the reads, on its one POST route, `config/<collection>/<id>`.
 */
const WRITE_BRIDGE = path.join(GENAEBOT_CHECKOUT, "workspace", "bin", "console-write");

/**
 * Group actions go through a third bridge, `console-group-action`. It holds no
 * Firestore credential at all: it queues a leave for the account's own channel
 * monitor, which owns the only socket that can perform one, and edits the
 * per-campaign state files on the volume.
 */
const ACTION_BRIDGE = path.join(GENAEBOT_CHECKOUT, "workspace", "bin",
                                "console-group-action");

/**
 * Why captions cannot be saved, or undefined when they can. The bot decides:
 * caption overrides need a companion bot update, and until it adds `captions` to
 * the writer's editable fields, `writes` says so and the editor stays a draft
 * rather than failing on save.
 */
export function captionSaveUnavailableReason(
  writes: WriteCapabilities | undefined,
): string | undefined {
  if (WRITES_ENABLED && WRITE_SOURCE === "local" && !existsSync(WRITE_BRIDGE)) {
    return "Saving is not connected to the bot yet. You can edit a draft here.";
  }
  const gate = canWrite(WRITES_ENABLED, writes, "campaigns", "captions");
  return gate.allowed ? undefined : `${gate.reason} You can edit a draft here.`;
}

/**
 * Captions live in the bot's own campaign document, which is why they can be
 * saved. A campaign's pictures do not: the bot still reads which pictures a
 * campaign has from the `IMAGE` / `IMAGE_PATH` constants in its `post_ad.py`,
 * and the write bridge's editable fields do not include them. The gallery
 * therefore shows its controls and says plainly why they are off, rather than
 * offering a draft that could never be committed.
 *
 * Only the write half is still blocked. The bot now reports where each
 * picture's bytes are, which is what lets the tiles show them -- but changing
 * the set a campaign rotates is still a change to a Python constant.
 */
export function imageWritesUnavailableReason(): string {
  return "Picture changes need the companion bot update — the bot still reads each campaign\u2019s picture from its post_ad.py, not from the record the console can write.";
}

/**
 * The bot refused a config change and said why. Unlike "could not reach the
 * bot", the change definitely did not happen, and `problems` carries the bot's
 * own reasons -- for a group, the validator's words about what the change would
 * have broken. A subclass of BotUnavailableError so every existing catch still
 * shows `detail`; a screen that can show the reasons checks for this one.
 */
export class WriteRefusedError extends BotUnavailableError {
  readonly problems: string[];
  readonly status: number;
  constructor(detail: string, problems: string[], status: number, metadata: BotErrorMetadata = {}) {
    super(detail, status, metadata);
    this.name = "WriteRefusedError";
    this.problems = problems;
    this.status = status;
  }
}

/** console-write's refusal: `{"ok": false, "status", "error", "problems"}`. A read
 *  bridge's error has no `ok`, so this never mistakes one for the other. */
function refusalFrom(text: string | undefined): WriteRefusedError | null {
  if (!text) return null;
  try {
    const payload: unknown = JSON.parse(text);
    if (!payload || typeof payload !== "object") return null;
    const body = payload as { ok?: unknown; status?: unknown; error?: unknown; problems?: unknown };
    if (body.ok !== false || typeof body.error !== "string") return null;
    const problems = Array.isArray(body.problems)
      ? body.problems.filter((p): p is string => typeof p === "string")
      : [];
    return new WriteRefusedError(body.error, problems,
      typeof body.status === "number" ? body.status : 400, botErrorMetadata(payload));
  } catch {
    return null;
  }
}

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

function reportedUnavailable(stdout: string | undefined): BotUnavailableError | null {
  const detail = reportedError(stdout);
  if (!detail || !stdout) return null;
  return new BotUnavailableError(detail, undefined, botErrorMetadata(JSON.parse(stdout)));
}

/**
 * `-I` runs Python in isolated mode so the bot's own directories can never put
 * a module on the import path ahead of the standard library. The bridge puts
 * genaebot's `workspace/lib` on the path itself.
 */
async function runBridge<T>(bridge: string, args: string[], input?: unknown): Promise<T> {
  // Checked up front: python3 exists, so spawning it against a missing script
  // succeeds and python reports the problem as exit 2, which reads far worse
  // than saying which path we looked at.
  if (!existsSync(bridge)) {
    throw new BotUnavailableError(
      `no bridge at ${bridge} — point GENAEBOT_CHECKOUT at a genaebot checkout that has ${path.basename(bridge)}`,
    );
  }

  let stdout: string;
  try {
    const child = run("python3", ["-I", bridge, ...args], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
    });
    if (input !== undefined) {
      // console-write accepts one JSON request on stdin; copy never enters a shell.
      child.child.stdin?.end(JSON.stringify(input));
    }
    ({ stdout } = await child);
  } catch (error) {
    const err = error as Error & { stderr?: string; stdout?: string; code?: string; killed?: boolean };
    if (err.code === "ENOENT") {
      throw new BotUnavailableError("python3 is not on PATH");
    }
    if (input !== undefined && err.killed) {
      throw new BotUnavailableError("The write bridge did not answer within 120s — the change may still have been made. Refresh before retrying.");
    }
    throw refusalFrom(err.stdout) ?? reportedUnavailable(err.stdout) ?? new BotUnavailableError(
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

function readLocal<T>(args: string[]): Promise<T> {
  return runBridge<T>(BRIDGE, args);
}

async function readRemote<T>(route: string, params: URLSearchParams): Promise<T> {
  const url = `${BOT_API_BASE_URL.replace(/\/$/, "")}/internal/console/${route}?${params}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (BOT_API_TOKEN) headers.authorization = `Bearer ${BOT_API_TOKEN}`;

  // The authentication context stays in server memory and prevents reuse of
  // a result fetched with different credentials.
  return deduplicateRead(JSON.stringify([url, BOT_API_TOKEN]), async () => {
    for (let attempt = 0; ; attempt++) {
      const result = await withReadSlot(async () => {
        let response: Response;
        try {
          response = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(15_000) });
        } catch {
          throw new BotUnavailableError(`Could not reach ${route}. The connection failed or timed out.`);
        }
        if (response.ok) {
          try {
            return { ok: true as const, data: await response.json() as T };
          } catch {
            throw new BotUnavailableError(`${route} returned invalid JSON`, response.status);
          }
        }
        let message = "";
        let metadata: BotErrorMetadata = {};
        try {
          const body: unknown = await response.json();
          metadata = botErrorMetadata(body);
          if (body && typeof body === "object" && "error" in body &&
              typeof body.error === "string" && !/[<>]/.test(body.error)) {
            message = body.error.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 400);
          }
        } catch { /* Proxy HTML and other uncurated bodies are never displayed. */ }
        const error = new BotUnavailableError(
          `${route} returned ${response.status}${message ? `: ${message}` : ""}`, response.status, metadata,
        );
        if (response.status !== 503 || metadata.code === "config_rate_limited" || attempt >= 2) throw error;
        const retryAfter = response.headers.get("retry-after");
        const seconds = retryAfter === null ? NaN : Number(retryAfter);
        const requested = Number.isFinite(seconds) ? seconds * 1000
          : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
        return { ok: false as const, delay: Number.isFinite(requested)
          ? Math.max(0, Math.min(5_000, requested)) : 1000 * (attempt + 1) };
      });
      if (result.ok) return result.data;
      // Sleeping requests hold no slot, so other reads can make progress.
      await new Promise((resolve) => setTimeout(resolve, result.delay));
    }
  });
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
  if ((route.startsWith("campaign/") || route.startsWith("campaign-state/")) && body?.campaign !== null) {
    requireCampaigns([body?.campaign], route);
  }
  if (route.startsWith("campaign-groups/") || route.startsWith("group/") || route.startsWith("groups-by-id/")) {
    if (!Array.isArray(body?.groups) || !Array.isArray(body?.disabledPromos)) staleBridge(`${route} omits groups`);
  }
  if ((route.startsWith("preview/") || route.startsWith("captions/")) && typeof body?.enabled !== "boolean") {
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

async function read<T>(command: string, date?: string, slug?: string, fresh = false): Promise<T> {
  const route = slug ? `${command}/${encodeURIComponent(slug)}` : command;
  const params = query(date);
  const args = localArgs(command, date, slug);
  if (fresh) {
    params.set("fresh", "1");
    args.push("--fresh-config");
  }
  const payload =
    BOT_SOURCE === "remote"
      ? await readRemote<T>(route, params)
      : await readLocal<T>(args);
  // One gate for both adapters, so neither can serve a shape the other would
  // have been refused for.
  checkShape(route, payload);
  return payload;
}

type ReadOptions = { fresh?: boolean };

function unsupportedRead(error: unknown): boolean {
  return error instanceof BotUnavailableError && (error.status === 404 ||
    (BOT_SOURCE === "local" && error.detail.includes("command must be one of")));
}

export type ConfigurationPayload = Pick<Overview, "capSettings" | "accounts" | "writes">;
export async function getConfiguration({ fresh = false }: ReadOptions = {}): Promise<ConfigurationPayload> {
  try { return await read<ConfigurationPayload>("settings", undefined, undefined, fresh); }
  catch (error) { if (!unsupportedRead(error)) throw error; return getOverview(undefined, { fresh }); }
}

export async function getCapabilities(): Promise<WriteCapabilities | undefined> {
  try { return (await read<{ writes?: WriteCapabilities }>("capabilities")).writes; }
  catch (error) { if (!unsupportedRead(error)) throw error; return (await getOverview()).writes; }
}

export type NavigationPayload = { campaignTotal: number; groupsNeedingReview: number };
export async function getNavigation(): Promise<NavigationPayload> {
  try { return await read<NavigationPayload>("navigation"); }
  catch (error) {
    if (!unsupportedRead(error)) throw error;
    const overview = await getOverview();
    return { campaignTotal: overview.campaignTotal,
      groupsNeedingReview: Math.max(0, overview.groupTotal - (overview.groupsByStatus.active ?? 0)) };
  }
}

export function getOverview(date?: string, { fresh = false }: ReadOptions = {}) {
  return read<Overview>("overview", date, undefined, fresh);
}

/** The whole payload, not just the rows. `disabledPromos` is what lets a screen
 *  say WHY a configured campaign is not posting today, instead of implying the
 *  daily cap held it back. */
export async function getGroups(date?: string, { fresh = false, campaign, jid, jids }: ReadOptions & { campaign?: string; jid?: string; jids?: string[] } = {}) {
  if (jids?.length === 0) return { date: date ?? "", groups: [], disabledPromos: [] } satisfies GroupsPayload;
  try {
    return await read<GroupsPayload>(jids ? "groups-by-id" : jid ? "group" : campaign ? "campaign-groups" : "groups", date, jids?.join(",") ?? jid ?? campaign, fresh);
  } catch (error) {
    if ((!jid && !campaign && !jids) || !unsupportedRead(error)) throw error;
    const result = await read<GroupsPayload>("groups", date, undefined, fresh);
    return { ...result, groups: result.groups.filter((group) => jids ? jids.includes(group.jid) : jid ? group.jid === jid :
      group.promos.includes(campaign!) || campaign! in group.weekly) };
  }
}

export async function getCampaignPayload(slug: string, date?: string, { fresh = false }: ReadOptions = {}) {
  try { return await read<{ date: string; adAssets?: AdAssets; campaign: Campaign | null }>("campaign", date, slug, fresh); }
  catch (error) {
    if (!unsupportedRead(error)) throw error;
    const result = await getCampaignsPayload(date, { fresh });
    return { date: result.date, adAssets: result.adAssets, campaign: result.campaigns.find((entry) => entry.slug === slug) ?? null };
  }
}

export async function getCampaignState(slug: string, { fresh = false }: ReadOptions = {}): Promise<Pick<Campaign, "slug" | "enabled" | "storeEnabled" | "cronEnabled"> | null> {
  try { return (await read<{ campaign: Campaign | null }>("campaign-state", undefined, slug, fresh)).campaign; }
  catch (error) { if (!unsupportedRead(error)) throw error; return (await getCampaignPayload(slug, undefined, { fresh })).campaign; }
}

/** The whole campaigns payload. `adAssets` says where the pictures are stored
 *  and whether the bot could read its index, which is one fact about the bot
 *  rather than one per campaign -- so it rides here and not on each record. */
export async function getCampaignsPayload(date?: string, { fresh = false }: ReadOptions = {}) {
  return read<{ date: string; adAssets?: AdAssets; campaigns: Campaign[]; deletions?: CampaignDeletion[] }>("campaigns", date, undefined, fresh);
}

export async function getCampaigns(date?: string, options: ReadOptions = {}) {
  return (await getCampaignsPayload(date, options)).campaigns;
}

export async function getCampaignPreview(slug: string, date?: string, { fresh = false, captionsOnly = false }: ReadOptions & { captionsOnly?: boolean } = {}) {
  try { return await read<CampaignPreview>(captionsOnly ? "captions" : "preview", date, slug, fresh); }
  catch (error) {
    if (!captionsOnly || !unsupportedRead(error)) throw error;
    return read<CampaignPreview>("preview", date, slug, fresh);
  }
}

/* ------------------------------------------------------------------ writes --
 *
 * The console's first mutation. Three things are deliberate:
 *
 *   * it is gated on WRITES_ENABLED rather than on a session, because there is
 *     no session yet — see the note in `src/config`;
 *   * the remote call is bounded, unlike the reads above. A read that hangs
 *     costs a page; a delete that hangs leaves the operator unable to tell
 *     whether it happened;
 *   * a refusal keeps the bridge's own words. A failed read can say "groups
 *     returned 503" and the operator loses nothing, but "the group is not in
 *     the bot's records" and "the write service is busy" are different
 *     answers to "did my delete land?".
 */

const WRITE_TIMEOUT_MS = 30_000;

export async function deleteCampaign(slug: string, { by }: { by: string }): Promise<{ slug: string; cleanup: "pending" | "complete" }> {
  if (!WRITES_ENABLED) throw new WritesDisabledError();
  let result: { slug: string; cleanup: "pending" | "complete" };
  try {
    result = WRITE_SOURCE === "remote"
      ? await writeRemote<{ slug: string; cleanup: "pending" | "complete" }>(`campaigns/${encodeURIComponent(slug)}/delete`, { actor: by })
      : await runBridge<{ slug: string; cleanup: "pending" | "complete" }>(path.join(GENAEBOT_CHECKOUT, "workspace/bin/console-campaign-create"), [], { delete: slug, actor: by });
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof BotUnavailableError && error.detail.startsWith("bridge returned non-JSON"))) throw error;
    throw new BotUnavailableError("The bot returned an unreadable deletion result; the campaign may have been deleted. Refresh before retrying.");
  }
  if (!result || result.slug !== slug || !["pending", "complete"].includes(result.cleanup)) {
    throw new BotUnavailableError("The bot returned an unreadable deletion result; the campaign may have been deleted. Refresh before retrying.");
  }
  return result;
}

export class WritesDisabledError extends Error {
  readonly detail = "writes are switched off; set CONSOLE_WRITES=1 and a write target";
  constructor() {
    super("The console is in read-only mode.");
    this.name = "WritesDisabledError";
  }
}

async function writeRemote<T>(route: string, body: unknown): Promise<T> {
  const mutation = !(body && typeof body === "object" && "dryRun" in body && body.dryRun === true);
  if (mutation) invalidateRemoteReads();
  try { return await sendWriteRemote<T>(route, body); }
  finally { if (mutation) invalidateRemoteReads(); }
}

async function sendWriteRemote<T>(route: string, body: unknown): Promise<T> {
  const url = `${BOT_WRITE_API_BASE_URL.replace(/\/$/, "")}/internal/console/${route}`;
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (BOT_WRITE_TOKEN) headers.authorization = `Bearer ${BOT_WRITE_TOKEN}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(WRITE_TIMEOUT_MS),
    });
  } catch (error) {
    const err = error as Error;
    // A timeout is not a refusal: the write may well have landed, and saying
    // so is more use than reporting it as a failure.
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      throw new BotUnavailableError(
        `${route} did not answer within ${WRITE_TIMEOUT_MS / 1000}s — the change may still have been made`,
      );
    }
    throw new BotUnavailableError(err.message);
  }

  const text = await response.text();
  if (!response.ok) {
    throw refusalFrom(text) ?? new BotUnavailableError(
      reportedError(text) || `${route} returned ${response.status}`, response.status,
    );
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/** The collections the bot's writer knows. Anything else is a typo here, and is
 *  refused before a request is built rather than by the bot. */
export type ConfigCollection = "groups" | "lines" | "campaigns" | "settings";

/** One change: named fields, or a delete. Never both -- the bot refuses that. */
export type ConfigChange =
  | { fields: Record<string, unknown>; dryRun?: boolean }
  | { delete: true; reason?: string; dryRun?: boolean };

/**
 * Send one config change to the bot's writer, which validates it with the bot's
 * own rules and commits it together with its audit record. A refusal throws
 * WriteRefusedError carrying the bot's reasons; anything that leaves the outcome
 * unknown throws BotUnavailableError and says so.
 *
 * The id goes in the URL path percent-encoded (a group JID carries an "@") or
 * as one field of the JSON on the local bridge's stdin; neither form ever passes
 * through a shell.
 */
export async function writeConfig(
  collection: ConfigCollection,
  id: string,
  change: ConfigChange,
  { by }: { by: string },
): Promise<WriteResult> {
  if (!WRITES_ENABLED) throw new WritesDisabledError();
  const body = { ...change, actor: by };
  if (WRITE_SOURCE === "remote") {
    return writeRemote<WriteResult>(
      `config/${collection}/${encodeURIComponent(id)}`, body);
  }
  return runBridge<WriteResult>(WRITE_BRIDGE, [], { collection, id, ...body });
}

type WriteOptions = { by: string; dryRun?: boolean };

export type GroupBatchChange = { id: string; fields: Record<string, unknown>; expected?: Record<string, unknown> };
/** null means an older bot refused the unknown route before executing a write. */
export async function updateGroupBatch(changes: GroupBatchChange[], { by }: { by: string }): Promise<{ done: string[]; changed: number } | null> {
  if (!WRITES_ENABLED) throw new WritesDisabledError();
  try {
    const body = { changes, actor: by };
    return WRITE_SOURCE === "remote"
      ? await writeRemote("config/batch/groups", body)
      : await runBridge(WRITE_BRIDGE, [], { collection: "groups", ...body });
  } catch (error) {
    if (error instanceof BotUnavailableError && (error.status === 404 ||
      (WRITE_SOURCE === "local" && error instanceof WriteRefusedError && error.status === 400 &&
       error.detail === "request is missing id"))) return null;
    throw error;
  }
}

export function updateGroup(jid: string, fields: Record<string, unknown>,
                            { by, dryRun }: WriteOptions) {
  return writeConfig("groups", jid, { fields, ...(dryRun ? { dryRun } : {}) }, { by });
}

export function updateCampaign(slug: string, fields: Record<string, unknown>,
                               { by, dryRun }: WriteOptions) {
  return writeConfig("campaigns", slug, { fields, ...(dryRun ? { dryRun } : {}) }, { by });
}

export function updateLine(id: string, fields: Record<string, unknown>,
                           { by, dryRun }: WriteOptions) {
  return writeConfig("lines", id, { fields, ...(dryRun ? { dryRun } : {}) }, { by });
}

/** The cap settings and the contact line live in one document, `defaults`. */
export function updateSettings(fields: Record<string, unknown>,
                               { by, dryRun }: WriteOptions) {
  return writeConfig("settings", "defaults", { fields, ...(dryRun ? { dryRun } : {}) },
                     { by });
}

/**
 * Remove a group from the bot's records. The bot commits the whole record into
 * the audit trail in the same write, so a delete can be undone by hand from
 * there -- and while the bot is still in the WhatsApp group, discovery lists it
 * again as unconfigured.
 */
export function deleteGroup(
  jid: string,
  { by, reason, dryRun }: WriteOptions & { reason?: string },
): Promise<WriteResult> {
  return writeConfig("groups", jid, {
    delete: true,
    ...(reason ? { reason } : {}),
    ...(dryRun ? { dryRun } : {}),
  }, { by });
}

/**
 * What the bot did when asked to act on a group.
 *
 * `leave.ok` is deliberately three-valued. `null` means the request reached the
 * account's queue but no answer came back in time -- which is not failure: the
 * leave may well have landed, and reporting it as failed would have an operator
 * retry something that already happened.
 */
export type GroupActionResult = {
  jid: string;
  account: string;
  leave: { requested: boolean; ok?: boolean | null; already?: boolean; error?: string | null };
  cleared: { requested: boolean; campaigns?: Record<string, string[]>; checked?: number };
};

/**
 * Take the account's number out of a WhatsApp group, forget what the bot stored
 * about it, or both. At least one must be asked for.
 *
 * A separate route from `writeConfig` because neither of these writes Firestore:
 * the bot gates them on the gateway rather than on its write key. It still goes
 * to the write host with the write token, because it changes something.
 */
export async function groupAction(
  jid: string,
  { leave, clearRecords, account, by }: {
    leave: boolean;
    clearRecords: boolean;
    account?: string;
    by: string;
  },
): Promise<GroupActionResult> {
  if (!WRITES_ENABLED) throw new WritesDisabledError();
  const body = {
    ...(leave ? { leave: true } : {}),
    ...(clearRecords ? { clearRecords: true } : {}),
    ...(account ? { account } : {}),
    actor: by,
  };
  const route = `groups/${encodeURIComponent(jid)}/actions`;
  if (WRITE_SOURCE === "remote") return writeRemote<GroupActionResult>(route, body);
  return runBridge<GroupActionResult>(ACTION_BRIDGE, [], { jid, ...body });
}

/** Uses the bot's validated, audited config writer, rather than a console copy. */
export async function updateCampaignCaptions(
  slug: string,
  captions: string[],
  { by }: { by: string },
): Promise<void> {
  await writeConfig("campaigns", slug, { fields: { captions } }, { by });
}

/** Dedicated create operation: the bot commits assignments and audit atomically. */
export async function createCampaign(input: import("@/src/domains/campaign-create").NewCampaign): Promise<import("@/src/domains/campaign-create").CreateCampaignResult> {
  if (!WRITES_ENABLED) throw new WritesDisabledError();
  if (WRITE_SOURCE === "remote") return writeRemote("campaigns/create", { ...input, actor: (await import("@/src/config")).OPERATOR_NAME });
  return runBridge(path.join(GENAEBOT_CHECKOUT, "workspace/bin/console-campaign-create"), [], { ...input, actor: (await import("@/src/config")).OPERATOR_NAME });
}

export async function saveSchedule(input: import("@/src/lib/types").ScheduleRequest, { by }: { by: string }): Promise<import("@/src/lib/types").ScheduleSaveResult> {
  if (!WRITES_ENABLED) throw new WritesDisabledError();
  const unreadable = () => new BotUnavailableError("The bot returned an unreadable schedule result. Changes may have been saved; check the latest times before retrying.");
  let result: import("@/src/lib/types").ScheduleSaveResult;
  try {
    result = WRITE_SOURCE === "remote"
      ? await writeRemote("schedule", { ...input, actor: by })
      : await runBridge(path.join(GENAEBOT_CHECKOUT, "workspace/bin/console-schedule"), ["--apply"], { ...input, actor: by });
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof BotUnavailableError && error.detail.startsWith("bridge returned non-JSON"))) throw unreadable();
    throw error;
  }
  if (!isScheduleSaveResult(result, input)) throw unreadable();
  return result;
}

export async function saveScheduleEntries(input: import("@/src/lib/types").ScheduleEntriesRequest, { by }: { by: string }): Promise<import("@/src/lib/types").ScheduleEntriesResult> {
  if (!WRITES_ENABLED) throw new WritesDisabledError();
  const { isScheduleEntriesResult } = await import("@/src/domains/schedule-entries");
  const result = WRITE_SOURCE === "remote"
    ? await writeRemote("schedule", { ...input, actor: by })
    : await runBridge(path.join(GENAEBOT_CHECKOUT, "workspace/bin/console-schedule"), ["--apply"], { ...input, actor: by });
  if (!isScheduleEntriesResult(result, input)) throw new BotUnavailableError("The bot returned an unreadable schedule result. Retry the original request to check its receipt.");
  return result;
}
