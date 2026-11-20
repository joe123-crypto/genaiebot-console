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
`GENAIE_CONFIG_SOURCE=firestore`. Writes go to the workspace's own bot, the
same one the reads use (`POST /internal/console/config/campaigns/<slug>`). Set
`CONSOLE_WRITES=1` to show editing controls. Local development uses the same
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

## Leaving a group and clearing its records

The Groups screen's delete dialog can also take the bot's number out of the
WhatsApp group and forget what the bot stored about it. Both need the companion
`genaebot` change on branch `claude/group-leave-actions`.

That change adds `deploy/railway/whatsapp-group-actions.mjs`, injected into the
channel monitor by `whatsapp-lid-loader.mjs` beside the group inventory, which
is the only place a live Baileys socket is in reach — the gateway exposes no RPC
for leaving a group and a second process cannot borrow an account's socket. It
also adds `workspace/bin/console-group-action`, `workspace/lib/group_cleanup.py`
and the route:

```
POST /internal/console/groups/<urlencoded jid>/actions
     {"leave": true, "clearRecords": true, "account": "ads", "actor": "operator name"}
```

behind the same bearer token as the config route. It needs **no Firestore write
key**: neither action writes a document. The console therefore gates these
controls on a new, separate capability rather than on `overview.writes`:

```json
"actions": { "leaveGroup": true, "clearRecords": true }
```

Absent on an older bot, which the console reads as "cannot" and shows the boxes
disabled with the reason. `GENAIE_GROUP_ACTIONS=0` switches the surface off at
both ends.

A leave is queued at
`$OPENCLAW_STATE_DIR/runtime/whatsapp-group-actions/<accountId>/requests/<uuid>.json`
and answered in `results/`; the group ID never becomes a filename. A successful
leave prunes the group from that account's discovery inventory, through the
discovery module itself so the write is ordered against a scan in flight. An
answer that does not arrive within the bridge's 25-second wait comes back as
unconfirmed, and the request stays queued for a reconnecting account.

Deploy the bot update first, then this console. Validate the bot with
`./deploy/ci-check.sh` and the adapter-pinned integration tests; validate the
console with `npm test`, `npm run typecheck` and `npm run build`.

## Removing an Unassigned group

Deploy the companion bot with `actions.removeDiscovery` before the console
update. The console sends the row's `lastSeenAt` to
`POST /internal/console/groups/<urlencoded jid>/remove-discovery` as
`{"observedThrough": "..."}`. The route uses the group actions switch
and the console write bearer token. It saves the cutoff under
`$OPENCLAW_STATE_DIR/runtime/whatsapp-group-removals/` on the persistent volume.
Both discovery views respect it, including when automatic scans are paused.

## Firestore scoped reads and group batches

`genaebot-firestore-scoped-reads.patch` applies to genaebot
`a06fbf5855a5317ebad3d38bad2795d5b81bd463`. It extends the existing console display
cache and quota-error handling with targeted campaign/group/asset queries, sidebar
aggregations, transactional group batches, and scheduler read/write reductions.
It requires no Firestore data migration or new composite indexes; targeting uses
the existing single-field array index on `groups.promos`.

Deploy this backend update before the console. Narrow-route and batch fallbacks
support earlier bots that already accept the `fresh=1` save-read contract. Save
checks against older bots may require this patch; they never silently accept
cached data in place of an explicitly requested live read.

From a clean bot checkout at that revision:

```bash
git apply --check /path/to/genaiebot_console/integrations/genaebot-firestore-scoped-reads.patch
git apply /path/to/genaiebot_console/integrations/genaebot-firestore-scoped-reads.patch
bash deploy/ci-check.sh
```

For newer bot revisions, run the patch check first and reconcile any overlapping
cache changes before applying it.

Healthy display configuration is cached for 180 seconds, leaving room for the
30-second API cache and 60-second polling interval within a five-minute display
freshness budget. Failed refreshes wait at least 300 seconds. Writers and campaign
runs use live reads, and outage snapshots retain the existing age limit. Cache
invalidation covers attempted/uncertain mutations and overlapping old reads.

The route contract and read/write budgets are covered by the bot's
`test_scoped_reads.py`, `test_console_config.py`, `test_scoped_console_api.py` and
existing regression suites. Console tests cover the narrow API routes, old-bot
fallback, lazy group choices, saved draft lookups, atomic batch application, and
protection against reusing a pre-save read after a mutation.

## Campaign deletion

`genaebot-campaign-deletion.patch` is based on **genaebot `44cc6a3`**. That
revision already includes campaign creation, caption overrides and campaign conversion. Apply this
patch to that base or check it against a newer checkout; do not reapply the older
creation/caption patches on top.

```bash
git apply --check /path/to/genaiebot_console/integrations/genaebot-campaign-deletion.patch
git apply /path/to/genaiebot_console/integrations/genaebot-campaign-deletion.patch
python3 workspace/lib/test_campaign_deletion.py
python3 workspace/lib/test_operator_config.py
python3 workspace/lib/test_operator_writer.py
python3 workspace/lib/test_console_campaigns.py
python3 workspace/lib/test_console_config.py
python3 workspace/lib/test_scoped_reads.py
python3 deploy/test_scoped_console_api.py
python3 deploy/test_console_read.py
python3 deploy/test_console_campaign_api.py
python3 deploy/test_console_write_api.py
python3 deploy/test_promo_cron_reinstall.py
python3 deploy/test_ad_assets_deploy.py
python3 deploy/test_r2_sigv4.py
PROMO_START_JITTER_SECONDS=0 python3 -m pytest -q workspace/lib/test_promo_broadcast.py workspace/lib/test_promo_config.py workspace/lib/test_ad_assets.py deploy/test_upload_ad_image.py deploy/test_operator_config_parity.py
```

Deploy the **bot first**, then the console. In addition to the existing console
API bearer token and Firestore write key, configure these on the bot service:

- `GENAIE_CAMPAIGN_DELETION=1` and `GENAIE_CONFIG_SOURCE=firestore`.
- `GENAIE_AD_ASSETS_SOURCE=r2` and the existing `GENAIE_AD_ASSETS_BASE_URL`.
- `R2_ACCOUNT_ID`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, using
  object-deletion permission scoped to the same bucket the live asset index uses.

The entrypoint passes the R2 credentials only to the console API process, then
removes them before starting the gateway. Broadcast runners retain only their
read-only Firestore key and public picture access. The Docker image bakes the
existing SigV4 helper beside the manifest; the workspace staging rules already
carry the new retirement module and installer check. `CONSOLE_WRITES=1` remains
required on the console. An older bot, file/shadow mode, missing R2 configuration
or a disabled retirement flag leaves the trash action unavailable.

The authenticated route is:

```
POST /internal/console/campaigns/<slug>/delete
{"actor":"operator name"}
```

Local development sends `{"delete":"<slug>","actor":"operator name"}` to
`workspace/bin/console-campaign-create` on stdin. Acceptance returns
`{"ok":true,"slug":"<slug>","name":"Campaign","cleanup":"pending"}`;
repeated requests return the current status, including `complete`. Picture keys,
file paths, commands and cleanup options cannot be supplied by the browser.
Overview adds `deletedCampaigns: string[]` so fresh upload signing refuses retired
IDs. The campaigns read payload adds `deletions: [{slug,name,cleanup,detail?}]` and
write capabilities add `campaignDeletion: {delete,reason?}`.

Acceptance transactionally replaces the active campaign with a minimal
`deleted:true, enabled:false` marker and writes both an audit snapshot and a
`campaign_deletions/<slug>` cleanup receipt. Built-in declarations remain in the
repository, but their deletion markers take precedence. The ID cannot be reused.
Deletion and cleanup fence the shared config cache and navigation summaries;
strict quota error metadata and scoped/batch read and write behavior are retained.
Readers remove retired definitions and assignment references **before** validation
and cap calculation, so incomplete cleanup does not quarantine otherwise healthy
groups. Live group/campaign edits use transactions that conflict with retirement.

The startup worker wakes immediately after a deletion and retries pending cleanup
every minute (retaining the existing idle schedule and failure backoff). It verifies and removes owned gateway jobs (including
known legacy names), cleans each affected group with an audited transaction,
removes asset documents, deletes exclusive exact R2 keys, and removes that
campaign's cache directory. Shared objects stay. Failures leave the receipt
pending, with a sanitized reason, and retry on later runs. Already-complete
receipts continue to suppress jobs accidentally reintroduced by old installers.

A shared per-campaign lock orders message submissions and cache fills against
deletion. Each submission checks the live campaign document with the runner's
read key. Once deletion commits, no remaining group may begin a send. A message
already being submitted can finish before the marker commits; a timeout waiting
for that boundary is an unknown outcome and can be retried safely.

Cron installers and the drift checker consult live retirement state and refuse
installation if it cannot be verified. Asset tools skip retired campaigns,
preserve their committed mirror entries, and reserve upload keys in durable
`campaign_asset_uploads` receipts before PUTs. Cleanup waits for an upload to
finish or its bounded lease to expire, recovering even an uploader that died
before indexing. Picture cleanup also waits ten minutes after acceptance for
previously signed five-minute browser PUT URLs to expire; schedules and group
assignments are cleaned immediately. Config reseeding refuses to overwrite a store with retirement
markers. Source picture files, Git history and existing images are unchanged.

**Compatibility:** keep retirement protection enabled after the first deletion.
While enabled, config reads and sends fail closed when live Firestore cannot be
checked; the old targeting snapshot is no longer an acceptable fallback because
it may predate a deletion. Reverting to an older bot or file configuration is not
a supported rollback after retirement. Roll back console code independently,
while retaining the bot's deletion-aware readers, runners and maintenance tools.
Do not remove retirement markers or cleanup receipts as part of routine pruning.

Validate using isolated fixtures and fake gateway/R2 services. Deployment does
not delete any campaign, send test adverts, or change repository assets.

## Recurring schedule editing

`genaebot-schedule-editing.patch` adds the authenticated schedule writer, read
metadata, recovery worker, and installer/drift support. It is based on bot commit
`44cc6a37d33ae7b2fdaa876b6abe15b18cd606be` **with
`genaebot-campaign-deletion.patch` applied first** (that commit already contains
campaign creation, scoped Firestore reads and campaign conversion). The schedule patch does not
include or reapply its dependency.

```bash
git apply --check /path/to/genaiebot_console/integrations/genaebot-schedule-editing.patch
git apply /path/to/genaiebot_console/integrations/genaebot-schedule-editing.patch
python3 -m pytest -q workspace/lib/test_console_schedule.py workspace/lib/test_console_campaigns.py workspace/lib/test_campaign_deletion.py deploy/test_console_schedule_api.py deploy/test_console_read.py deploy/test_console_write_api.py deploy/test_console_campaign_api.py deploy/test_promo_cron_reinstall.py deploy/test_retire_borehole_promos.py deploy/test_scoped_console_api.py
```

Deploy the **bot first**, using its existing bearer token, Firestore write key,
and `GENAIE_CONFIG_SOURCE=firestore`, then deploy the console with
`CONSOLE_WRITES=1`. No new credentials or environment flags are needed. The bot
advertises `writes.scheduleEditing.edit`; old bots keep saving disabled with a
companion-update explanation. File/shadow mode and missing write keys also keep
saving disabled. Deploying these changes alone does not change any start time.

The new route accepts only start-time changes, with the displayed campaign day
and expected revisions:

```text
POST /internal/console/schedule
{"date":"2026-11-10","timezone":"Africa/Harare","changes":[{"slug":"borehole-drilling","time":"07:10","expectedRevision":"<64-character revision from the read model>"}],"actor":"operator name"}
```

Local development sends the same JSON on stdin to `workspace/bin/console-schedule --apply`,
which also attempts gateway reconciliation immediately. Run the bot console API
worker for automatic retry of local pending updates; repeating the same request
is also safe. Both return `campaigns: [{slug, minutes, scheduleEdit}]`. Campaign read records
add normalized `scheduleMinutes` and `scheduleEdit: {revision, editable, reason?,
status, confirmedMinutes}`. `status` is `pending` or `ready`; `confirmedMinutes`
is the last verified time on that displayed day (or null when it had no run).

An acceptance transaction saves every edited campaign and its audit record
together. Manifest campaigns receive a durable `scheduleOverride`; console-created
campaigns retain their existing schedule structure with an updated time. Existing
weekdays, timezone, commands, enabled states, timeouts, and alerts are retained.
Unsupported cron expressions remain uneditable; posting on the hour is refused
to retain the bot's existing scheduling rule. Times shown in Harare are
converted using the displayed date; edits that would leave the campaign's
existing weekdays are refused. A revision conflict rejects the whole draft;
repeating an already-saved time is a no-op.

Acceptance returns promptly with pending status. The existing worker wakes after
a write, verifies the gateway job by reading it back, and marks the schedule ready.
Pending edits retry each minute, including after restart. The regular idle polling
interval and existing gateway failure backoff remain unchanged. A timeout may mean
the configuration was saved; the console checks live configuration before allowing
an ordinary retry to be mistaken for a fresh edit. Failed or uncertain writes keep
the draft. The timeline shows saved desired times separately from last-confirmed
times while application is pending.

Cron installers and the drift checker consult live saved overrides rather than
restoring shipped defaults. Installers recheck the latest override under the shared
scheduler lock after registration. Borehole legacy-job retirement also verifies
against its saved time. Converted campaigns keep their existing job name; script
installers refuse to take over their reconciler-owned jobs. Conversion and revert
retain the latest saved time. Live config reseeding refuses to overwrite console schedule
edits. Schedule editing never invokes `cron run` and does not interrupt an active
broadcast or trigger a catch-up send when moved into the past.

## Indexed live views and request budgets

`genaebot-live-views.patch` targets bot commit
`2f30524ec5c64bd2804151ac7c89019d2071b076` (the production source checked during
implementation). It includes the earlier display-cache projection optimization,
plus the durable index, leased Listen stream, telemetry selection, live API routes,
runtime dependency installation, CI coverage and documentation.

```sh
git apply --check /path/to/genaiebot_console/integrations/genaebot-live-views.patch
git apply /path/to/genaiebot_console/integrations/genaebot-live-views.patch
python3 -m venv .venv-console
.venv-console/bin/pip install -r deploy/railway/requirements-console.txt
PATH="$PWD/.venv-console/bin:$PATH" ./deploy/ci-check.sh
```

Deploy the bot through its existing validated release pipeline first. Verify
`/internal/console/live/status` and ten-row group/campaign pages with the existing
console bearer token, then deploy the console. Indexed views always call the workspace's own bot API, even in local console
development, and deliberately refuse legacy full-directory fallbacks. Legacy endpoints remain available to older
consoles. Roll back the frontend before rolling back the bot.

Live routes use the same authentication and uncacheable responses as other console
routes. The private SQLite database stores encoded documents, a published
configuration generation, consistent resume positions and revisions. It watches
settings, lines, campaigns, groups and deletion receipts. It is not a writer or a
campaign targeting source. Fresh writer checks continue reading Firestore.

List/search/picker requests return at most ten rows. Cursors bind the query and
result revision; an invalidated cursor requests a visible-anchor reset. DMC and
members query local telemetry only for visible IDs. Discoveries query local
inventory against indexed membership. The schedule endpoint omits group payloads,
caption text and assets. Unchanged polls return only freshness metadata. After
writes, the API fences indexed config until a consistent stream boundary is newer
than the write. The API resumes the shared stream from its saved tokens after
a write to obtain that boundary promptly, rather than waiting for an idle
heartbeat. The bounded confirmation wait does not hold the projection lock,
so local telemetry remains available. If confirmation is delayed, existing
revision-aware views receive stale/unchanged metadata and retain their data.
Draft-addition lookups use the live GET proxy and retain drafts on read failure;
uncertain writes are never replayed.

A visible view renews a 90-second sync lease; browser resources poll every 30
seconds and pause when hidden/offline. One stream is shared across tabs. The
initial bootstrap, invalid resume/reset, changed credentials or changed index
schema may read all indexed documents; ordinary browser requests do not. Stale
results retain their age and drafts. The status endpoint reports sync lag,
streamed document count, rebuild count, active streams, indexed requests and
returned rows. Compare these and Firestore's read metrics during idle viewing,
scrolling, searching and assignments after rollout; local request-budget tests
are not a measured production reduction.

Verified locally against an isolated HTTP bot/index fixture: Schedule at home,
server search, ten campaign rows, lazy campaign sections, and no browser runtime
errors. Fake-stream protocol tests cover consistent bootstrap, persisted resume,
matching existence filters, incremental delete/update, atomic reset, retirement,
lease expiry and multiple consumers. Telemetry tests preserve rolling-window
coverage and member observation timestamps.


## Campaign table picture previews

The live-view patch now includes asset metadata in the shared Listen index
(schema 3). Deploy the updated companion bot **before** this console update.
Existing schema-2 indexes rebuild once; regular list searches, pagination and
polls read the local index without per-campaign detail or asset catalogue queries.
The existing Firestore read identity must be able to read the `assets` collection.
No R2 credentials or image bytes are added to the display index.

Campaign summaries gain `imageCount: number` and `thumbnailUrl: string | null`.
The count comes from declared pictures; the URL comes from matching the first
declared filename to an enabled, validated asset using the existing public URL
builder and `GENAIE_AD_ASSETS_BASE_URL`. Missing or invalid origins and missing
assets retain the count and show the fallback icon. Asset changes participate in
campaign revisions, while schedule responses retain their existing compact shape.
Full captions and asset lists remain behind the explicit detail request.

The console preserves the compact thumbnail, additional-picture badge and lazy
loading. An older bot without preview fields displays “Images unavailable” rather
than an incorrect zero. Deploying console code alone cannot restore previews from
an older bot that omits their metadata.

For an existing bot with the previous live-view patch already applied, apply
only `genaebot-campaign-previews.patch`. It is regenerated against genaebot
`60acf63` and touches the display index, the live API and their tests alone: the
`include_assets` plumbing it used to carry through `console-read` and
`console_campaigns.records` has since landed on main in its own right.

```bash
git apply --check /path/to/genaiebot_console/integrations/genaebot-campaign-previews.patch
git apply /path/to/genaiebot_console/integrations/genaebot-campaign-previews.patch
```

For a clean installation, use the revised `genaebot-live-views.patch` in the
existing live-view sequence instead; it already includes this fix. Do not apply
both patches.
Verify with `python3 workspace/lib/test_console_live.py`,
`python3 workspace/lib/test_console_campaigns.py`, and
`python3 deploy/test_console_read.py`, with the pinned console stream dependencies
installed. Confirm `/internal/console/live/campaigns` returns preview summaries,
check the table after loading another page, and check that unchanged polls retain
pictures. Deployment does not send any adverts.

## Customer Bot instructions and live lookups

Deploy the paired live-lookup `genaebot` support before this console. The
historical `genaebot-customer-bot.patch` implements the retired knowledge-editor
contract and must not be applied for this feature.

`GET /internal/console/customer-bot` returns `instructions`, `revision`,
`publishedAt`, `publishedBy` and a read-only `sources` array containing source
`id`, `label` and `description`. It uses the full console bearer token; the
release-gate token has no access. This source list describes integrations, not
current network health. Actual factual lookups require live Firestore reads.

`POST` accepts only `instructions`, `expectedRevision` and `actor`. A stale
revision returns 409 and the current version. The bot rejects old `knowledge`
requests with a 400 upgrade message. The console rejects older bot responses
and explains that the bot must be upgraded. The existing `CONSOLE_WRITES=1`
switch enables publishing; read and publish target the same live gateway.

The bot preserves instructions from v1 publications and ignores their knowledge.
A replacement writes v2 and archives the previous publication privately in
`runtime/customer-bot/history/<revision>.json`. The workspace overlay cannot
replace those publications. Roll back the console before the bot, and restore
an archived v1 file only when deliberately returning to the old briefing model.
Neither deployment publishes a draft or sends customer messages. Campaign
ownership links and private advert status are deferred.

## Picture names the bot can cache

Deploy the paired `genaebot` fix before relying on any campaign whose pictures
carry long filenames; for a checkout based on genaebot `5c80a9c` the change is
in [genaebot-asset-filename-length.patch](genaebot-asset-filename-length.patch),
which also applies cleanly to the deployed `d251e71`.

```bash
git apply --check /path/to/genaiebot_console/integrations/genaebot-asset-filename-length.patch
git apply /path/to/genaiebot_console/integrations/genaebot-asset-filename-length.patch
python3 workspace/lib/test_ad_assets.py
```

The bot caches a picture at `<cache>/<campaign>/<sha256>-<filename>` and writes
it through a `.<pid>.<hex>.tmp` sibling. A filename long enough to push that
component past the filesystem's 255-byte limit made `ad_assets.ensure` raise
`AssetUnusable: [Errno 36] File name too long`, which aborts the whole run
before it posts anything -- the campaign lost, not the picture. `Borehole
Drilling 2` sent nothing from 2026-11-14 16:25 onward for this reason, on both
its schedule entries, while the console reported every run as scheduled and
confirmed. The patch trims the readable tail to fit, keeping the digest whole
and the extension on the end.

The console side of the same bug is `CAMPAIGN_IMAGE_NAME_MAX` in
[src/domains/campaign-create.ts](../src/domains/campaign-create.ts): uploads are
named through `campaignImageFilename`, and `uploadError` refuses a longer name,
so a new picture cannot reach the bot with a name it cannot cache. The two caps
are independent on purpose -- the console's keeps new uploads sane, the bot's
keeps every already-stored name sendable. Deploy order does not matter and no
campaign document changes, so a campaign already holding a long filename starts
sending again on the bot deploy alone, with no edit in the console.

Deploying the bot restarts the gateway, so pick a window with no send run in
flight rather than one that merely avoids a cron minute.

## Tracked links in caption creation, editing, and previews

Deploy the paired bot update before deploying this console feature. For a bot
checkout at `687ee37`, apply
[genaebot-tracked-caption-links.patch](genaebot-tracked-caption-links.patch):

```bash
git apply --check /path/to/genaiebot_console/integrations/genaebot-tracked-caption-links.patch
git apply /path/to/genaiebot_console/integrations/genaebot-tracked-caption-links.patch
python3 deploy/test_tracked_caption_links.py
python3 deploy/test_promo_captions_tracking.py
python3 deploy/test_console_read.py
python3 workspace/lib/test_operator_writer.py
python3 workspace/lib/test_console_live.py
```

The last test requires `deploy/railway/requirements-console.txt`. This patch adds
`tracking` to the validated campaign writer and returns current tracking settings
from the lightweight caption reads. Caption and tracking changes use one audited
campaign update; the console checks both original values before submitting it.
An older bot leaves tracked-link editing disabled while ordinary caption editing
remains available.

The assistant offers **Add tracked WhatsApp link** and recognizes the same request
in chat. It collects a fixed international number, including any configured bot
number, and asks which existing WhatsApp link to replace or whether to append.
The proposal uses `{ref_link}` and the campaign's existing tracking settings;
new tracking defaults to the campaign slug as its prefix and campaign name as its
label. The destination applies to all variants. Applying, undoing, restoring a
draft, and saving keep the caption and its tracking settings together.

Campaign cards show the per-group posting preview by default, with the editable
source under **Caption template**. The bot preview now shares the posting path's
redirect wrapper, so it shows the same registered `/go/…` URL instead of a direct
`wa.me` destination. Registering a preview reuses the existing durable link and
never increments its click count. Only following the public redirect does that.
The editor's writing preview remains explicitly labeled as a template because
group references and links are resolved for each target when posted.

`GENAIE_CAMPAIGN_CLICK_BASE_URL` must be configured on the bot for redirects and
click counts, as with the existing posting implementation. Unconfigured or
unavailable tracking retains the engine's existing direct-link fallback in both
posting and previews. Existing sent links and their click history are preserved;
this update does not rewrite stored campaign copy or send any adverts.
