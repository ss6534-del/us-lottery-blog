"""Guard weekly example sets and source-grounded comparisons."""

from datetime import date, timedelta
import json
from pathlib import Path
import unittest

from weekly_model import make_weekly_report, _rules


HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "games.json").read_text(encoding="utf-8"))
WEEK = date(2026, 11, 23)
SEEDS = {"us": "powerball", "ca": "lotto-649", "uk": "lotto",
         "au": "saturday-lotto", "in": "karunya", "kr": "lotto-645", "jp": "loto6"}


def selected(country):
    return next(game for game in CONFIG["games"]
                if game["country"] == country and game["gameKey"] == SEEDS[country])


def archive(game, count=5):
    if game["country"] == "in":
        return [{"date": (WEEK + timedelta(days=5 - i * 7)).isoformat(),
                 "drawNo": f"KR-{780-i}",
                 "sourceUrl": f"https://www.lotteryagent.kerala.gov.in/results/{i}",
                 "ticket": {"series": "AB", "number": f"{431120+i:06}"}}
                for i in range(count)]
    main_count, main_max, extra_count, extra_max, same_pool = _rules(game)
    records = []
    for i in range(count):
        main = sorted({(n + i * 3 - 1) % main_max + 1 for n in range(1, main_count + 1)})
        extra_pool = [n for n in range(1, extra_max + 1)
                      if not same_pool or n not in main]
        records.append({"date": (WEEK + timedelta(days=4 - i * 7)).isoformat(),
                        "sourceUrl": f"https://operator.example/results/{i}",
                        "rounds": [{"main": main, "extra": extra_pool[:extra_count]}]})
    return records


class WeeklyModelTest(unittest.TestCase):
    def test_six_country_ball_examples_are_stable_and_legal(self):
        for country in ("us", "ca", "uk", "au", "kr", "jp"):
            with self.subTest(country=country):
                game = selected(country)
                edition = CONFIG["editions"][country]
                draws = archive(game)
                report = make_weekly_report(game, edition, draws, WEEK)
                self.assertEqual(report, make_weekly_report(game, edition, draws, WEEK))
                self.assertEqual(report["weeklyId"], f"atlas-{country}-weekly-2026-11-23")
                self.assertEqual(report["stats"]["count"], 5)
                self.assertEqual(report["stats"]["overlap"]["numbers"],
                                 sorted(set(draws[0]["rounds"][0]["main"]) &
                                        set(draws[1]["rounds"][0]["main"])))
                main_count, main_max, extra_count, extra_max, same_pool = _rules(game)
                self.assertEqual(len(report["exampleSets"]), 3)
                for line in report["exampleSets"]:
                    self.assertEqual(len(line["main"]), main_count)
                    self.assertEqual(len(set(line["main"])), main_count)
                    self.assertTrue(all(1 <= n <= main_max for n in line["main"]))
                    self.assertEqual(len(line["extra"]), extra_count)
                    self.assertTrue(all(1 <= n <= extra_max for n in line["extra"]))
                    if same_pool:
                        self.assertFalse(set(line["main"]) & set(line["extra"]))

    def test_kerala_uses_published_tickets_without_made_up_recommendations(self):
        game = selected("in")
        draws = archive(game)
        report = make_weekly_report(game, CONFIG["editions"]["in"], draws, WEEK)
        self.assertEqual(report["exampleSets"], [])
        self.assertEqual(report["chart"]["ticketRows"][0]["number"], "431120")
        self.assertEqual(report["stats"]["ticketSuffixes"][0]["last4"], "1120")

    def test_canadian_french_and_duplicate_source_links(self):
        game = selected("ca")
        draws = archive(game)
        draws[1]["sourceUrl"] = draws[0]["sourceUrl"]
        report = make_weekly_report(game, CONFIG["editions"]["ca"], draws, WEEK)
        self.assertIn("Bilan de la semaine", report["fr"]["title"])
        self.assertEqual(len(report["sources"]), 4)
        self.assertEqual(len(report["fr"]["sources"]), 4)

    def test_rejects_stale_or_incomplete_results(self):
        game = selected("kr")
        rows = archive(game)
        with self.assertRaisesRegex(ValueError, "Not enough"):
            make_weekly_report(game, CONFIG["editions"]["kr"], rows[:2], WEEK)
        rows[0]["date"] = "2026-11-12"
        with self.assertRaises(ValueError):
            make_weekly_report(game, CONFIG["editions"]["kr"], rows, WEEK)


if __name__ == "__main__":
    unittest.main()
