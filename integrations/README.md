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
