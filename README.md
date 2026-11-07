# Genaie Console

An operator UI for the Genaie WhatsApp bot (`../genaebot`). It covers the parts
OpenClaw does not provide or exposes too technically: which groups the bot is
in and what should advertise where, what each campaign will actually send, and
how the day's slots fit together.

It is **not** a reimplementation of OpenClaw's own control UI.

## How it reads state

The console keeps no database and no copy of anything. Every screen is rendered
from genaebot's own state, through one of two adapters in
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
| Groups | Live. Review queue, advertising table, caps, rotation, operator notes. |
| Campaigns | Live. All ten with slot, reach, line split, ref prefix, copy. |
| Campaign preview | Live. Caption templates can be added, edited and deleted when writes are enabled; saved previews include per-group refs and links. |
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
