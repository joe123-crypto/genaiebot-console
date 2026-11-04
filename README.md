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
| Campaign preview | Live. Every caption variant as sent, per-group ref and link. |
| Schedule | Live. Day timeline with the per-line overlap rule checked. |
| WhatsApp lines | Partial. Configured membership only — live socket status needs the console API. |
| Activity | Not wired up. Send history and ad replies live on the Railway volume. |

Everything is read-only. Writes (approving a group, editing a campaign, moving a
slot) need the console API and the runtime overlay described in the plan.

## Conventions

Next.js 15 App Router, React 19, TypeScript, vitest. Plain CSS with design
tokens on `:root` in [`app/globals.css`](app/globals.css), matching `webetu-web`
rather than introducing Tailwind. Light mode only.
