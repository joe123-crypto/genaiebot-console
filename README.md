# Genaie Console

An operator UI for the Genaie WhatsApp bot (`../genaebot`). It covers the parts
OpenClaw does not provide or exposes too technically: which groups the bot is
in and what should advertise where, what each campaign will actually send, and
how the day's slots fit together.

It is **not** a reimplementation of OpenClaw's own control UI.

## How it reads state

The console keeps no database or authoritative copy of bot state. Campaign group
drafts are stored only in the browser. Live data on every screen comes from
genaebot's own state, through one of two adapters in
[`src/lib/bot-client.ts`](src/lib/bot-client.ts):

- **local** (development) — runs `workspace/bin/console-read` out of a genaebot
  checkout.
- **remote** (production) — calls the console API beside the gateway on Railway,
  which runs that same script in the container. Set `BOT_API_BASE_URL` and the
  remote adapter takes over; it wins whenever it is configured, so a deployed
  console can never silently fall back to a checkout that is not there.

Both adapters therefore execute **the same script**, which lives in genaebot
rather than here. That is deliberate: the bridge imports the bot's own
`promo_membership`, `promo_caps` and `promo_broadcast` modules rather than
reimplementing them, so a caption preview is the exact text the cron would send,
with the same ref code, the same `wa.me` link and the same daily cap decision.
It is read-only, never contacts the gateway, and never records a cap snapshot.

Switching between them is environment only, so the same build runs locally and
on Vercel:

| `BOT_API_BASE_URL` | Adapter | Reads |
|---|---|---|
| empty | local | `$GENAEBOT_CHECKOUT/workspace/bin/console-read` |
| set | remote | `GET $BOT_API_BASE_URL/internal/console/*` with `BOT_API_TOKEN` |

## Running it

```bash
npm install
npm run dev
```

By default it reads `/home/joseph/projects/genaebot`. Point it elsewhere with
`GENAEBOT_CHECKOUT`.

| Variable | Meaning |
|---|---|
| `GENAEBOT_CHECKOUT` | Path to a genaebot checkout (local adapter) |
| `BOT_API_BASE_URL` | Console API base URL; set this and the remote adapter is used |
| `BOT_API_TOKEN` | Bearer token; must match `CONSOLE_API_TOKEN` on the bot |
| `CONSOLE_WRITES` | `1` arms editing controls; anything else keeps every screen read-only |
| `BOT_WRITE_API_BASE_URL`, `BOT_WRITE_TOKEN` | Normally unset: writes then go to the same bot as the reads |

`npm run dev` binds to `127.0.0.1`. The console has no login, so with writes on,
anyone who can reach the port can edit the bot's config; keeping it to this
machine is what makes that acceptable until there is authentication.

```bash
npm run typecheck
npm test
npm run build
```

## What works today

| Screen | State |
|---|---|
| Overview | Live. Group counts, today's planned ads, slots, per-line reach. |
| Groups | Live. One searchable, filterable table: DMC, members, caps, rotation, expandable notes. |
| Campaigns | Live. Searchable and filterable, with New campaign creation when the companion bot support is deployed. Each row can switch its campaign off and on. |
| Campaign preview | Live. Caption templates can be added, edited and deleted when writes are enabled; saved previews include per-group refs and links. Pictures are shown from the bot's asset index; adding and removing them is not wired up. |
| Schedule | Live. Day timeline with the per-line overlap rule checked. |
| WhatsApp lines | Live account status, QR linking, unlinking, pause and start through the gateway API. |
| Activity | Not wired up. Send history and ad replies live on the Railway volume. |

Writes are off by default. Set `CONSOLE_WRITES=1` in an environment where console
access is controlled. Edits go to the bot's config writer -- the same console API
as the reads, `POST /internal/console/config/<collection>/<id>`, behind the same
token -- which judges every change with the bot's own validator and commits it
with an audit record. A refusal comes back with the bot's reasons. Caption changes
use the bot's canonical Firestore campaign document, rather than keeping separate
copy in the console.

**Two switches have to agree before a control is armed.** The console's own
`CONSOLE_WRITES`, and the bot's report of what it will accept: `overview.writes`
says whether the bot holds a write key and lists, field by field, what its writer
takes (`src/lib/write-capabilities.ts`). A control the bot cannot honour is shown
disabled with the bot's reason -- no write key yet, a field it does not accept
yet, or a bot too old to report any of this -- rather than failing on save. When
the bot reports `affectsProduction: false` (its campaigns still read
membership.json), saving is allowed but every screen warns that it will not change
what is sent.

On a campaign page, **+ Add variant** creates a blank caption, the trash button
removes a variant, and **Save changes** commits the whole set. At least one
nonblank caption must remain. **Reset** discards the draft. Template placeholders
such as `{bot_number}`, `{ref}` and `{ref_link}` remain editable; group-specific
substitutions appear in the saved preview. Automatic refresh preserves drafts,
and a save refuses captions that changed since editing began.

Caption persistence also requires the companion bot update in
[`integrations/genaebot-caption-variants.patch`](integrations/genaebot-caption-variants.patch).
See [`integrations/README.md`](integrations/README.md) for its base revision,
installation and verification. Until a bot with it is deployed, the bot does not
list `captions` among its editable fields, so **Save changes** stays disabled with
that reason and the editor works as a draft.

## Searching and filtering a list

Both list screens wear the same bar: a search box, facet menus, a **Clear
filters** button and a count of what is on screen. The mechanics below are
described once under Groups and hold for Campaigns too; only the facets differ.

### Groups

Eighty-odd groups do not fit on a screen, and most of them have no name — the
jid is the only thing that tells two rows apart. So the Groups screen is one
table with a search box and four filters above it, rather than the three fixed
cards it used to be.

**Search** matches a group's name and its id. Both forms of the jid are
searched, so a jid pasted whole out of a log finds its row and so do the bare
digits printed under the name. A group with no name is searchable as
`unnamed group`, which is the label it actually shows; without that the one
thing on screen would be the one thing you could not look for.

**Status** carries the old partition and the four statuses in one control. The
views — needs a decision, advertising, active in no campaign — are the three
cards, and they ask the question through the same `needsDecision` the sidebar
badge counts, so the two cannot drift apart again. **Line**, **Campaign** and
**Tier** are built from the rows actually on screen. Campaign lists the
campaigns a group is configured for, switched-off ones included and marked
`(off)`: `promos` is intent and deliberately keeps them, so leaving them out
would make their groups unreachable from here. Every filter narrows the last.

Rows needing a decision still sort first, so the flat table reads top to bottom
in the order the three cards did.

**Daily Message Count (DMC)** counts incoming messages over the last 24 hours,
excluding bot posts and system events. **Members** shows the newest WhatsApp
member-total observation. Both appear in configured and Unassigned group rows.
Missing observations display `—`, while an observed zero displays `0`. DMC is
marked **Partial** during the first 24 hours of collection or monitoring gaps;
member counts older than two hours are marked **Stale**. These observations do
not change the activity tier, caps, or campaign targeting.

**More** expands a configured row to show its complete operator note, full ID,
DMC window and coverage, and member observation time. It works in read-only
mode and stays expanded across automatic refreshes. Note editing remains in
the Edit dialog; edit and delete actions stay beside the row.

### Deleting a group

The trash button removes a group from the bot's records: it leaves every
campaign, and the whole record goes into the bot's audit trail in the same
write, so it can be recreated from there. Typing the group's name is the
confirmation, because a group an operator cannot name is a row they have not
read.

On its own, that does not touch WhatsApp. The bot stays in the group, so it
comes back on the same screen under **Unassigned**. Two tick boxes in the dialog
finish the job, both off unless ticked:

- **Also take the bot's number out of the WhatsApp group.** Issued from that
  group's line only. Getting back in needs a new invite, and if another line is
  also a member the group stays listed. A successful leave also drops the group
  from that line's discovery inventory — without that it would reappear under
  Unassigned whether or not the bot had left, because the inventory is never
  pruned on its own.
- **Also clear what the bot has stored for this group.** Forgets which day each
  campaign last posted there. Replies already counted are kept: they are keyed
  by a code derived from the group's ID, they are written by another part of the
  bot, and they are evidence somebody answered an advert.

**The record goes first, then the leave.** Removing the record is the step the
bot can still refuse; leaving is the step that cannot be undone. Doing the
refusable one first means a failed leave costs nothing more than the group
reappearing under Unassigned, which is what a plain delete has always done. The
other way round would leave the bot outside a group it was still configured to
advertise to.

So a leave that does not come off is **not** a failed delete. The record is
gone, and what did not happen is said above the table rather than inside the
deleted row — the row disappears with the next refresh, which would take the
warning with it. It stays there until dismissed. A leave the bot has queued but
not confirmed is reported as unconfirmed, not as a failure, so nobody retries
something that already happened.

Both boxes need the companion bot update described in
[integrations/README.md](integrations/README.md#leaving-a-group-and-clearing-its-records).
Against an older bot they show disabled with the bot's own reason, and the
delete works exactly as before.

Real observations need the companion bot collector and bridge update described
in [integrations/README.md](integrations/README.md#group-activity-and-member-counts).
Older bots continue working with unavailable metrics.

**Filtering happens in the browser**, over the payload the page already holds.
The read bridge takes no query parameter but `date` and returns every group
anyway, so there is nothing to gain by asking the bot to narrow them and a
keystroke that waited on the network to answer would be worse. Automatic
refreshes bring new rows in under whatever filter is set, and never disturb a
half-typed search.

The view lives in the URL (`?q=…&status=…&line=…&campaign=…&tier=…`), so a
filtered table can be reloaded, bookmarked or pasted to someone else, and it is
already filtered on the first paint rather than flashing the full list. The URL
is written a quarter-second after you stop typing and replaces its history
entry rather than stacking one per keystroke, so **Back** leaves the page
instead of walking backwards through a search. A hand-edited or truncated one
falls back to showing everything rather than an empty table, and a line or
campaign whose groups have since gone stays in its menu, marked, instead of the
control silently switching to a different filter.

### Campaigns

The Campaigns table carries the same bar, with the facets that mean something
for a campaign. **Search** matches the title, the id beneath it and the ref
prefix, so `BH`, `borehole` and `borehole-drilling-promo` all reach the same
row. **Status** is the useful one: running, switched off, failing to load, or
running but pointed at no groups. **Line** matches a campaign that posts
through that line among several, unlike a group, which has exactly one.
**Cadence** separates the campaigns with weekly-only groups, and **Slot**
buckets them by the part of the day their cron fires in — including the
campaigns whose time cannot be read, which the Schedule screen drops and this
one must not.

Nothing here reorders the table: the bridge sends campaigns in the order they
run through the day, filtering preserves it, and `daySlots` is no help because
it leaves out exactly the switched-off and unscheduled rows this screen exists
to show.

With writes enabled each row gains an **Actions** cell: the campaign's own
on/off switch, and a **Delete** that is deliberately shown switched off.

The switch is the same one the campaign's page carries, asking the same
question in the same words -- stopping a campaign should not require opening
it first. A campaign posts only when this switch is on *and* a cron is
registered for it, and the confirm dialog says so when there is no cron.

**Delete is shown, disabled, with the reason.** A campaign cannot be deleted
from here, and the button says why rather than being left out. The bot refuses
it outright: its writer removes groups and nothing else, and the companion
campaign-creation update does not change that. For a campaign declared in the
manifest the refusal is the whole story -- it is a script, a cron and an
installer run rather than a record, and deleting its Firestore document would
not take the row off this table, because the row comes from the manifest and
the document only carries the operator's switch. A campaign created from the
console is a record and could be removed one day, but until the bot will, the
button stays switched off rather than offering something that would be refused.

Turning a campaign off is the operation that actually stops it, which is why
the switch sits beside the delete rather than behind it.

With ten campaigns the search box earns less than it does on Groups. The
status views are the point, which is why the **Needs attention** card now links
to them: "Campaigns with no groups" opens the table already filtered to the
rows it counted. Each linked item and the view it opens share one predicate, so
the number in the card and the rows on screen cannot disagree. The three group
items in that card link the same way. Items with no view that isolates them —
the Firestore comparison, the config source — stay plain text.

## Automatically discovered groups

The Groups page includes an **Unassigned** section when the bot provides
`discoveredGroups` and `groupDiscovery`. It shows the full group name and JID,
every observed account and the last-seen time. These rows are metadata
observations, not advertising configuration; no campaigns or write controls are
attached automatically. Already configured groups remain in the existing tables.

The bot scans through its existing WhatsApp connections after connect and
hourly, saving observations on its persistent volume. The console only reads
that saved inventory. Waiting, stale, failed and disabled discovery are shown
beside retained observations, which are not proof of present membership. The
section is hidden for older bot versions that omit the extra fields. This works
with either the local or remote read adapter and needs no console write access.

## Campaign group drafts

The campaign’s **Where it goes** table supports browser-saved drafts. **Add groups**
selects existing active groups from the Groups list; **Remove** asks for confirmation
before removing an assignment from this campaign’s draft. **Pause** keeps the
assignment but marks it paused for this campaign only, and **Resume** restores
participation under the normal cap and cadence rules. These controls are available
even when backend writes are disabled.

Changes save automatically in this browser, separately for each campaign, and
survive navigation, reloads and automatic refreshes. **Reset draft** discards local
changes and restores current live targets. Open tabs synchronize saved drafts and
resets for the same campaign. Draft additions that are no longer known
or active are removed with a notice. If browser storage is unavailable, edits stay
in memory and the table reports that they cannot persist.

**Drafts do not change the bot or its configuration.** The statistics above the
table stay live, and added rows have no calculated posting preview. Applying group
assignments or pauses to real sends needs a future backend integration.

## Campaign pictures

Every advert is a caption **and** a picture, so a campaign page lists its whole
picture set in the order the bot declares it, and each row on the campaigns list
carries a thumbnail. Where a campaign declares several, the bot posts one of them
per day chosen by the date, so a group never sees the same one twice running; the
console names that order and deliberately does not say which picture goes out
today, because picking it is `promo_broadcast`'s job and not something to
reimplement here.

**The pictures themselves come from the bot's asset index.** The images live in a
Cloudflare R2 bucket and the index of them in Firestore, so the bot reports each
picture's public URL beside the basename its `post_ad.py` declares, and a tile
loads that URL directly. Picture previews use public URLs and never proxy the bytes. Campaign creation
uses a server-side bucket-scoped upload token to sign direct browser uploads: the URL is composed on the bot from one
environment variable, so putting a custom domain in front of the bucket moves the
console with it and changes nothing here. The keys are content-addressed, so a URL
never changes meaning and the browser can cache it indefinitely.

Two lists meet on that screen and are reported separately rather than merged,
because they are two different claims and the day they disagree is worth seeing:
what the campaign's post script declares, which is the tile list, and what the
index says, which is where the pixels come from. A tile whose name the index does
not mention keeps its unavailable state, and the card says how many — that is a
picture the campaign declares and the bucket has never had.

The screen stays honest about two further things rather than implying otherwise:

- **Before the R2 cutover the tile is not what goes out.** While the bot's picture
  source is `repo` it attaches the copy baked into its container, and the card says
  so and names the directory that copy is in. The two are the same bytes while the
  index matches the checkout.
- **Add and remove are shown but switched off.** A campaign's pictures come from
  the `IMAGE` / `IMAGE_PATH` constants in its own `post_ad.py`, not from the
  record the console can write, and the write bridge has no field for them. The
  controls carry that reason in prose and as hover text.

An index the bot could not read costs the pictures and nothing else: the tiles fall
back to naming their file and the card repeats the bot's own account of what went
wrong, rather than implying the campaigns have no pictures. Picture *writes* still
wait on a companion bot update, in the same way caption writes waited on their
patch.

While the console is visible and online, it refreshes the current page and sidebar
60 seconds after each completed refresh. Checks pause in hidden tabs or while
offline, and resume with an immediate refresh when visible and online again.
Each tab checks independently, using the same server-side adapters as page loads;
gateway credentials stay on the server. Existing bot errors are retried on the
next check. Activity remains a placeholder.

## Campaign read failures

Campaign details, previews, group membership and write capabilities load
independently. A failed read leaves the rest of the campaign page visible.
Previously loaded sections stay on screen, marked out of date with the time
they last loaded and a **Retry** button. When a section has never loaded, it
shows an unavailable placeholder. Unsaved captions and browser group drafts
survive failed refreshes; saves that need unavailable data stay disabled until
recovery. Failed membership reads never remove draft additions. Retained data
lives only in the mounted campaign view and is cleared when navigating to a
different campaign or reloading the browser.

The remote adapter limits reads to two simultaneous requests per console server
process, including sidebar overview reads, and shares identical requests only
while they are in flight. It retries HTTP 503 reads up to twice, respecting
`Retry-After` with a maximum five-second delay (or one and two seconds when the
header is absent or invalid). Each fetch has a fifteen-second timeout. This
reduces collisions with the gateway's two-process bridge limit; independent
console processes can still encounter a busy gateway. Writes are never retried
automatically. Bot routes and payloads remain unchanged.

## WhatsApp account controls

Set `BOT_API_BASE_URL` and `BOT_API_TOKEN` to the live console API, even when
running the UI locally. Deploy the companion `genaebot` backend changes first;
the checkout-only `console-read` adapter cannot operate WhatsApp accounts. The
backend uses its pinned OpenClaw 2026.9.9 SDK and existing gateway credentials.
Browser requests go through same-origin Next.js routes; tokens remain server-side.
Account mutations also respect `CONSOLE_WRITES=1`; live status remains available
when writes are disabled. Permanent removal and console sign-in are deferred.

- **Link** adds a new account or pairs an existing unlinked one by QR. New
  accounts have replies disabled and no group assignments. To replace an
  existing saved login, Unlink first, then Link.
- **Unlink** stops sends/replies and clears the saved WhatsApp login after
  confirmation. Configuration, assignments, contact references and history stay.
- **Pause** stops sends/replies and retains login. It survives gateway restart.
- **Start** reactivates a paused account without a QR. An invalid login needs Link.

Existing reply policies are preserved. `REPLIES_DISABLED=1` blocks starting the
default account; after removing it, use Start explicitly. Messages already
submitted to WhatsApp may still arrive after stopping an account.

Status is checked every five seconds and pairing every two seconds, only while
visible and online. Pairing sessions last up to three minutes. Closing the dialog
stops checks; Continue linking reopens the attempt. Failed reads replace connection
badges with unavailable status and disable actions until a successful refresh.
Configured membership counts load separately and remain distinct from delivery
or socket state. Overnight standby stays authoritative (wake 05:45 Africa/Algiers).

For the isolated worktree, install dependencies and run `npm run dev` from that
worktree. Do not start a second bot gateway against the same WhatsApp credentials.
Tests cover simulated scans and the pinned gateway SDK; a real QR scan requires
the account owner's phone.

## Conventions

Next.js 15 App Router, React 19, TypeScript, vitest. Plain CSS with design
tokens on `:root` in [`app/globals.css`](app/globals.css), matching `webetu-web`
rather than introducing Tailwind. Light mode only.

## Create a campaign

Use **New campaign** on Campaigns. Enter a name, upload one or more JPEG/PNG
pictures (up to 6 MiB each), add caption variants, choose a time and daily or
weekday recurrence, and select active groups. Groups keep their existing
WhatsApp lines, so the same campaign can post through several lines.

Campaigns start switched off unless **Enabled** is selected. **Advanced settings**
is optional and collapsed: timezone (Africa/Harare by default), tracking and
contact overrides, per-group weekdays/pauses, notes, timeout and failure alerts.
Leaving it untouched creates a complete campaign with working defaults. Picture
previews can be reordered; one picture rotates per scheduled run. The form
survives automatic refreshes and errors. If a save outcome is unknown, editing
locks and **Retry original request** checks the exact submitted payload;
**Check campaign** opens its detail page if creation already completed. Initial
definite refusals and upload failures keep the form editable. A saved campaign
with an unverified schedule is shown as pending while the bot retries automatically.

Creation requires the companion bot patch, live Firestore/R2 modes, console
writes enabled and server-side R2 upload configuration. Older bots show a clear
unavailable reason while the form remains usable as an in-memory draft. See
[integrations/README.md](integrations/README.md#campaign-creation) for installation,
CORS, API contracts and verification. No new authentication or deployment is
introduced by this feature.
