"""Official news collection keeps only verifiable, dated publisher links."""

from datetime import date
from html import escape
import json
from unittest import TestCase
from unittest.mock import patch

import weekly_news as news


class NewsParsingTests(TestCase):
    def test_powerball_same_week_only_and_no_fabricated_links(self):
        def card(day, title, href):
            return (f'<a href="{href}" class="card col-12"><div class="card-body">'
                    f'<div class="card-title lh-sm">{day}</div>'
                    f'<div class="card-text lh-sm">{title}</div></div></a>')
        html = (
            card("November 30, 2026", "Powerball next week", "/future") +
            card("November 25, 2026", "Powerball result notice", "/recent") +
            card("November 24, 2026", "Powerball player announcement", "/earlier") +
            card("November 18, 2026", "Powerball old story", "/old")
        )
        with patch.object(news, "_download", return_value=html):
            rows = news.collect_news("us", date(2026, 11, 23), date(2026, 11, 29))
        self.assertEqual([item["date"] for item in rows], ["2026-11-25", "2026-11-24"])
        self.assertEqual(rows[0]["url"], "https://www.powerball.com/recent")
        self.assertEqual(rows[0]["language"], "en")

    def test_wclc_and_allwyn_parse_publisher_cards(self):
        ca = ('<div class="mediaWinnerReleaseInnerContainer"><div class="mediaWinnerReleaseDetails">'
              '<div class="mediaWinnerReleasePubDate"> Fri Nov 20 10:00:00 CST 2026 </div>'
              '<div class="mediaWinnerReleaseTitle"><a href="/media-centre/recent-winner-releases/'
              'winner-releases/lotto-649-win.htm">LOTTO 6/49 win!</a></div></div></div>')
        uk = ('<div role="listitem" class="w-dyn-item"><p class="l-featured_heading">'
              'National Lottery announces a draw update</p><div class="l-post_upper">'
              '<div class="l-featured_post-date">November 24, 2026</div></div>'
              '<a href="/insights/national-lottery-draw-update" class="l-button">Read more</a></div>')
        self.assertEqual(news._wclc(ca)[0]["date"], "2026-11-20")
        self.assertEqual(news._allwyn(uk)[0]["url"],
                         "https://www.allwyn.co.uk/insights/national-lottery-draw-update")

    def test_lotterywest_astro_tiles_use_official_display_date(self):
        tile = [0, {"blogPostType": [0, "mediaCenter"], "slug": [0, "lotto-news"],
                    "title": [0, "Saturday Lotto news"],
                    "excerpt": [0, "26 November 2026"],
                    "publishedAt": [0, "2026-11-27T02:20:11Z"]}]
        props = escape(json.dumps({"tiles": [1, [tile]]}), quote=True)
        html = f'<astro-island props="{props}"></astro-island>'
        with patch.object(news, "_download", return_value=html):
            rows = news.collect_news("au", date(2026, 11, 23), date(2026, 11, 29))
        self.assertEqual(rows[0]["date"], "2026-11-26")
        self.assertEqual(rows[0]["url"],
                         "https://www.lotterywest.wa.gov.au/lotterywest/media-centre/lotto-news")

    def test_dhlottery_uses_dated_official_title_search(self):
        document = json.dumps({"data": {"list": [
            {"pstNo": 2167, "pstTtlCn": "로또 추첨 현장 공개", "pstRegYmd": "20261124"},
            {"pstNo": 2166, "pstTtlCn": "이전 보도자료", "pstRegYmd": "20261119"},
        ]}}, ensure_ascii=False)
        with patch.object(news, "_download", return_value=document):
            rows = news.collect_news("kr", date(2026, 11, 23), date(2026, 11, 29))
        self.assertEqual(len(rows), 1)
        self.assertIn("srchKind=title", rows[0]["url"])
        self.assertEqual(rows[0]["language"], "ko")

    def test_kerala_prd_and_japan_news_use_original_language_and_dates(self):
        kerala = json.dumps([{
            "date": "2026-11-24T10:15:00",
            "title": {"rendered": "സംസ്ഥാന ഭാഗ്യക്കുറി നറുക്കെടുപ്പ് അറിയിപ്പ്"},
            "link": "https://prdlive.kerala.gov.in/news/408999",
        }], ensure_ascii=False)
        with patch.object(news, "_download", return_value=kerala):
            items = news.collect_news("in", date(2026, 11, 23), date(2026, 11, 29))
        self.assertEqual(items[0]["language"], "ml")
        self.assertEqual(items[0]["url"], "https://prdlive.kerala.gov.in/news/408999")

        japan = ('<a href="/news/recent/?newsId=261124" class="m_list2_linkArrow m_linkArrow">'
                 '<span class="u_spHide u_ib">2026/11/24</span>'
                 '<p class="m_thumbSet_row u_spHide">ロト6のお知らせ</p></a>')
        with patch.object(news, "_download", return_value=japan):
            items = news.collect_news("jp", date(2026, 11, 23), date(2026, 11, 29))
        self.assertEqual(items[0]["date"], "2026-11-24")
        self.assertEqual(items[0]["url"],
                         "https://www.takarakuji-official.jp/news/recent/?newsId=261124")

        featured = ('<div class="m_card3"><a href="/news/recent/?newsId=261123">'
                    '<img alt="ロト7最新情報"><p class="m_card3_date">2026/11/23</p>'
                    '<p class="m_card3_ttl">ロト7最新情報</p></a></div>')
        with patch.object(news, "_download", return_value=featured + japan):
            items = news.collect_news("jp", date(2026, 11, 23), date(2026, 11, 29))
        self.assertEqual(len(items), 2)
        self.assertEqual(items[1]["url"],
                         "https://www.takarakuji-official.jp/news/recent/?newsId=261123")

    def test_readable_official_list_with_no_same_week_story_is_empty(self):
        old = ('<a href="/old-powerball" class="card"><div class="card-title">'
               'November 08, 2026</div><div class="card-text">Powerball older story</div></a>')
        with patch.object(news, "_download", return_value=old):
            self.assertEqual(news.collect_news("us", date(2026, 11, 23),
                                               date(2026, 11, 29)), [])

    def test_cross_site_and_broken_source_do_not_publish_as_empty(self):
        hostile = ('<a href="https://other.example/story" class="card">'
                   '<div class="card-title">November 24, 2026</div>'
                   '<div class="card-text">Powerball result</div></a>')
        with patch.object(news, "_download", return_value=hostile):
            with self.assertRaises(ValueError):
                news.collect_news("us", date(2026, 11, 23), date(2026, 11, 29))
        with patch.object(news, "_download", return_value="<h1>Latest News</h1>"):
            with self.assertRaises(ValueError):
                news.collect_news("us", date(2026, 11, 23), date(2026, 11, 29))
