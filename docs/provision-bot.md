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

## A new user's bot

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
