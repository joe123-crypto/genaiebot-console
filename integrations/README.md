# Bot support for caption editing

The console's caption editor needs the bot's config writer, read bridge and
broadcast engine to agree on the same campaign copy. The companion
`genaebot-caption-variants.patch` contains those changes and six integration tests.
It is based on genaebot commit `31d2302` (`claude/console-write-api`), which provides
the validated, audited Firestore writer and its HTTP config route.

Apply it to a checkout containing that writer:

```bash
git apply --check /path/to/genaiebot_console/integrations/genaebot-caption-variants.patch
git apply /path/to/genaiebot_console/integrations/genaebot-caption-variants.patch
python3 workspace/lib/test_campaign_captions.py
python3 workspace/lib/test_operator_writer.py
python3 workspace/lib/test_operator_config.py
python3 workspace/lib/test_promo_config.py
python3 deploy/test_console_read.py
```

Deploy the bot update with its existing Firestore write credentials and
`GENAIE_CONFIG_SOURCE=firestore`. Set the console's `BOT_WRITE_API_BASE_URL` to the
service exposing `POST /internal/console/config/campaigns/<slug>` and
`BOT_WRITE_TOKEN` to its bearer token. Keep reads pointed at the same bot, and
set `CONSOLE_WRITES=1` to show editing controls. Local development uses the same
JSON request on `console-write` stdin when no remote write URL is configured.

The request is `{ "fields": { "captions": ["caption template", "another"] },
"actor": "operator name" }`. The bot validates nonblank strings and request size,
retains the rest of the campaign document, and commits the edit and audit record
together. Campaign lists, previews, snapshots and future sends all read the
override. Campaigns without an override retain their shipped copy. File and
shadow modes retain shipped copy and refuse caption writes, so a successful save
cannot promise a change that posting will ignore.

The console retains drafts across refreshes and failures and checks the current
caption list before writing to detect stale edits. This check is not an atomic
compare-and-swap; simultaneous operator saves still follow the existing config
writer's last-write behavior.

## Group activity and member counts

The paired `genaebot` change adds `deploy/railway/whatsapp-group-activity.mjs`,
socket lifecycle integration, member totals in the hourly group inventory, and
`workspace/lib/group_metrics.py` in the console read bridge. The Docker image
must include the new collector module alongside the existing discovery module.

The existing Groups API gains optional `metrics` on each configured and
discovered group:

```json
{
  "dailyMessageCount": 120,
  "windowStart": "2026-11-08T10:00:00.000Z",
  "asOf": "2026-11-09T10:00:00.000Z",
  "coverage": "partial",
  "memberCount": 256,
  "memberCountObservedAt": "2026-11-09T09:00:00.000Z"
}
```

Counts and member observations can independently be `null`. Coverage is
`complete`, `partial`, or `unavailable`. `asOf` is the live observation cutoff,
even when the API's `date` requests a historical campaign plan. Member totals
include every member WhatsApp reports, including bot accounts.

The collector observes original incoming text/media on existing sockets before
reply filters, deduplicates across accounts and reconnects, and excludes bot
posts, protocol events, edits, reactions, and history synchronization. It keeps
message IDs, group IDs, timestamps and hashed sender identities for 48 hours in
`$OPENCLAW_STATE_DIR/runtime/whatsapp-activity.sqlite`; it stores no message
content or member lists. A 30-second heartbeat records coverage. An unclean
disconnect becomes detectable within 90 seconds. Collection/storage failures
never reject into WhatsApp handling. The bridge opens the database read-only.

Deploy the bot update **first**, then this console. Do not backfill history:
initial counts are partial until a full rolling day has been observed. An older
bot safely displays `—`. `GENAIE_GROUP_ACTIVITY=0` stops new activity collection;
`GENAIE_GROUP_DISCOVERY=0` independently pauses metadata scans. Existing saved
observations remain available with their coverage and timestamps.

Validate the bot with its collector/discovery/health tests, pinned WhatsApp
adapter compatibility test, `workspace/lib/test_group_metrics.py`,
`workspace/lib/test_group_discovery.py`, and `deploy/test_console_read.py`.
Validate the console with `npm test`, `npm run typecheck`, and `npm run build`.
