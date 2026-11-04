#!/usr/bin/env python3
"""Read-only bridge between the console and a genaebot checkout.

Everything here imports genaebot's own modules rather than reimplementing them,
so the console can never disagree with what the bot will actually send. The
campaign copy, tracking prefixes and image rotations are read straight out of
each campaign's module; the group table, caps and rotation come from
``promo_membership`` and ``promo_caps``; the declared schedule comes from
``deploy/promo-crons.json``.

Nothing in this file writes, and nothing contacts the gateway.

Usage:
  genaebot_read.py --checkout DIR groups [--date YYYY-MM-DD]
  genaebot_read.py --checkout DIR campaigns
  genaebot_read.py --checkout DIR preview SLUG [--date YYYY-MM-DD]
  genaebot_read.py --checkout DIR overview [--date YYYY-MM-DD]

Prints one JSON document on stdout. Std-lib only.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from datetime import date
from pathlib import Path


class BridgeError(Exception):
    pass


def _load_bot_modules(checkout: Path):
    """Put genaebot's workspace/lib on the path and import the three helpers.

    They are std-lib only by contract, so importing them here is safe and costs
    nothing beyond reading membership.json when asked.
    """
    lib = checkout / "workspace" / "lib"
    if not lib.is_dir():
        raise BridgeError(f"no genaebot checkout at {checkout} (missing {lib})")
    if str(lib) not in sys.path:
        sys.path.insert(0, str(lib))
    try:
        import promo_membership
        import promo_caps
        import promo_broadcast
    except ImportError as exc:  # pragma: no cover - environment problem
        raise BridgeError(f"could not import genaebot helpers from {lib}: {exc}") from exc
    return promo_membership, promo_caps, promo_broadcast


def _parse_day(raw: str | None) -> date:
    if not raw:
        return date.today()
    try:
        return date(*(int(part) for part in raw.split("-")))
    except (TypeError, ValueError) as exc:
        raise BridgeError(f"--date wants YYYY-MM-DD, got {raw!r}") from exc


def _membership(checkout: Path, promo_membership):
    return promo_membership.load(promo_membership.default_path(str(checkout / "workspace")))


# --------------------------------------------------------------------------
# groups
# --------------------------------------------------------------------------

def _group_rows(checkout: Path, day: date):
    """One record per known group: the membership fields plus today's cap and
    which campaigns today's rotation hands that allowance to. This mirrors
    ``workspace/bin/list-groups --json --caps`` and stays read-only, so it never
    records a cap snapshot."""
    promo_membership, promo_caps, _ = _load_bot_modules(checkout)
    membership = _membership(checkout, promo_membership)
    groups = promo_membership.groups(membership)
    decisions = promo_caps.plan(membership, list(groups), day=day, record=False)

    rows = []
    for jid, entry in groups.items():
        decision = decisions.get(jid) or {}
        weekly = entry.get("weekly") or {}
        allowed = decision.get("allowed")
        rows.append(
            {
                "jid": jid,
                "name": entry.get("name"),
                "source": entry.get("source"),
                "status": promo_membership.status_of(entry),
                "activity": promo_membership.activity_of(membership, entry),
                "account": promo_membership.account_of(entry),
                "dailyCapOverride": entry.get("daily_cap"),
                "promos": list(entry.get("promos") or []),
                "weekly": {key: [str(day) for day in value] for key, value in weekly.items()},
                "note": entry.get("note"),
                "cap": decision.get("cap"),
                "replyScore": decision.get("score"),
                # ``allowed`` is None for a group with no cap decision, which
                # means every targeted promo may post; show that as the full set.
                "allowedToday": sorted(allowed) if allowed is not None else list(entry.get("promos") or []),
            }
        )
    return rows


def _accounts(membership, promo_membership):
    numbers = promo_membership.account_numbers(membership) or {}
    contact = None
    defaults = membership.get("defaults") or {}
    contact = defaults.get("contact_account")
    return [
        {"id": account, "number": number, "isContact": account == contact}
        for account, number in sorted(numbers.items())
    ]


# --------------------------------------------------------------------------
# campaigns
# --------------------------------------------------------------------------

def _manifest(checkout: Path):
    path = checkout / "deploy" / "promo-crons.json"
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError as exc:
        raise BridgeError(f"missing cron manifest at {path}") from exc


def _container_path_to_checkout(script: str, checkout: Path) -> Path:
    """Manifest scripts are absolute container paths; map them onto the checkout."""
    marker = "/workspace/"
    index = script.find(marker)
    if index == -1:
        return Path(script)
    return checkout / "workspace" / script[index + len(marker):]


def _import_campaign_module(path: Path):
    """Import a campaign's post script to read its copy and tracking config.

    Every campaign module guards its entry point with ``if __name__ ==
    "__main__"``, so importing one runs no sends and touches no state.
    """
    spec = importlib.util.spec_from_file_location(f"_campaign_{path.parent.name}", path)
    if spec is None or spec.loader is None:
        raise BridgeError(f"cannot import campaign module {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return [value]


def _campaign_records(checkout: Path, day: date):
    promo_membership, _, _ = _load_bot_modules(checkout)
    membership = _membership(checkout, promo_membership)
    manifest = _manifest(checkout)

    records = []
    for entry in manifest.get("promos", []):
        slug = entry["slug"]
        script = _container_path_to_checkout(entry["script"], checkout)
        captions: list[str] = []
        tracking: dict = {}
        images: list[str] = []
        error = None
        try:
            module = _import_campaign_module(script)
            captions = [str(text) for text in _as_list(getattr(module, "POST_TEXTS", None))]
            tracking = dict(getattr(module, "TRACKING", {}) or {})
            raw_images = getattr(module, "IMAGE", None)
            if raw_images is None:
                raw_images = getattr(module, "IMAGE_PATH", None)
            images = [os.path.basename(str(image)) for image in _as_list(raw_images)]
        except Exception as exc:  # the console must still list a broken campaign
            error = f"{type(exc).__name__}: {exc}"

        daily_jids, weekly_jids = promo_membership.groups_for_promo(membership, slug)
        all_jids = list(daily_jids) + list(weekly_jids)
        accounts: dict[str, int] = {}
        for jid in all_jids:
            account = promo_membership.account_of(promo_membership.groups(membership).get(jid))
            accounts[account] = accounts.get(account, 0) + 1

        hour, minute = _cron_time(entry.get("cron", ""))
        records.append(
            {
                "slug": slug,
                "name": entry.get("name"),
                "cron": entry.get("cron"),
                "hour": hour,
                "minute": minute,
                "timezone": entry.get("tz"),
                "installer": entry.get("installer"),
                "script": str(script),
                "failureAlertTo": entry.get("failureAlertTo"),
                "legacyNames": list(entry.get("legacyNames") or []),
                "timeoutSeconds": manifest.get("timeoutSeconds"),
                "captions": captions,
                "tracking": tracking,
                "images": images,
                "targetCount": len(all_jids),
                "weeklyCount": len(weekly_jids),
                "accounts": accounts,
                "source": "git",
                "error": error,
            }
        )
    records.sort(key=lambda row: (row["hour"] if row["hour"] is not None else 99, row["minute"] or 0))
    return records


def _cron_time(expression: str):
    parts = (expression or "").split()
    if len(parts) < 2:
        return None, None
    try:
        return int(parts[1]), int(parts[0])
    except ValueError:
        return None, None


# --------------------------------------------------------------------------
# preview
# --------------------------------------------------------------------------

def _preview(checkout: Path, slug: str, day: date):
    """Per-group caption variant, ref code and link for one campaign.

    Uses the engine's own ``caption_for``/``ref_code`` helpers so the preview is
    the same text the cron would send.
    """
    promo_membership, promo_caps, promo_broadcast = _load_bot_modules(checkout)
    membership = _membership(checkout, promo_membership)
    manifest = _manifest(checkout)

    entry = next((row for row in manifest.get("promos", []) if row["slug"] == slug), None)
    if entry is None:
        raise BridgeError(f"unknown campaign {slug!r}")

    module = _import_campaign_module(_container_path_to_checkout(entry["script"], checkout))
    captions = [str(text) for text in _as_list(getattr(module, "POST_TEXTS", None))]
    tracking = dict(getattr(module, "TRACKING", {}) or {})

    daily_jids, weekly_jids = promo_membership.groups_for_promo(membership, slug)
    all_jids = list(daily_jids) + list(weekly_jids)
    decisions = promo_caps.plan(
        membership, list(promo_membership.groups(membership)), day=day, record=False
    )
    numbers = promo_membership.account_numbers(membership) or {}
    contact_account = (membership.get("defaults") or {}).get("contact_account")
    entries = promo_membership.groups(membership)

    rows = []
    for jid in all_jids:
        group = entries.get(jid, {})
        decision = decisions.get(jid) or {}
        allowed = decision.get("allowed")
        account = promo_membership.account_of(group)
        # The advertised number is the configured contact line when one is set,
        # otherwise whichever line actually posts to this group.
        bot_number = numbers.get(contact_account) if contact_account else None
        bot_number = bot_number or numbers.get(account)

        # ``caption_for``'s ``allowed`` is the group's posting WEEKDAYS (so a
        # weekly group's variants still step by one per actual post), not the
        # caps decision. Daily groups pass None.
        weekdays = [
            promo_broadcast._parse_weekday(token)
            for token in (weekly_jids.get(jid) or [])
        ]
        weekdays = sorted({day_index for day_index in weekdays if day_index is not None}) or None

        variant, rendered, ref = None, None, None
        if captions:
            variant, rendered, ref = promo_broadcast.caption_for(
                jid, captions, day=day, allowed=weekdays,
                tracking=tracking, bot_number=bot_number,
            )

        rows.append(
            {
                "jid": jid,
                "name": group.get("name"),
                "account": account,
                "contactNumber": tracking.get("number") or bot_number,
                "ref": ref,
                "variant": variant,
                "caption": rendered,
                "cap": decision.get("cap"),
                "sendsToday": allowed is None or slug in allowed,
                "allowedToday": sorted(allowed) if allowed is not None else [],
                "weekly": [str(day_token) for day_token in (weekly_jids.get(jid) or [])],
            }
        )
    return {"slug": slug, "captions": captions, "tracking": tracking, "groups": rows}


# --------------------------------------------------------------------------
# overview
# --------------------------------------------------------------------------

def _overview(checkout: Path, day: date):
    promo_membership, _, _ = _load_bot_modules(checkout)
    membership = _membership(checkout, promo_membership)
    groups = promo_membership.groups(membership)

    by_status: dict[str, int] = {}
    for entry in groups.values():
        status = entry.get("status", "active")
        by_status[status] = by_status.get(status, 0) + 1

    campaigns = _campaign_records(checkout, day)
    rows = _group_rows(checkout, day)
    planned = sum(len(row["allowedToday"]) for row in rows if row["status"] == "active")

    return {
        "date": day.isoformat(),
        "groupsByStatus": by_status,
        "groupTotal": len(groups),
        "campaignTotal": len(campaigns),
        "plannedSendsToday": planned,
        "accounts": _accounts(membership, promo_membership),
        "capsEnabled": bool((membership.get("defaults") or {}).get("caps_enabled")),
        "campaigns": campaigns,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkout", required=True)
    parser.add_argument("command", choices=["groups", "campaigns", "preview", "overview"])
    parser.add_argument("slug", nargs="?")
    parser.add_argument("--date")
    args = parser.parse_args(argv)

    checkout = Path(args.checkout).expanduser().resolve()
    try:
        day = _parse_day(args.date)
        if args.command == "groups":
            payload = {"date": day.isoformat(), "groups": _group_rows(checkout, day)}
        elif args.command == "campaigns":
            payload = {"date": day.isoformat(), "campaigns": _campaign_records(checkout, day)}
        elif args.command == "preview":
            if not args.slug:
                raise BridgeError("preview needs a campaign slug")
            payload = _preview(checkout, args.slug, day)
        else:
            payload = _overview(checkout, day)
    except BridgeError as exc:
        json.dump({"error": str(exc)}, sys.stdout)
        sys.stdout.write("\n")
        return 1

    json.dump(payload, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
