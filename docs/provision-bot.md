# Provisioning a workspace's bot

Every user gets a workspace on their first sign-in, with no bot. Until one is
connected, they see `/setup` and the console makes no bot call for them. This
is how a workspace gets its bot, and how the install that predates workspaces
moved into one.

Run every `workspace-admin` command from this repository with the console's
server credentials, which includes `BOT_TOKEN_SECRET`:

```sh
alias wsadmin='node --env-file=.env.local scripts/workspace-admin.mjs'
```

## From the console

With `BOT_PROVISIONING=railway`, `/setup` creates the bot itself: the user
clicks **Create my bot** and watches the four stages, which are this runbook's
steps with nobody running them.

| Stage | What it does |
|---|---|
| Reserving your bot | A Railway service with no image yet, its own volume at `BOT_VOLUME_MOUNT_PATH`, its own domain |
| Starting it up | Copies the template service's variables with this bot's own overridden, gives the service its `BOT_IMAGE` (which is what deploys it), and waits for the bot to answer `/internal/console/capabilities` for this workspace |
| Setting up its config | Copies `settings/defaults` from `BOT_SETTINGS_TEMPLATE`, without `contact_account` |
| Connecting it | The same handshake and registry write as `connect-bot` |

Set `BOT_RAILWAY_API_TOKEN`, `BOT_RAILWAY_PROJECT_ID`,
`BOT_RAILWAY_ENVIRONMENT_ID`, `BOT_TEMPLATE_SERVICE_ID` and `BOT_IMAGE` (see
`.env.example`). With any of them missing, `/setup` says creating a bot is not
available rather than starting a run it cannot finish.

> **Do not set these yet.** Two things have to be true of the bot image first,
> and neither is today:
>
> 1. **It must be published**, by exact tag. genaebot releases with
>    `railway up` (uploaded source), so no registry image exists.
> 2. **It must cold-start on an empty volume.** A provisioned bot gets a brand
>    new, empty Railway volume, and `deploy/railway/entrypoint.sh` exits 78
>    (`FATAL: openclaw.json not found`) unless the volume is already seeded --
>    and nothing can seed one before first boot, since the public Railway API has
>    no volume-file call. genaebot's `GENAIE_COLD_START=1` answers this: the
>    entrypoint installs its baked `config/openclaw.template.json` as the initial
>    config. This provisioner already sets that variable on every bot it creates
>    (`src/domains/bot-variables`), so this holds as soon as a genaebot carrying
>    the flag is published.
>
> Until both hold, leaving `BOT_IMAGE` unset is the safe state: provisioning
> resolves to `none` and `/setup` hands over the workspace ID as before.

**A run only moves while something is polling it.** It has no process of its
own: the browser's poll advances it one step at a time. A closed tab stalls a
run rather than breaking it -- each step checks whether its work has succeeded
before it checks the deadline, so a deployment that finished while nobody was
watching is adopted when the page is opened again.

**Nothing is created twice.** Every id is written to
`workspaces/{id}.provisioning` the instant Railway hands it over, and the
service is looked up by name (`bot-<workspace id>`) before it is created. A
failed run is re-armed in place by **Try again**, which carries on from what the
last attempt built; only a dead deployment is replaced.

**When a run fails**, nothing is connected: `workspaces/{id}.bot` is written
only after the bot has answered for that workspace. To see where a run got to,
read `provisioning` on `workspaces/{id}` -- it names the Railway service. The
steps below are still the fallback for anything the console cannot finish.

**Why it failed is recorded, so nobody has to read Railway's logs to guess.**
Two places say it, and neither is the screen -- what the user reads is always
one sentence this console wrote, never Railway's words:

* `provisioning.railway.deploymentStatus` holds Railway's own last word on the
  deployment that ended the run: `CRASHED` is a bot that would not boot,
  `FAILED` a build that did not, `REMOVED` or `SKIPPED` a deployment that never
  ran, `NEEDS_APPROVAL` one nobody approved. **Open
  `provisioning.railway.deploymentId` in Railway** for that deployment's own
  build and deploy log. The field is written only by the verdict that ends a
  run, and **Try again** clears it, so it is never the previous attempt's.
* The console's own server log carries the same verdict with those ids under
  `[provisioning]`, and it is also the only place a Railway API error's own
  words (`RailwayError.upstream`) are written down.

The first real run, on 2026-11-26, failed exactly here: Railway marked the
deployment `CRASHED`, which was true -- the bot image's entrypoint could not
boot on a brand new, root-owned volume -- but the console had kept no record of
the verdict, so finding that out meant reading Railway's deploy log by hand.

The service is the only resource looked up before it is created, so there is a
narrow window -- a crash between `volumeCreate` returning and the id being
written down -- in which a retry asks for a second volume and fails. If a run
wedges that way, read `provisioning`, delete the stray resources in Railway,
clear the field, and either start again or follow the steps below. A
`provisioning` record the console cannot read is refused rather than started
over, for the same reason: it may name resources that exist.

**Deleting an account deletes its bot.** `DELETE /api/workspace`
(`src/lib/account-deletion.ts`) removes the bot this console built before it
touches any data: the `bot-<id>` service, then the volume that was mounted on
it, then the workspace's pictures under `workspaces/<id>/` (and the older
`w/<id>/`) in R2, and only then
`workspaces/{id}`, `consoleUsers/{uid}` and the sign-in. If Railway or R2
refuses, the account is kept and the user is told to try again; every step
reads before it acts, so asking again carries on. Provisioning is fenced off
for the duration (`workspaces/{id}.deletingAt`, ten minutes), so no poll can
build a service behind the teardown. What is deleted is decided by name: a
service called `bot-<workspace id>` that is not `BOT_TEMPLATE_SERVICE_ID`. That
name is the provisioner's, so **do not give a hand-made bot that name** --
a bot set up by hand is otherwise left running when its account goes, and the
Settings card says so.

**Bots left behind** -- by a console older than this, or a teardown nobody
asked to finish -- are found by `sweep-bots`, which lists each `bot-<id>`
service with no `workspaces/{id}` behind it, with its volume, its pictures and
whatever the still-running bot wrote back into Firestore. It deletes nothing
without `--write`:

```sh
BOT_RAILWAY_API_TOKEN=... BOT_RAILWAY_PROJECT_ID=... BOT_RAILWAY_ENVIRONMENT_ID=... \
  node --env-file=.env.local scripts/workspace-admin.mjs sweep-bots [--write]
```

A volume mounted on nothing is reported and not deleted: once its service is
gone nothing says whose it was. The two calls below are the manual fallback.

**Deleting a service does not delete its volume.** A `serviceDelete` leaves the
volume behind, unmounted and still billed, so cleaning up a stray bot is two
calls:

```sh
railway api 'mutation { serviceDelete(id: "<service id>", environmentId: "<environment id>") }'
railway api 'mutation { volumeDelete(volumeId: "<volume id>") }'
```

`provisioning.railway` on `workspaces/{id}` names both ids.

`volumeDelete` answers `true` and marks the volume for deletion with a few days'
retention rather than removing it at once, so a deleted volume keeps appearing
in a project-wide `volumes` query. It is gone when its instance reports
`isPendingDeletion: true` (or when the environment's own inventory stops listing
it); the project-level list is not the one to read.

Things worth knowing before the first run on a new project, each checked
against the live Railway API:

* **The service is created without an image, and gets one last.** A
  `serviceCreate` that names an image deploys immediately, which would boot the
  bot before its volume is mounted and before it holds any of its config. So the
  order is service, volume, domain, variables, then the image -- and setting the
  image is the deploy. A sourceless service starts nothing.
* **The region is set with the image.** The volume is pinned to one region
  (`BOT_RAILWAY_REGION`), and a service left to deploy elsewhere could not mount
  it.
* **A sealed Railway variable cannot be read back**, so it cannot be copied onto
  a new service. A run refuses before it builds anything and names the variable.
  Keep anything a bot cannot work without unsealed, or a shared project variable.
  As of 2026-11-25 none of the `gateway` service's variables are sealed and all
  seven a bot cannot work without are readable.
* **`GENAIE_ASSET_KEY_PREFIX` is deliberately not copied** from the template.
  A current bot ignores it and keeps its pictures under
  `workspaces/<id>/campaigns/`, beside the workspace's Firestore tree; an older
  image would have read a copied `ads/` and used the shared folder. The
  variable write replaces rather than merges, so it cannot survive from the
  template.
* **The `variables` query also returns the fourteen names Railway injects**
  (`RAILWAY_SERVICE_ID`, `RAILWAY_VOLUME_ID`, `RAILWAY_PUBLIC_DOMAIN` and the
  rest). They are dropped rather than copied: a new bot given the template's
  would be holding another bot's identity as literal strings.

Linking WhatsApp is not part of a run. It stays on the Lines page, and needs
`CONSOLE_WRITES=1` as well.

### Walking the screen through its stages without building anything

```sh
BOT_PROVISIONING=stub npm run dev
```

The stub builds nothing, and `BOT_PROVISIONING` can never be `stub` in
production. With `BOT_PROVISIONING_STUB_URL` set to a bot's origin, the run's
last stage performs the real handshake and connects it, exactly as `connect-bot`
does. Without it, the run finishes as simulated and the screen says so.

## Releases reach every bot

A genaebot release used to stop at your gateway: a workspace's bot got the image
`BOT_IMAGE` named when `/setup` built it and never changed again. Now every
console-built bot follows the gateway, one at a time.

1. **genaebot releases the gateway**, as before. Only if that release passed its
   startup check does the workflow's `promote-workspace-bots` job run. It waits
   for the commit's image on GHCR, then calls `POST /api/internal/fleet/release`
   with it. The image is accepted only if it is a 40-character commit build of
   the repository `BOT_IMAGE` names. It becomes the target in
   `consoleFleet/release`, and new bots are created from it too.
2. **`.github/workflows/fleet-tick.yml` calls `POST /api/internal/fleet/tick`
   every ten minutes.** Each tick moves the rollout on by at most one step
   (`src/lib/fleet-rollout.ts`):
   - **One bot at a time, fleet-wide.** The first bot to take a release is the
     canary for the rest.
   - **Only a quiet bot is started.** The console asks the bot's own
     `GET /internal/console/release-window` (the same arithmetic as the gateway's
     release gate). A bot that is sending waits. So does a bot that cannot answer
     because it is down or predates the route, since a gate that cannot see does
     not wave a restart through.
   - **Starting:** note the connected WhatsApp accounts, set the image, and ask
     for one deploy. Setting an image does not deploy by itself (measured
     2026-11-26), so that explicit deploy is the only one.
   - **Verifying:** the deployment must succeed within 15 minutes. Within 10 more,
     the bot must answer for its workspace with every account that was connected
     before connected again.
   - **Failing:** the bot is put back on its previous image and redeployed, its
     record says why, and the fleet **pauses**. No other bot gets that release.
     The tick that paused it answers 409, so that one scheduled run fails and
     GitHub emails you. Later runs pass with a warning while it stays paused.
3. **The next release clears the pause**, because it is presumably the fix, and
   the rollout starts again with the bot that failed. Promoting the same image
   again (a re-run of the CI job) changes nothing, pause included.

Only bots this console built are included: a workspace whose `provisioning`
record is `ready` and names a service, the same rule account deletion follows.
A workspace whose account is being deleted is skipped. Account deletion likewise
waits while a rollout step holds the bot (`workspaces/{id}.release.lease`, a
minute at most).

The gateway's release-profile switches are never copied to a bot, at creation
or since. These are `GENAIE_CAMPAIGN_TRANSPORT`, the idle-retirement,
allocator and cache-cleanup trials, and `GENAIE_OVERNIGHT_STANDBY`. Absent, each
is its baseline default, so an experiment on your gateway stays on your gateway.

**Operator commands** (`scripts/workspace-admin.mjs fleet …`) write the record;
the tick does the Railway work:

| Command | What it does |
| --- | --- |
| `fleet status` | The target, whether it is paused and why, and each bot's image and stage |
| `fleet pause --reason "…"` | Starts no new bot; one already in flight finishes |
| `fleet resume` | Lets the others go on. The bot that failed stays on its old image until the next release |
| `fleet promote --image <repo>:<sha>` | Sets the target by hand, e.g. to roll every bot back to an older build |
| `fleet sync-settings --write` | Every bot re-copies the gateway's shared values (keeping its own gateway password) and is redeployed on its image, by the same one-at-a-time rules. Use it after rotating a key or when a release needs a new variable. Railway keeps no variable history, so a bot that then fails keeps the new values |

**Set-up**, once:

- **Vercel (console):** `FLEET_RELEASE_TOKEN` and `FLEET_TICK_TOKEN`, each at
  least 32 characters and different from each other.
- **genaebot repository:** the same `FLEET_RELEASE_TOKEN` as a secret, and
  `CONSOLE_URL` as a variable.
- **Console repository:** the same `FLEET_TICK_TOKEN` as a secret, and
  `CONSOLE_URL` as a variable.

Until a side is set, it is off: the promote job warns and succeeds, the tick
workflow notices and exits, and both routes answer 401.

## A new user's bot, by hand

This is what `BOT_PROVISIONING=railway` automates, and the fallback when it is
off or a run could not finish.

1. **Find the workspace.** The user reads its ID off `/setup`, or:
   `wsadmin show --email <their email>`.
2. **Create the bot.** Use a new Railway service from the genaebot image, with
   its own volume, its own `GATEWAY_AUTH_TOKEN` and its own domain. Then set:

   ```sh
   railway variable set GENAIE_WORKSPACE_ID=<id> GENAIE_CONSOLE_API=1 --skip-deploys
   wsadmin token --workspace <id> | railway variable set CONSOLE_API_TOKEN --stdin --skip-deploys
   ```

   Also set the shared Firestore read and write keys and the R2 variables, as on
   the first bot, and `GENAIE_CAMPAIGN_CLICK_BASE_URL` to the new bot's own
   domain. The bot keeps its pictures under `workspaces/<id>/campaigns/`;
   there is no variable for that.
3. **Seed its config.** From a genaebot checkout:
   `deploy/init-workspace.py --workspace <id> --write`.
   This writes `settings/defaults`. Without it every send fails closed. A line
   is no longer seeded here: the user adds theirs on the Lines page, and the
   console writes its document from the number the linked account reports. Pass
   `--line default=+<number>` only to hand over a workspace with its line
   already made.
4. **Connect it:** `wsadmin connect-bot --workspace <id> --url https://<bot domain>`.
   This asks the bot first. It must accept the workspace's token and report
   `GENAIE_WORKSPACE_ID=<id>`, or nothing is saved. The user's console switches
   over within 30 seconds.
5. **Link WhatsApp.** The user links WhatsApp on their Lines page.

## Moving the install that predates workspaces

Its data sits in Firestore's root collections, and its bot reads them. The
order matters: the owner's workspace must exist **before** the console version
with workspaces is deployed. Otherwise their first request creates an empty one.

1. `wsadmin create --email <owner> --name "<name>"`. Note the printed
   workspace ID.
2. Copy the data and verify it from a genaebot checkout. Follow *A bot pinned
   to one workspace* in genaebot's `deploy/railway/README.md`. It ends with
   `copy-workspace-data.py --verify` reporting `identical`.
3. In a quiet window after the day's last send run has **ended**:
   1. Turn off `CONSOLE_WRITES`.
   2. Run `--write` and `--verify` once more.
   3. Set the bot's variables and redeploy it:

      ```sh
      railway variable set GENAIE_WORKSPACE_ID=<id> --skip-deploys
      wsadmin token --workspace <id> | railway variable set CONSOLE_API_TOKEN --stdin --skip-deploys
      railway redeploy --yes
      ```

   4. Connect the bot: `wsadmin connect-bot --workspace <id> --url https://<gateway domain>`.
   5. Deploy the console with `BOT_TOKEN_SECRET` set, and with `BOT_API_*` and
      `BOT_WRITE_*` removed.
   6. Turn `CONSOLE_WRITES` back on.

   Between the bot redeploy and the console deploy, the old console's token is
   refused, so it shows the bot as unavailable. Nothing is written in that gap.
4. Move the pictures into the workspace's own prefix with genaebot's
   `deploy/move-pictures-to-workspace-layout.py` (plan, `--write`, `--verify`,
   and after 48 hours `--delete-old`). Until then the copied index still names
   the old `ads/` keys, which the bot still reads.

## Rolling back the move

1. Delete `GENAIE_WORKSPACE_ID` on the bot.
2. Restore its previous `CONSOLE_API_TOKEN` and redeploy it.
3. Redeploy the previous console version.

If edits were made after the cutover, first copy them back with
`copy-workspace-data.py --from workspace:<id> --to root --write`.
