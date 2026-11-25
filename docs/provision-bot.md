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
>    (`FATAL: openclaw.json not found`) unless the volume is already seeded. Its
>    auto-seed path needs `openclaw-state.tgz` to have been uploaded to the
>    volume first, which only `railway volume files upload` can do -- the public
>    GraphQL API has no volume-file call, so the console cannot do it. Until the
>    image can seed itself (bake the initial state in and let the auto-seed fall
>    back to the image's copy), a run reaches `starting` and reports that the bot
>    was created but would not start.
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

The service is the only resource looked up before it is created, so there is a
narrow window -- a crash between `volumeCreate` returning and the id being
written down -- in which a retry asks for a second volume and fails. If a run
wedges that way, read `provisioning`, delete the stray resources in Railway,
clear the field, and either start again or follow the steps below. A
`provisioning` record the console cannot read is refused rather than started
over, for the same reason: it may name resources that exist.

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
* **`GENAIE_ASSET_KEY_PREFIX` is deliberately left unset** on a new bot, which
  is what puts its pictures under `w/<id>/ads/`. The variable write replaces
  rather than merges, so it cannot survive from the template.
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
   domain. Leave `GENAIE_ASSET_KEY_PREFIX` unset: the bot then keeps its
   pictures under `w/<id>/ads/`.
3. **Seed its config.** From a genaebot checkout:
   `deploy/init-workspace.py --workspace <id> --line default=+<number> --write`.
   This writes `settings/defaults` and the bot's line. Without them every send
   fails closed.
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
      railway variable set GENAIE_WORKSPACE_ID=<id> GENAIE_ASSET_KEY_PREFIX=ads/ --skip-deploys
      wsadmin token --workspace <id> | railway variable set CONSOLE_API_TOKEN --stdin --skip-deploys
      railway redeploy --yes
      ```

   4. Connect the bot: `wsadmin connect-bot --workspace <id> --url https://<gateway domain>`.
   5. Deploy the console with `BOT_TOKEN_SECRET` set, and with `BOT_API_*` and
      `BOT_WRITE_*` removed.
   6. Turn `CONSOLE_WRITES` back on.

   Between the bot redeploy and the console deploy, the old console's token is
   refused, so it shows the bot as unavailable. Nothing is written in that gap.

## Rolling back the move

1. Delete `GENAIE_WORKSPACE_ID` and `GENAIE_ASSET_KEY_PREFIX` on the bot.
2. Restore its previous `CONSOLE_API_TOKEN` and redeploy it.
3. Redeploy the previous console version.

If edits were made after the cutover, first copy them back with
`copy-workspace-data.py --from workspace:<id> --to root --write`.
