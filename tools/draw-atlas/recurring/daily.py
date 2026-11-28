"""Collect completed draws and publish each new Draw Atlas report once."""

import argparse
from datetime import date, timedelta
from importlib import import_module
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from tempfile import TemporaryDirectory
from xml.etree import ElementTree as ET

import discover_asia
import discover_west
from blogger_api import BloggerClient, BloggerError
from write_report import make_report


HERE = Path(__file__).resolve().parent
FEED = import_module("feed-check")


def checkpoint(game, keys):
    prefix = f"atlas-{game['country']}-{game['gameKey']}-"
    result = game["after"], game.get("afterSlot", "")
    for key in keys:
        if not key.startswith(prefix):
            continue
        match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})(?:-(midday|evening))?", key[len(prefix):])
        if match:
            candidate = match[1], match[2] or ""
            if position(candidate) > position(result):
                result = candidate
    return result


def position(stamp):
    day, slot = stamp
    return day, {"": 0, "midday": 1, "evening": 2}[slot]


def stamp(event):
    return event["date"], event.get("drawSlot", "")


def identity(game, event):
    key = f"atlas-{game['country']}-{game['gameKey']}-{event['date']}"
    return key + ("-" + event["drawSlot"] if event.get("drawSlot") else "")


def render(report):
    with TemporaryDirectory() as folder:
        work = Path(folder)
        draft, target = work / "draw.json", work / "draw.xml"
        draft.write_text(json.dumps(report, ensure_ascii=False), encoding="utf-8")
        process = subprocess.run(["node", str(HERE.parent / "build-report-import.js"), "--batch",
                                  str(target), str(draft)], capture_output=True, text=True, encoding="utf-8")
        if process.returncode:
            raise ValueError(process.stderr.strip())
        entry = ET.parse(target).find("{http://www.w3.org/2005/Atom}entry")
        return entry.findtext("{http://www.w3.org/2005/Atom}content")


def process_game(game, edition, existing, client, summary):
    cursor = checkpoint(game, existing)
    base = (game["after"], game.get("afterSlot", ""))
    # Ask for extra days to have comparisons and to catch late, out-of-order source updates.
    since = date.fromisoformat(cursor[0]) - timedelta(days=28 if game["country"] == "in" else 74)
    revisit = (date.fromisoformat(cursor[0]) - timedelta(days=10)).isoformat()
    west = game["country"] not in {"in", "jp", "kr"}
    archive = discover_west if west else discover_asia
    rows = archive.history(game, since)
    stamps = [stamp(row) for row in rows]
    if cursor not in stamps or stamps != sorted(set(stamps), key=position):
        raise ValueError(f"Archive does not cover the last confirmed draw {cursor[0]} {cursor[1]} or has conflicting identities")
    for i, event in enumerate(rows):
        key = identity(game, event)
        if event["date"] < revisit or position(stamps[i]) <= position(base) or key in existing:
            continue
        if i == 0:
            raise ValueError(f"Missing previous draw for {key}")
        count = 2 if game["country"] == "in" else 10
        comparison = list(reversed(rows[max(0, i-count+1):i+1]))
        if game["country"] == "in":
            comparison = [discover_asia.hydrate(game, r) for r in comparison]
        report = make_report(game, edition, comparison)
        body = render(report)
        if client is None:
            summary["preview"].append(key)
            print("Preview:", key)
        else:
            saved = client.publish_once(key, report["title"], report["labels"], body)
            existing.add(key)
            summary[saved["outcome"]].append(key)
            print(saved["outcome"], key, saved["url"])


def run(publish):
    config = json.loads((HERE / "games.json").read_text(encoding="utf-8"))
    client = BloggerClient.from_env(paced_publishing=True) if publish else None
    existing = set(client.inventory() if client else FEED.inventory(None)[0])
    summary = {"preview": [], "published": [], "existing": [], "errors": []}
    for game in config["games"]:
        try:
            process_game(game, config["editions"][game["country"]], existing, client, summary)
        except (KeyError, IndexError, OSError, RuntimeError, TypeError, ValueError, subprocess.SubprocessError) as error:
            label = game["country"] + "/" + game["gameKey"]
            summary["errors"].append(label)
            print(f"{label}: {type(error).__name__}: {error}", file=sys.stderr)
    totals = ", ".join(f"{k}={len(v)}" for k, v in summary.items())
    print(totals)
    if os.getenv("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as out:
            print("## Draw Atlas\n", totals, file=out)
            for category, values in summary.items():
                if values:
                    print(f"\n**{category}**\n", ", ".join(values), file=out)
    return int(bool(summary["errors"]))


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--publish", action="store_true", help="Publish to the configured Blogger blog")
    try:
        sys.exit(run(cli.parse_args().publish))
    except (BloggerError, OSError, ValueError, RuntimeError) as error:
        sys.exit(str(error))
