"""Collect dated lottery announcements from official publisher pages.

Only the publisher's headline, date and direct link are retained. No article
body is copied, summarized or generated. A source-layout failure raises so the
weekly runner can retry instead of publishing a silently incomplete brief.
"""

from datetime import date, datetime
from html import unescape
from html.parser import HTMLParser
import json
import re
from urllib.parse import quote, urljoin, urlsplit
from urllib.request import Request, urlopen


SOURCES = {
    "us": ("https://www.powerball.com/latest-news", "www.powerball.com", "en"),
    "ca": ("https://www.wclc.com/media-centre/recent-winner-releases.htm", "www.wclc.com", "en"),
    "uk": ("https://www.allwyn.co.uk/news", "www.allwyn.co.uk", "en"),
    "au": ("https://www.lotterywest.wa.gov.au/lotterywest/media-centre", "www.lotterywest.wa.gov.au", "en"),
    "in": ("https://prdlive.kerala.gov.in/wp-json/wp/v2/posts?per_page=100&orderby=date&order=desc&search=" +
           quote("ഭാഗ്യക്കുറി"), "prdlive.kerala.gov.in", "ml"),
    "kr": ("https://www.dhlottery.co.kr/hpns/mediapbrlPageList.do?srchKind=&srchContent=&pageNum=1&recordCountPerPage=10", "www.dhlottery.co.kr", "ko"),
    "jp": ("https://www.takarakuji-official.jp/news/top.html", "www.takarakuji-official.jp", "ja"),
}
TOPICS = {
    "us": re.compile(r"powerball|draw|lottery", re.I),
    "ca": re.compile(r"lotto\s*(?:6/49|max)|daily\s+grand|lottery", re.I),
    "uk": re.compile(r"national\s+lottery|lotto|euromillions|thunderball|set\s+for\s+life", re.I),
    "au": re.compile(r"lotto|lottery|powerball|millionaire|winning|winner|draw|scratch", re.I),
    "in": re.compile(r"ഭാഗ്യക്കുറി|സംസ്ഥാന\s+ലോട്ടറി"),
    "jp": re.compile(r"ロト|ミニロト"),
}
MAX_RESPONSE = 2_000_000


def _plain(value):
    text = re.sub(r"<[^>]+>", " ", value)
    return re.sub(r"\s+", " ", unescape(text)).strip()


def _date(value, style):
    if style == "ca":
        match = re.fullmatch(r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Za-z]{3})\s+(\d{1,2})\s+\d\d:\d\d:\d\d\s+[A-Z]{2,4}\s+(\d{4})", value.strip())
        if not match:
            raise ValueError("Invalid WCLC publication date")
        return datetime.strptime(" ".join(match.groups()), "%b %d %Y").date()
    formats = {"us": "%B %d, %Y", "uk": "%B %d, %Y",
               "au": "%d %B %Y", "kr": "%Y%m%d", "jp": "%Y/%m/%d",
               "in": "%d-%m-%Y"}
    return datetime.strptime(value.strip(), formats[style]).date()


def _official_link(country, href):
    base, host, _ = SOURCES[country]
    url = urljoin(base, unescape(href))
    parts = urlsplit(url)
    if (parts.scheme != "https" or parts.hostname != host or parts.port is not None
            or parts.username or parts.password):
        raise ValueError(f"Unexpected {country} news link")
    return url


def _download(country):
    url, host, _ = SOURCES[country]
    request = Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; DrawAtlasNews/1.0)",
        "Accept": "text/html,application/json;q=0.9",
    })
    with urlopen(request, timeout=15) as response:
        target = urlsplit(response.geturl())
        if (response.status != 200 or target.scheme != "https" or target.hostname != host
                or target.port is not None):
            raise ValueError(f"Unexpected {country} news response")
        body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            raise ValueError(f"{country} news response exceeded the size limit")
        return body.decode("utf-8-sig")


def _item(country, title, href, published):
    title = _plain(title)
    if not 4 <= len(title) <= 250:
        raise ValueError(f"Invalid {country} news headline")
    return {"title": title, "url": _official_link(country, href),
            "date": published.isoformat(), "language": SOURCES[country][2]}


def _powerball(document):
    cards = re.finditer(r'<a\b(?=[^>]*\bclass="[^"]*\bcard\b)[^>]*\bhref="([^"]+)"[^>]*>(.*?)</a>', document, re.S | re.I)
    rows = []
    for card in cards:
        body = card[2]
        day = re.search(r'<div\b[^>]*\bclass="[^"]*\bcard-title\b[^"]*"[^>]*>(.*?)</div>', body, re.S)
        heading = re.search(r'<div\b[^>]*\bclass="[^"]*\bcard-text\b[^"]*"[^>]*>(.*?)</div>', body, re.S)
        if day and heading:
            rows.append(_item("us", heading[1], card[1], _date(_plain(day[1]), "us")))
    if not rows:
        raise ValueError("Powerball news cards were not found")
    return rows


def _wclc(document):
    pieces = re.split(r'<div\s+class="mediaWinnerReleaseInnerContainer"', document, flags=re.I)[1:]
    rows = []
    for piece in pieces:
        day = re.search(r'<div\s+class="mediaWinnerReleasePubDate">\s*([^<]+)', piece)
        heading = re.search(r'<div\s+class="mediaWinnerReleaseTitle">\s*<a\s+href="([^"]+)">(.*?)</a>', piece, re.S)
        if day and heading:
            rows.append(_item("ca", heading[2], heading[1], _date(_plain(day[1]), "ca")))
    if not rows:
        raise ValueError("WCLC news releases were not found")
    return rows


def _allwyn(document):
    expression = (r'<p\s+class="l-featured_heading">(.*?)</p>.{0,2000}?'
                  r'<div\s+class="l-featured_post-date">(.*?)</div>.{0,2000}?'
                  r'<a\s+href="(/insights/[^"]+)"')
    rows = [_item("uk", match[1], match[3], _date(_plain(match[2]), "uk"))
            for match in re.finditer(expression, document, re.S)]
    if not rows:
        raise ValueError("Allwyn news cards were not found")
    return rows


class _AstroProps(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tiles = []

    def handle_starttag(self, tag, attrs):
        if tag != "astro-island":
            return
        props = dict(attrs).get("props", "")
        if not props.startswith('{"tiles":'):
            return
        parsed = json.loads(props)
        tiles = parsed.get("tiles")
        if isinstance(tiles, list) and len(tiles) == 2 and isinstance(tiles[1], list):
            self.tiles.extend(tiles[1])


def _lotterywest(document):
    parser = _AstroProps()
    parser.feed(document)
    rows = []
    for wrapper in parser.tiles:
        try:
            entry = wrapper[1]
            value = lambda field: entry[field][1]
            if value("blogPostType") != "mediaCenter":
                continue
            slug = value("slug")
            if not isinstance(slug, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug):
                raise ValueError("Invalid Lotterywest article slug")
            url = f"https://www.lotterywest.wa.gov.au/lotterywest/media-centre/{slug}"
            rows.append(_item("au", value("title"), url, _date(value("excerpt"), "au")))
        except (KeyError, IndexError, TypeError) as error:
            raise ValueError("Invalid Lotterywest news tile") from error
    if not rows:
        raise ValueError("Lotterywest media releases were not found")
    return rows


def _dhlottery(document):
    payload = json.loads(document)
    if payload.get("resultCode") not in (None, 0, "0", "SUCCESS", "200"):
        raise ValueError("Donghaeng Lottery news API returned an error")
    records = payload.get("data", {}).get("list")
    if not isinstance(records, list):
        raise ValueError("Donghaeng Lottery news list is missing")
    rows = []
    for entry in records:
        title = entry["pstTtlCn"]
        number = entry["pstNo"]
        if not str(number).isdigit():
            raise ValueError("Invalid Donghaeng Lottery article ID")
        link = ("https://www.dhlottery.co.kr/hpns/mediapbrlListView?page=1"
                "&srchKind=title&srchContent=" + quote(title, safe=""))
        rows.append(_item("kr", title, link, _date(str(entry["pstRegYmd"]), "kr")))
    return rows


def _kerala_prd(document):
    records = json.loads(document)
    if not isinstance(records, list):
        raise ValueError("Kerala PRD news API returned no article list")
    if len(records) >= 100:
        raise ValueError("Kerala PRD news list may be truncated")
    rows = []
    for entry in records:
        rows.append(_item("in", entry["title"]["rendered"], entry["link"],
                          date.fromisoformat(entry["date"][:10])))
    return rows


def _japan(document):
    rows = []
    featured = re.search(r'<div\s+class="m_card3">\s*<a\s+href="([^"]+)">(.*?)</a>',
                         document, re.S)
    if featured:
        day = re.search(r'<p\s+class="m_card3_date">(\d{4}/\d{2}/\d{2})</p>', featured[2])
        heading = re.search(r'<img\b[^>]*\balt="([^"]+)"', featured[2])
        if day and heading:
            rows.append(_item("jp", heading[1], featured[1], _date(day[1], "jp")))
    cards = re.finditer(
        r'<a\b(?=[^>]*class="[^"]*m_list2_linkArrow\b)[^>]*href="([^"]+)"[^>]*>(.*?)</a>',
        document, re.S)
    for card in cards:
        day = re.search(r'<span\s+class="u_spHide u_ib">(\d{4}/\d{2}/\d{2})</span>', card[2])
        heading = re.search(r'<p\s+class="m_thumbSet_row u_spHide">(.*?)</p>', card[2], re.S)
        if day and heading:
            rows.append(_item("jp", heading[1], card[1], _date(day[1], "jp")))
    if not rows:
        raise ValueError("Japan official lottery news cards were not found")
    return rows


PARSERS = {"us": _powerball, "ca": _wclc, "uk": _allwyn,
           "au": _lotterywest, "in": _kerala_prd,
           "kr": _dhlottery, "jp": _japan}


def collect_news(country, week_start, week_end):
    """Return at most two dated official headlines from the completed local week.

    The caller is responsible for selecting the country's calendar week. A
    source with no matching headline returns []; a broken source raises.
    """
    if (country not in SOURCES or not isinstance(week_start, date)
            or not isinstance(week_end, date) or week_end < week_start):
        raise ValueError("Invalid news country or date window")
    rows = PARSERS[country](_download(country))
    relevant = []
    for row in rows:
        day = date.fromisoformat(row["date"])
        if week_start <= day <= week_end and (country not in TOPICS or TOPICS[country].search(row["title"])):
            relevant.append(row)
    relevant.sort(key=lambda row: (row["date"], row["title"]), reverse=True)
    unique, seen = [], set()
    for row in relevant:
        if row["url"] not in seen:
            unique.append(row)
            seen.add(row["url"])
        if len(unique) == 2:
            break
    return unique
