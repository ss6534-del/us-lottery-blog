"""The weekly publisher must never create a second post for the same week."""

from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
import io
from unittest import TestCase
from unittest.mock import Mock, patch

import weekly


NOW = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)


def report(game, edition, draws, week_start):
    country = game["country"]
    return {"weeklyId": f"atlas-{country}-weekly-{week_start}",
            "title": f"{country} weekly briefing", "labels": [country.upper(), "Weekly brief"]}


def html(article):
    return f'<div data-draw-atlas-id="{article["weeklyId"]}">Briefing</div>'


class WeeklyRunnerTests(TestCase):
    def setUp(self):
        self.client = Mock()
        self.client.inventory.return_value = {}
        self.client.publish_once.side_effect = lambda key, *_: {
            "outcome": "published", "url": "https://goldnum.blogspot.com/example.html"}

    def execute(self, now=NOW, failing=None, news=None):
        def history(game, *_):
            if game["country"] == failing:
                raise ValueError("source unavailable")
            return [{"date": "2026-11-25"}]

        with patch.object(weekly.BloggerClient, "from_env", return_value=self.client), \
                patch.object(weekly, "recent_history", side_effect=history), \
                patch.object(weekly, "make_weekly_report", side_effect=report), \
                patch.object(weekly, "collect_news", return_value=news or []), \
                patch.object(weekly, "render_weekly", side_effect=html) as renderer, \
                patch.dict(weekly.os.environ, {"GITHUB_STEP_SUMMARY": ""}), \
                redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
            result = weekly.run(True, now=now)
            self.rendered_reports = [call.args[0] for call in renderer.call_args_list]
            return result

    def test_one_per_country_and_existing_weeks_are_skipped(self):
        self.assertEqual(self.execute(), 0)
        first = [call.args[0] for call in self.client.publish_once.call_args_list]
        self.assertEqual(len(first), 7)
        self.assertEqual(len(set(first)), 7)
        self.assertTrue(all(key.endswith("-2026-11-16") for key in first))

        self.client.inventory.return_value = {key: {} for key in first}
        self.assertEqual(self.execute(), 0)
        self.assertEqual(self.client.publish_once.call_count, 7)

    def test_one_source_failure_does_not_stop_other_countries(self):
        self.assertEqual(self.execute(failing="in"), 1)
        published = [call.args[0] for call in self.client.publish_once.call_args_list]
        self.assertEqual(len(published), 6)
        self.assertTrue(all("-in-" not in key for key in published))

    def test_official_news_is_passed_to_the_published_article(self):
        item = {"title": "Official draw update", "url": "https://example.org/news",
                "date": "2026-11-25", "language": "en"}
        self.assertEqual(self.execute(news=[item]), 0)
        self.assertEqual(len(self.rendered_reports), 7)
        self.assertTrue(all(article["newsItems"] == [item] for article in self.rendered_reports))

    def test_monday_publishes_the_completed_previous_week(self):
        monday = datetime(2026, 11, 30, 12, tzinfo=timezone.utc)
        self.assertEqual(self.execute(now=monday), 0)
        first = [call.args[0] for call in self.client.publish_once.call_args_list]
        self.assertEqual(len(first), 7)
        self.assertTrue(all(key.endswith("-2026-11-23") for key in first))

    def test_week_boundary_uses_each_countrys_local_time(self):
        instant = datetime(2026, 12, 1, 0, 30, tzinfo=timezone.utc)
        self.assertEqual(weekly.local_week(instant, "America/New_York")[0].weekday(), 0)
        self.assertEqual(weekly.local_week(instant, "Asia/Tokyo")[0].weekday(), 1)
