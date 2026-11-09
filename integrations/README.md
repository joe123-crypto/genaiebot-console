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

## Campaign creation

`genaebot-campaign-creation.patch` is based on genaebot commit `5728af9`.
It includes caption override support; **do not also apply the older caption
patch**. Apply to a clean isolated checkout containing that revision:

```bash
git apply --check /path/to/genaiebot_console/integrations/genaebot-campaign-creation.patch
git apply /path/to/genaiebot_console/integrations/genaebot-campaign-creation.patch
python3 workspace/lib/test_console_campaigns.py
python3 workspace/lib/test_operator_config.py
python3 workspace/lib/test_operator_writer.py
python3 workspace/lib/test_promo_broadcast.py
python3 workspace/lib/test_promo_config.py
python3 deploy/test_console_read.py
python3 deploy/test_console_write_api.py
python3 deploy/test_console_campaign_api.py
```

Deploy the bot first, with `GENAIE_CONFIG_SOURCE=firestore`,
`GENAIE_AD_ASSETS_SOURCE=r2`, `GENAIE_AD_ASSETS_BASE_URL` pointing at the existing
public image origin, and its existing `GCP_SERVICE_ACCOUNT_WRITE_B64` supplied
only to the console API. The new scripts are staged with `workspace/bin` and
`workspace/lib`; there is no generated per-campaign code or manual installer.

Deployment alone does not switch image storage. If overview reports
`campaignCreation.create=true`, `scheduling=true`, and `images=false`, the bot
update is present but its R2 image configuration is unavailable. Set the bot's
`GENAIE_AD_ASSETS_SOURCE=r2` and `GENAIE_AD_ASSETS_BASE_URL` to the existing
bucket's public HTTPS origin. These bot settings are separate from the console's
four upload credentials below; both must be configured for creation.

The authenticated `POST /internal/console/campaigns/create` route accepts the
`NewCampaign` shape in `src/domains/campaign-create.ts`, plus server-assigned
`actor`. `requestId` is stable across retries. Success reports `slug` and
`scheduling: ready|pending`. Campaign, selected groups, asset index, creation
receipt and audit are committed in one Firestore transaction. Concurrent edits
cause a transaction conflict, preserving the other edit. A repeated request
returns the existing campaign; a changed payload using that receipt is refused.

The console signs five-minute immutable R2 PUT URLs using `R2_ACCOUNT_ID`,
`R2_BUCKET`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY`. Configure these only
on the console server, using a bucket-scoped object-write token. The bot needs
no R2 write credentials. Set bucket CORS for the console's exact origin(s),
including local development origins when needed:

```json
[{
  "AllowedOrigins": ["https://YOUR-CONSOLE-HOST"],
  "AllowedMethods": ["PUT"],
  "AllowedHeaders": ["Content-Type", "If-None-Match", "x-amz-*"],
  "ExposeHeaders": ["ETag"],
  "MaxAgeSeconds": 300
}]
```

Each JPEG/PNG is at most 6 MiB; at most 20 pictures and 100 groups are accepted
per campaign. Files go directly to `ads/<slug>/<sha256>.<ext>`. Before creating
an index entry, the bot downloads from its configured asset origin and checks
magic bytes, length and SHA-256. An interrupted upload creates no campaign or
index entry. Unreferenced immutable objects from abandoned forms are harmless
and may be removed manually after confirming no asset document references them;
do not apply a blanket expiry to the `ads/` prefix.

The console API reconciles desired gateway schedules at startup and every
minute. Job names are stable (`console-<slug>-promo`), a volume lock serializes
reconciliation, and a read-back verifies schedule, timezone, command, timeout,
and enablement. Jobs are initially added disabled. A lost acknowledgement is
recovered by finding the existing named job, never by running it immediately.
Pending schedules are visible and retried after API/gateway restart. A pending
campaign cannot post or consume cap turns until reconciled. Existing enable
controls continue to gate runs immediately; job enablement follows during the
next reconciliation. Existing standby checks recognize the `-promo` suffix.

The shared runner uses one resolved config and the campaign's timezone/date;
it reuses caption and picture rotation, weekly restrictions, caps, connectivity
checks, spacing and the per-group sent receipt. A process lock prevents duplicate
simultaneous invocations. Missing verified pictures fail before any send. Existing
manifest campaigns retain their scripts, assets and schedule ownership. Repo
asset mirror tooling excludes console-owned campaign assets from repo parity
and replacement operations.

After deploying both sides, verify `overview.writes.campaignCreation` reports
all capabilities, create a campaign with Enabled off, inspect its pictures,
caption preview, two-line group assignments and disabled gateway job, then
explicitly enable it if desired. This change does not deploy or send test adverts.
