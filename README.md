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

```bash
npm run typecheck
npm test
npm run build
```

## What works today

| Screen | State |
|---|---|
| Overview | Live. Group counts, today's planned ads, slots, per-line reach. |
| Groups | Live. One searchable, filterable table: caps, rotation, operator notes. |
| Campaigns | Live. Searchable and filterable; slot, reach, line split, ref prefix, copy. |
| Campaign preview | Live. Caption templates can be added, edited and deleted when writes are enabled; saved previews include per-group refs and links. Pictures are listed, not yet shown or editable. |
| Schedule | Live. Day timeline with the per-line overlap rule checked. |
| WhatsApp lines | Live account status, QR linking, unlinking, pause and start through the gateway API. |
| Activity | Not wired up. Send history and ad replies live on the Railway volume. |

Writes are off by default. Set `CONSOLE_WRITES=1` in an environment where console
access is controlled, and configure the bot's write service to enable editing.
Caption changes use the bot's canonical Firestore campaign document, rather than
keeping separate copy in the console.

On a campaign page, **+ Add variant** creates a blank caption, the trash button
removes a variant, and **Save changes** commits the whole set. At least one
nonblank caption must remain. **Reset** discards the draft. Template placeholders
such as `{bot_number}`, `{ref}` and `{ref_link}` remain editable; group-specific
substitutions appear in the saved preview. Automatic refresh preserves drafts,
and a save refuses captions that changed since editing began.

Caption persistence also requires the companion bot update in
[`integrations/genaebot-caption-variants.patch`](integrations/genaebot-caption-variants.patch).
See [`integrations/README.md`](integrations/README.md) for its base revision,
installation and verification. Deploy that update before enabling caption writes.

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

With ten campaigns the search box earns less than it does on Groups. The
status views are the point, which is why the **Needs attention** card now links
to them: "Campaigns with no groups" opens the table already filtered to the
rows it counted. Each linked item and the view it opens share one predicate, so
the number in the card and the rows on screen cannot disagree. The three group
items in that card link the same way. Items with no view that isolates them —
the Firestore comparison, the config source — stay plain text.

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

Two parts are deliberately missing, and the screen says so rather than implying
otherwise:

- **No picture is displayed yet.** The read bridge reports basenames only
  (`borehole-1.jpg`), and neither adapter serves image files, so every tile names
  its file and points at the directory it lives in. The same tile covers a
  picture that has gone missing from the checkout.
- **Add and remove are shown but switched off.** A campaign's pictures come from
  the `IMAGE` / `IMAGE_PATH` constants in its own `post_ad.py`, not from the
  record the console can write, and the write bridge has no field for them. The
  controls carry that reason in prose and as hover text.

Both wait on a companion bot update — a route that serves a campaign's picture
files, and a picture field the bot reads from its campaign document — in the same
way caption writes waited on their patch.

While the console is visible and online, it refreshes the current page and sidebar
60 seconds after each completed refresh. Checks pause in hidden tabs or while
offline, and resume with an immediate refresh when visible and online again.
Each tab checks independently, using the same server-side adapters as page loads;
gateway credentials stay on the server. Existing bot errors are retried on the
next check. Activity remains a placeholder.

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
