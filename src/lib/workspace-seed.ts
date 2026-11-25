import "server-only";
import { BOT_SETTINGS_TEMPLATE } from "@/src/config";
import { SETTINGS_DOC, settingsSeed, settingsSeedProblems } from "@/src/domains/workspace-seed";
import { BotUnavailableError } from "./bot-errors";
import { firestoreAdmin } from "./firebase-admin";
import { WORKSPACE_ID, type Workspace } from "./workspace";

/**
 * Giving a new workspace the one config document its bot cannot start without.
 *
 * THIS IS THE ONE PLACE THE CONSOLE WRITES INTO A WORKSPACE'S OWN DATA TREE.
 * Everywhere else, `workspaces/{id}/...` is written only by that workspace's own
 * bot, and the console owns just the two registry documents
 * (`src/lib/firebase-admin`, `src/lib/workspace`). It is done here because at
 * this moment in a bot's life there is nobody else to ask: the run is still
 * creating the bot, and genaebot's own config writer refuses to create a
 * `settings` document at all (`workspace/lib/operator_writer.py`). A bot started
 * without this reads no config and so can serve nothing.
 *
 * It is held to exactly that: one document, created and never overwritten, and
 * nothing in `lines`, `groups` or `campaigns`.
 */

export class SeedUnavailableError extends BotUnavailableError {
  constructor(detail: string) {
    super(detail, 503);
    this.name = "SeedUnavailableError";
  }
}

/** Where the template settings live: `root` or `workspace:<id>`. */
function templateReference(target: Workspace) {
  const db = firestoreAdmin();
  if (BOT_SETTINGS_TEMPLATE === "root") return db.collection("settings").doc(SETTINGS_DOC);
  const id = BOT_SETTINGS_TEMPLATE.slice("workspace:".length);
  // Copying a workspace onto itself would be a no-op that reported success, and
  // an id this console does not recognise is a misconfiguration, not a source.
  if (!WORKSPACE_ID.test(id) || id === target.id) {
    throw new SeedUnavailableError("This console's template workspace is not set up correctly, so no bot was created.");
  }
  return db.collection("workspaces").doc(id).collection("settings").doc(SETTINGS_DOC);
}

/** Whether the document was written, or was already there. Both mean seeded. */
export type SeedOutcome = "written" | "already";

/**
 * The template, checked. Exported so a run can establish there is something to
 * seed from BEFORE it builds anything: discovering a missing template after a
 * service and a volume exist would have cost money for a bot that cannot start.
 */
export async function readSettingsTemplate(workspace: Workspace): Promise<Record<string, unknown>> {
  const source = templateReference(workspace);
  let template: Record<string, unknown> | undefined;
  try {
    template = (await source.get()).data();
  } catch {
    throw new SeedUnavailableError("Your bot's starting settings could not be read. Try again shortly.");
  }
  if (!template) {
    throw new SeedUnavailableError("This console has no template settings to start your bot from.");
  }
  const problems = settingsSeedProblems(template);
  if (problems.length) {
    // The template is this console's own data, not a user's, so naming the field
    // is useful to whoever runs it and tells the user nothing they should not see.
    throw new SeedUnavailableError(`Your bot's starting settings could not be used: ${problems[0]}.`);
  }
  return template;
}

export async function seedWorkspaceSettings(workspace: Workspace): Promise<SeedOutcome> {
  const template = await readSettingsTemplate(workspace);
  const target = firestoreAdmin()
    .collection("workspaces").doc(workspace.id).collection("settings").doc(SETTINGS_DOC);
  try {
    // Create-only, like init-workspace.py's `currentDocument: {exists: false}`:
    // a document that appeared since the read is never overwritten.
    await target.create(settingsSeed(template));
    return "written";
  } catch (error) {
    // ALREADY_EXISTS (6) is this step having already run -- a re-entered stage,
    // or a hand-seeded workspace. Either way there is nothing left to do.
    if ((error as { code?: unknown } | null)?.code === 6) return "already";
    throw new SeedUnavailableError("Your bot's starting settings could not be saved. Try again shortly.");
  }
}
