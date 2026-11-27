"""Publish one verified weekly Draw Atlas briefing per country."""

import argparse
from datetime import datetime, timedelta, timezone
from importlib import import_module
import json
import os
from pathlib import Path
import sys
from zoneinfo import ZoneInfo

import discover_asia
import discover_west
from blogger_api import BloggerClient, BloggerError
from weekly_html import render_weekly
from weekly_model import make_weekly_report
from weekly_news import collect_news


HERE = Path(__file__).resolve().parent
FEED = import_module("feed-check")
COUNTRIES = tuple(FEED.SEED_GAMES)


def local_week(now, zone):
    """Use each edition's calendar week, independent of the runner's timezone."""
    today = now.astimezone(ZoneInfo(zone)).date()
    return today, today - timedelta(days=today.weekday())


def recent_history(game, week_start, week_end):
    country = game["country"]
    since = week_start - timedelta(days=21 if country == "in" else 42)
    archive = discover_asia if country in {"in", "kr", "jp"} else discover_west
    rows = archive.history(game, since)
    rows = [row for row in rows if row["date"] <= week_end.isoformat()]
    if not rows or rows != sorted(rows, key=lambda row: (row["date"], row.get("drawSlot", ""))):
        raise ValueError(f"Incomplete or unsorted verified history for {country}")
    if len({(row["date"], row.get("drawSlot", "")) for row in rows}) != len(rows):
        raise ValueError(f"Duplicate verified draw in {country} history")
    latest = list(reversed(rows[-(6 if country == "in" else 10):]))
    if country == "in":
        latest = [discover_asia.hydrate(game, row) for row in latest]
    return latest


def run(publish=False, now=None):
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("The weekly runner requires a timezone-aware time")
    config = json.loads((HERE / "games.json").read_text(encoding="utf-8"))
    games = {(item["country"], item["gameKey"]): item for item in config["games"]}
    client = BloggerClient.from_env() if publish else None
    existing = set(client.inventory() if client else FEED.inventory(None)[0])
    summary = {"preview": [], "published": [], "existing": [], "errors": []}

    for country in COUNTRIES:
        try:
            edition = config["editions"][country]
            _, current_week = local_week(now, edition["timeZone"])
            # Publish the completed Monday–Sunday week so later announcements
            # cannot be omitted from a Tuesday article. Daily runs retry failures.
            week_start = current_week - timedelta(days=7)
            week_end = current_week - timedelta(days=1)
            key = f"atlas-{country}-weekly-{week_start.isoformat()}"
            if key in existing:
                summary["existing"].append(key)
                continue
            game = games[(country, FEED.SEED_GAMES[country])]
            draws = recent_history(game, week_start, week_end)
            report = make_weekly_report(game, edition, draws, week_start)
            report["newsItems"] = collect_news(country, week_start, week_end)
            if report["weeklyId"] != key or report["labels"][0] != country.upper():
                raise ValueError(f"Weekly article identity differs from {key}")
            body = render_weekly(report)
            markers = FEED.DrawMarkers()
            markers.feed(body)
            markers.close()
            if markers.ids != {key}:
                raise ValueError(f"Weekly article marker differs from {key}")
            if client is None:
                summary["preview"].append(key)
                print("Preview:", key, report["title"], f"official_news={len(report['newsItems'])}")
            else:
                saved = client.publish_once(key, report["title"], report["labels"], body)
                existing.add(key)
                summary[saved["outcome"]].append(key)
                print(saved["outcome"], key, saved["url"])
        except (BloggerError, KeyError, IndexError, OSError, RuntimeError, TypeError, ValueError) as error:
            summary["errors"].append(country)
            print(f"{country}: {type(error).__name__}: {error}", file=sys.stderr)

    totals = ", ".join(f"{name}={len(items)}" for name, items in summary.items())
    print(totals)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as output:
            print("## Draw Atlas weekly\n", totals, file=output)
            for name, values in summary.items():
                if values:
                    print(f"\n**{name}**\n", ", ".join(values), file=output)
    return int(bool(summary["errors"]))


if __name__ == "__main__":
    # Windows terminals may default to a code page without Malayalam or Japanese.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(errors="backslashreplace")
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--publish", action="store_true", help="Publish one weekly briefing per country")
    try:
        sys.exit(run(cli.parse_args().publish))
    except (BloggerError, OSError, ValueError, RuntimeError) as error:
        sys.exit(str(error))
