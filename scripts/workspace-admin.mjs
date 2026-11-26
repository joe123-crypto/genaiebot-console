// Register workspaces and connect their bots. Run with the console's server
// credentials, for example:
//
//   node --env-file=.env.local scripts/workspace-admin.mjs create --email you@example.com
//   node --env-file=.env.local scripts/workspace-admin.mjs token --workspace <id> | railway variable set CONSOLE_API_TOKEN --stdin --skip-deploys
//   node --env-file=.env.local scripts/workspace-admin.mjs connect-bot --workspace <id> --url https://<bot origin>
//   node --env-file=.env.local scripts/workspace-admin.mjs show --email you@example.com
//   node --env-file=.env.local scripts/workspace-admin.mjs link --email you@example.com --workspace <id>
//   node --env-file=.env.local scripts/workspace-admin.mjs sweep-bots [--write]
//
// The registry is consoleUsers/{uid} -> workspaces/{id}. Not `users`: this
// Firebase project and its uids are shared with agent_genaie, whose profiles
// live in a root `users/{uid}`. `link` points a user at a workspace they
// already own, and removes a `users/{uid}` pointer an earlier version of this
// script wrote there, when that document holds nothing but that pointer.
//
// `create` is how an existing install keeps its data: run it before the console
// version with workspaces is deployed, so the owner's first request finds this
// workspace instead of creating an empty one. Anyone else gets a workspace on
// first sign-in, from the console itself.
//
// `token` prints the bearer the workspace's bot must hold as CONSOLE_API_TOKEN.
// It is derived from BOT_TOKEN_SECRET, exactly as src/lib/workspace.ts derives
// it, so nothing secret is stored in the registry.
//
// `connect-bot` saves the bot's address only after asking the bot itself: it
// must accept the derived token and report this workspace as its own
// (GENAIE_WORKSPACE_ID). A bot that answers for another workspace, or none, is
// refused, so the registry can never point a user at someone else's data.
//
// `sweep-bots` finds bots the console created whose account is gone: a Railway
// service named `bot-<workspace id>` with no `workspaces/{id}` behind it. Since
// account deletion removes the bot itself, these are what an older console
// version left behind, or a teardown that failed and was never asked again. It
// is a dry run unless given `--write`, and then deletes each orphan's service,
// its volume, its pictures under `w/<id>/` and anything the still-running bot
// wrote back under `workspaces/{id}` -- in that order, for the same reasons
// src/lib/account-deletion.ts gives. It needs BOT_RAILWAY_API_TOKEN,
// BOT_RAILWAY_PROJECT_ID and BOT_RAILWAY_ENVIRONMENT_ID; BOT_TEMPLATE_SERVICE_ID
// is never touched; R2_* is optional and without it pictures are not looked at.
import { createHmac, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";

export const WORKSPACE_ID = /^[A-Za-z0-9_-]{6,40}$/;
export const USERS_COLLECTION = "consoleUsers";
// What an earlier version of `create` wrote into agent_genaie's `users`.
const STRAY_POINTER_FIELDS = new Set(["email", "workspaceId", "createdAt"]);

/** Whether a `users/{uid}` document is only that stray pointer, nothing more. */
export function isStrayPointer(data, workspaceId) {
  return !!data && data.workspaceId === workspaceId && Object.keys(data).every((key) => STRAY_POINTER_FIELDS.has(key));
}

export function deriveBotToken(workspaceId, secret = process.env.BOT_TOKEN_SECRET?.trim()) {
  if (!WORKSPACE_ID.test(workspaceId ?? "")) throw new Error("the workspace id is invalid");
  if (!secret || secret.length < 32) throw new Error("BOT_TOKEN_SECRET must be set (at least 32 characters)");
  return createHmac("sha256", secret).update(`genaie-bot:${workspaceId}`).digest("base64url");
}

export function newWorkspaceId() {
  return `w${randomBytes(12).toString("base64url")}`;
}

export function botOrigin(value) {
  const url = new URL(value);
  const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password || url.search || url.hash ||
      (url.pathname !== "/" && url.pathname !== "")) throw new Error(`${value} is not a bare https origin`);
  return url.origin;
}

/**
 * Ask the bot which workspace it serves, with the token it should hold.
 * @param {string} origin
 * @param {string} workspaceId
 * @param {{ fetchImpl?: (url: string, init: { headers: Record<string, string>, signal?: AbortSignal }) => Promise<Response>, secret?: string }} [options]
 */
export async function checkBot(origin, workspaceId, { fetchImpl = fetch, secret } = {}) {
  const token = deriveBotToken(workspaceId, secret);
  let response;
  try {
    response = await fetchImpl(`${origin}/internal/console/capabilities`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000),
    });
  } catch (error) { throw new Error(`could not reach ${origin}: ${error.message}`); }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${origin} refused this workspace's token: set its CONSOLE_API_TOKEN from \`token --workspace ${workspaceId}\``);
  }
  if (!response.ok) throw new Error(`${origin} answered ${response.status} to capabilities`);
  const body = await response.json();
  const reported = body?.writes?.workspace;
  if (reported !== workspaceId) {
    throw new Error(`${origin} serves ${reported ? `workspace ${reported}` : "no workspace"}, not ${workspaceId}: set its GENAIE_WORKSPACE_ID=${workspaceId} and redeploy it first`);
  }
  return body.writes;
}

/** Switches that take no value. Everything else is `--name value`. */
const FLAGS = new Set(["write"]);

function argsOf(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let i = 0; i < rest.length; i += 1) {
    const name = rest[i]?.startsWith("--") ? rest[i].slice(2) : null;
    if (name && FLAGS.has(name)) { options[name] = true; continue; }
    if (!name || rest[i + 1] === undefined) throw new Error(`unexpected argument ${rest[i] ?? ""}`);
    options[name] = rest[i + 1];
    i += 1;
  }
  return { command, options };
}

async function admin() {
  const { applicationDefault, cert, initializeApp } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error("FIREBASE_PROJECT_ID is not set");
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const app = initializeApp({ projectId, credential: clientEmail && privateKey
    ? cert({ projectId, clientEmail, privateKey }) : applicationDefault() }, "genaie-workspace-admin");
  return { auth: getAuth(app), db: getFirestore(app), FieldValue };
}

async function create({ email, name }) {
  if (!email) throw new Error("create needs --email");
  const { auth, db, FieldValue } = await admin();
  const user = await auth.getUserByEmail(email);
  const id = newWorkspaceId();
  await db.runTransaction(async (transaction) => {
    const userRef = db.collection(USERS_COLLECTION).doc(user.uid);
    const existing = await transaction.get(userRef);
    if (existing.exists) {
      throw new Error(`${email} already has workspace ${existing.get("workspaceId")}; not creating another`);
    }
    transaction.create(db.collection("workspaces").doc(id), {
      name: (name || `${user.displayName || email}'s workspace`).slice(0, 120), ownerUid: user.uid,
      createdAt: FieldValue.serverTimestamp(), bot: null,
    });
    transaction.create(userRef, { email, workspaceId: id, createdAt: FieldValue.serverTimestamp() });
  });
  return `created workspace ${id} for ${email} (uid ${user.uid})`;
}

async function connectBot({ workspace, url }) {
  if (!workspace || !url) throw new Error("connect-bot needs --workspace and --url");
  const origin = botOrigin(url);
  const writes = await checkBot(origin, workspace);
  const { db } = await admin();
  const ref = db.collection("workspaces").doc(workspace);
  const snapshot = await ref.get();
  if (!snapshot.exists) throw new Error(`no workspace ${workspace}`);
  await ref.update({ bot: { baseUrl: origin } });
  const prefix = writes?.campaignCreation?.keyPrefix;
  return `connected ${origin} to workspace ${workspace} (pictures under ${prefix ?? "an unreported prefix"}). ` +
    "The console picks it up within 30 seconds.";
}

async function show({ email }) {
  if (!email) throw new Error("show needs --email");
  const { auth, db } = await admin();
  const user = await auth.getUserByEmail(email);
  const pointer = await db.collection(USERS_COLLECTION).doc(user.uid).get();
  if (!pointer.exists) return `${email} (uid ${user.uid}) has no workspace yet`;
  const workspace = await db.collection("workspaces").doc(pointer.get("workspaceId")).get();
  const data = workspace.data() ?? {};
  return JSON.stringify({ uid: user.uid, workspace: workspace.id, name: data.name, ownerUid: data.ownerUid,
                          bot: data.bot ?? null }, null, 2);
}

async function link({ email, workspace }) {
  if (!email || !workspace) throw new Error("link needs --email and --workspace");
  if (!WORKSPACE_ID.test(workspace)) throw new Error("the workspace id is invalid");
  const { auth, db, FieldValue } = await admin();
  const user = await auth.getUserByEmail(email);
  const notes = [];
  await db.runTransaction(async (transaction) => {
    const workspaceRef = db.collection("workspaces").doc(workspace);
    const pointerRef = db.collection(USERS_COLLECTION).doc(user.uid);
    const strayRef = db.collection("users").doc(user.uid);
    const [owned, pointer, stray] = await Promise.all([
      transaction.get(workspaceRef), transaction.get(pointerRef), transaction.get(strayRef)]);
    if (!owned.exists) throw new Error(`no workspace ${workspace}`);
    if (owned.get("ownerUid") !== user.uid) throw new Error(`workspace ${workspace} is not owned by ${email}`);
    if (pointer.exists && pointer.get("workspaceId") !== workspace) {
      throw new Error(`${email} already points at workspace ${pointer.get("workspaceId")}; not changing it`);
    }
    if (!pointer.exists) {
      transaction.create(pointerRef, { email, workspaceId: workspace, createdAt: FieldValue.serverTimestamp() });
      notes.push(`pointed ${email} at workspace ${workspace}`);
    } else notes.push(`${email} already points at workspace ${workspace}`);
    if (isStrayPointer(stray.data(), workspace)) {
      transaction.delete(strayRef);
      notes.push(`removed the stray users/${user.uid} pointer`);
    } else if (stray.exists) {
      notes.push(`left users/${user.uid} alone: it holds another app's data`);
    }
  });
  return notes.join("\n");
}

/** The provisioner's name for a workspace's bot, and nothing else's. */
const BOT_SERVICE = /^bot-([A-Za-z0-9_-]{6,40})$/;

/**
 * Which services are console-built bots whose workspace is gone, and the
 * volumes on each. Pure, so the rules that decide what may be deleted can be
 * tested without Railway: a name the provisioner gives, never the template,
 * and only when the registry has no such workspace. Volumes are matched while
 * still mounted, because once the service goes nothing says whose they were;
 * a detached one is only reported, for the same reason.
 *
 * @param {{ services: {id: string, name: string}[], volumes: {volumeId: string, name: string, serviceId: string | null, pendingDeletion: boolean}[], existing: Set<string>, templateServiceId?: string }} inventory
 */
export function sweepPlan({ services, volumes, existing, templateServiceId }) {
  const orphans = [];
  for (const service of services) {
    const workspaceId = BOT_SERVICE.exec(service.name)?.[1];
    if (!workspaceId || service.id === templateServiceId || existing.has(workspaceId)) continue;
    orphans.push({
      workspaceId, service,
      volumes: volumes.filter((volume) => volume.serviceId === service.id && !volume.pendingDeletion).map((volume) => volume.volumeId),
    });
  }
  const detached = volumes.filter((volume) => volume.serviceId === null && !volume.pendingDeletion && volume.name.startsWith("bot-"));
  return { orphans, detached };
}

function railwaySettings() {
  const read = (name) => process.env[name]?.trim() || "";
  const settings = {
    token: read("BOT_RAILWAY_API_TOKEN"), projectId: read("BOT_RAILWAY_PROJECT_ID"),
    environmentId: read("BOT_RAILWAY_ENVIRONMENT_ID"), templateServiceId: read("BOT_TEMPLATE_SERVICE_ID") || undefined,
  };
  if (!settings.token || !settings.projectId || !settings.environmentId) {
    throw new Error("sweep-bots needs BOT_RAILWAY_API_TOKEN, BOT_RAILWAY_PROJECT_ID and BOT_RAILWAY_ENVIRONMENT_ID");
  }
  return settings;
}

async function railway(settings, document, variables) {
  const response = await fetch("https://backboard.railway.com/graphql/v2", {
    method: "POST", signal: AbortSignal.timeout(20_000),
    headers: { "content-type": "application/json", authorization: `Bearer ${settings.token}` },
    body: JSON.stringify({ query: document, variables }),
  });
  const body = await response.json().catch(() => null);
  // Railway's messages only: an error can quote the request, which holds the token.
  const errors = Array.isArray(body?.errors) ? body.errors.map((error) => error?.message).filter(Boolean).join("; ") : "";
  if (!response.ok || errors || !body?.data) throw new Error(`Railway refused: ${errors || response.status}`);
  return body.data;
}

async function railwayInventory(settings) {
  const project = await railway(settings, `query($projectId: String!) {
    project(id: $projectId) { services { edges { node { id name } } } } }`, { projectId: settings.projectId });
  const environment = await railway(settings, `query($environmentId: String!) {
    environment(id: $environmentId) { volumeInstances { edges { node { volumeId serviceId isPendingDeletion volume { name } } } } } }`,
  { environmentId: settings.environmentId });
  const services = project.project.services.edges.map(({ node }) => {
    if (typeof node?.id !== "string" || typeof node?.name !== "string") throw new Error("Railway listed a service this script cannot read");
    return { id: node.id, name: node.name };
  });
  const volumes = environment.environment.volumeInstances.edges.map(({ node }) => {
    if (typeof node?.volumeId !== "string" || typeof node?.isPendingDeletion !== "boolean") {
      throw new Error("Railway listed a volume this script cannot read");
    }
    return { volumeId: node.volumeId, name: node.volume?.name ?? "", serviceId: node.serviceId ?? null, pendingDeletion: node.isPendingDeletion };
  });
  return { services, volumes };
}

async function bucket() {
  const names = ["R2_ACCOUNT_ID", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"];
  if (!names.every((name) => process.env[name]?.trim())) return null;
  const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const client = new S3Client({
    forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    region: "auto", endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });
  const Bucket = process.env.R2_BUCKET;
  return {
    /** Every key under the workspace's own prefix, and only there. */
    async keys(workspaceId) {
      if (!WORKSPACE_ID.test(workspaceId)) throw new Error("the workspace id is invalid");
      const prefix = `w/${workspaceId}/`;
      const keys = [];
      let token;
      do {
        const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        for (const object of page.Contents ?? []) if (object.Key?.startsWith(prefix)) keys.push(object.Key);
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async remove(key) { await client.send(new DeleteObjectCommand({ Bucket, Key: key })); },
  };
}

async function sweepBots({ write }) {
  const settings = railwaySettings();
  const { db } = await admin();
  const inventory = await railwayInventory(settings);
  const existing = new Set();
  for (const service of inventory.services) {
    const workspaceId = BOT_SERVICE.exec(service.name)?.[1];
    if (workspaceId && (await db.collection("workspaces").doc(workspaceId).get()).exists) existing.add(workspaceId);
  }
  const plan = sweepPlan({ ...inventory, existing, templateServiceId: settings.templateServiceId });
  const pictures = await bucket();
  const lines = [write ? "Deleting what is listed." : "Dry run: nothing was deleted. Run again with --write to delete what is listed."];
  if (!plan.orphans.length) lines.push("No orphaned bots: every bot-<id> service has its workspace.");
  for (const orphan of plan.orphans) {
    const tree = db.collection("workspaces").doc(orphan.workspaceId);
    const leftovers = (await tree.listCollections()).map((collection) => collection.id);
    const keys = pictures ? await pictures.keys(orphan.workspaceId) : null;
    lines.push(`orphan ${orphan.service.name} (service ${orphan.service.id}): workspaces/${orphan.workspaceId} does not exist`,
      `  volumes: ${orphan.volumes.join(", ") || "none mounted"}`,
      `  pictures under w/${orphan.workspaceId}/: ${keys ? keys.length : "not checked (R2_* unset)"}`,
      `  written back under workspaces/${orphan.workspaceId}: ${leftovers.join(", ") || "nothing"}`);
    if (!write) continue;
    // The service first, so the bot stops writing; the volumes it had, which
    // were read while still mounted; then what it left in R2 and Firestore.
    await railway(settings, `mutation($id: String!, $environmentId: String) { serviceDelete(id: $id, environmentId: $environmentId) }`,
      { id: orphan.service.id, environmentId: settings.environmentId });
    for (const volumeId of orphan.volumes) {
      await railway(settings, `mutation($volumeId: String!) { volumeDelete(volumeId: $volumeId) }`, { volumeId });
    }
    for (const key of keys ?? []) await pictures.remove(key);
    await db.recursiveDelete(tree);
    lines.push(`  deleted: the service, ${orphan.volumes.length} volume(s) (Railway erases them after a few days), ` +
      `${keys?.length ?? 0} picture(s), and workspaces/${orphan.workspaceId}`);
  }
  for (const volume of plan.detached) {
    lines.push(`detached volume ${volume.name} (${volume.volumeId}) is mounted on nothing. Not deleted: nothing says ` +
      "whose it was. See docs/provision-bot.md for the one call that deletes it.");
  }
  return lines.join("\n");
}

export async function main(argv) {
  const { command, options } = argsOf(argv);
  if (command === "create") return create(options);
  if (command === "token") return deriveBotToken(options.workspace);
  if (command === "connect-bot") return connectBot(options);
  if (command === "show") return show(options);
  if (command === "link") return link(options);
  if (command === "sweep-bots") return sweepBots(options);
  throw new Error("usage: workspace-admin.mjs create|token|connect-bot|show|link|sweep-bots (see the top of this file)");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (output) => { process.stdout.write(`${output}\n`); },
    (error) => { process.stderr.write(`workspace-admin: ${error.message}\n`); process.exitCode = 1; },
  );
}
