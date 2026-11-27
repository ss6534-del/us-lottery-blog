"""Protect the weekly Blogger article's identity, languages, and ticket format."""

from importlib import import_module
from unittest import TestCase

from test_weekly_model import CONFIG, SEEDS, WEEK, archive, selected
from weekly_html import render_weekly
from weekly_model import make_weekly_report


DrawMarkers = import_module("feed-check").DrawMarkers


def brief(country):
    game = selected(country)
    return make_weekly_report(game, CONFIG["editions"][country], archive(game), WEEK)


class WeeklyHtmlTests(TestCase):
    def test_all_editions_have_one_identity_sources_and_country_style(self):
        for country in SEEDS:
            with self.subTest(country=country):
                article = brief(country)
                html = render_weekly(article)
                markers = DrawMarkers()
                markers.feed(html)
                markers.close()
                self.assertEqual(markers.ids, {article["weeklyId"]})
                self.assertIn('class="atlas-report atlas-weekly', html)
                self.assertIn('class="atlas-report-sources"', html)
                self.assertIn('class="atlas-report-draws', html)
                self.assertIn(f'href="{article["sources"][0]["url"]}"', html)

    def test_canada_has_one_french_and_one_english_body(self):
        html = render_weekly(brief("ca"))
        self.assertEqual(html.count("atlas-lang-en"), 1)
        self.assertEqual(html.count("atlas-lang-fr"), 1)
        self.assertEqual(html.count('class="atlas-report-title"'), 1)
        self.assertIn("Bilan de la semaine", html)

    def test_india_displays_verified_tickets_without_example_purchases(self):
        article = brief("in")
        html = render_weekly(article)
        self.assertIn('class="atlas-report-draws atlas-ticket-draws"', html)
        self.assertIn("431120", html)
        self.assertIn("…1120", html)
        self.assertNotIn("atlas-weekly-examples", html)
        article["exampleSets"] = [{"main": [1, 2, 3, 4, 5, 6]}]
        with self.assertRaisesRegex(ValueError, "invented Kerala ticket"):
            render_weekly(article)

    def test_rejects_unverified_link_schemes(self):
        article = brief("kr")
        article["sources"] = [{"label": "Unsafe source", "url": "http://example.com"}]
        with self.assertRaisesRegex(ValueError, "HTTPS source"):
            render_weekly(article)

    def test_official_news_is_sourced_escaped_and_omitted_when_empty(self):
        article = brief("kr")
        self.assertNotIn("atlas-weekly-news", render_weekly(article))
        article["newsItems"] = [{
            "date": "2026-11-26", "title": "공지 <script>alert(1)</script>",
            "url": "https://www.dhlottery.co.kr/news?id=1&part=2",
            "summary": "추첨 <결과> 안내", "language": "ko",
        }]
        html = render_weekly(article)
        self.assertEqual(html.count('class="atlas-weekly-news-item"'), 1)
        self.assertIn("복권 공식 소식", html)
        self.assertIn('<time datetime="2026-11-26">2026-11-26</time>', html)
        self.assertIn('href="https://www.dhlottery.co.kr/news?id=1&amp;part=2"', html)
        self.assertIn("공지 &lt;script&gt;alert(1)&lt;/script&gt;", html)
        self.assertIn("추첨 &lt;결과&gt; 안내", html)
        self.assertNotIn("<script>", html)

    def test_canada_keeps_official_original_language_in_french_view(self):
        article = brief("ca")
        article["newsItems"] = [{
            "date": "2026-11-25", "title": "Lottery bulletin",
            "url": "https://www.lotto.ca/en/news", "language": "en",
        }]
        html = render_weekly(article)
        self.assertEqual(html.count("Lottery bulletin"), 2)
        self.assertEqual(html.count('class="atlas-weekly-news-item" lang="en"'), 2)
        self.assertIn("Official lottery news", html)
        self.assertIn("Actualités officielles des loteries", html)

    def test_news_requires_real_https_link_and_published_date(self):
        article = brief("us")
        article["newsItems"] = [{
            "date": "2026-11-25", "title": "Official notice",
            "url": "http://powerball.com/notice", "language": "en",
        }]
        with self.assertRaisesRegex(ValueError, "HTTPS official news link"):
            render_weekly(article)
        article["newsItems"][0]["url"] = "https://powerball.com/notice"
        article["newsItems"][0]["date"] = "2026-11-33"
        with self.assertRaises(ValueError):
            render_weekly(article)
