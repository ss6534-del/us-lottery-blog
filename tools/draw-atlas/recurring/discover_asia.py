"""Discover released Asian draws from the three publishers' public result tables."""

from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from html import unescape
from io import BytesIO
import json
import re
from urllib.error import HTTPError
from urllib.request import Request, urlopen


KERALA = 'https://www.lotteryagent.kerala.gov.in/result/public/'
KERALA_PDFS = 'https://www.lotteryagent.kerala.gov.in/results/'
KERALA_CALENDAR = 'https://keralalotterycheck.com'
KOREA = 'https://www.dhlottery.co.kr'
JAPAN = 'https://takarakuji.rakuten.co.jp/backnumber/'
JP_BALLS = {'loto6': (6, 1, 43), 'loto7': (7, 2, 37), 'mini': (5, 1, 31)}
KERALA_CODES = {'BT', 'SS', 'DL', 'KN', 'SK', 'KR', 'SM'}


@lru_cache(maxsize=64)
def _get(url):
    headers = {'User-Agent': 'DrawAtlas/1.0'}
    if url.startswith(KOREA + '/'):
        headers.update({'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
                        'Referer': KOREA + '/lt645/result'})
    with urlopen(Request(url, headers=headers), timeout=25) as response:
        if response.geturl().split('/')[2] != url.split('/')[2]:
            raise ValueError('Unexpected result publisher redirect: ' + url)
        return response.read().decode(response.headers.get_content_charset() or 'utf-8')


def _text(markup):
    return ' '.join(unescape(re.sub(r'<[^>]+>', ' ', markup)).split())


def _cells(row):
    return [_text(x) for x in re.findall(r'<t[dh]\b[^>]*>(.*?)</t[dh]\s*>', row, re.I | re.S)]


def _balls(values, count, maximum):
    if len(values) != count or len(set(values)) != count or not all(1 <= n <= maximum for n in values):
        raise ValueError('Incomplete or invalid winning balls in the result source')
    return values


def _event(day, draw, source):
    return {'date': day.isoformat(), 'drawNo': str(draw), 'sourceUrl': source}


def _japan_month(archive, month, today):
    url = f'{JAPAN}{archive}/{month:%Y%m}/'
    try:
        raw = _get(url)
    except HTTPError as error:
        if error.code != 404 or month != today.replace(day=1):
            raise
        # The monthly page may not exist until the first draw. Check the live
        # results page itself before treating the new month as having no draws.
        url = f'{JAPAN}{archive}/'
        raw = _get(url)
    tables = re.findall(r'<table\b([^>]*)>(.*?)</table\s*>', raw, re.I | re.S)
    result = []
    main_count, bonus_count, maximum = JP_BALLS[archive]
    verified_dates = []
    for attributes, table in tables:
        if 'tblNumberGuid' not in attributes:
            continue
        rows = [_cells(row) for row in re.findall(r'<tr\b[^>]*>(.*?)</tr\s*>', table, re.I | re.S)]
        fields = {r[0]: r[1:] for r in rows if r}
        draw = re.fullmatch(r'第(\d+)回', fields['回号'][0])
        day = datetime.strptime(fields['抽せん日'][0], '%Y/%m/%d').date()
        if day > today:
            continue
        if not draw or int(draw[1]) < 1:
            raise ValueError('Unexpected Rakuten draw identity: ' + url)
        main = next((values for label, values in fields.items() if label.startswith('本数字')), [])
        cells = [s for s in [*main, *fields.get('ボーナス数字', [])] if s]
        ordinary = [int(s) for s in cells if re.fullmatch(r'[0-9]+', s)]
        bonus = [int(s[1:-1]) for s in cells if re.fullmatch(r'\([0-9]+\)', s)]
        if len(ordinary) != main_count or len(bonus) != bonus_count:
            raise ValueError('Incomplete winning numbers: ' + url)
        _balls(ordinary + bonus, main_count + bonus_count, maximum)
        verified_dates.append(day)
        if day.replace(day=1) == month:
            result.append({**_event(day, int(draw[1]), url),
                           'rounds': [{'main': ordinary, 'extra': bonus}]})
        elif url.endswith(f'/{month:%Y%m}/'):
            raise ValueError('Unexpected draw month: ' + url)
    if not verified_dates:
        raise ValueError('No confirmed draw table in Rakuten monthly archive: ' + url)
    if not result and max(verified_dates) < month - timedelta(days=7):
        raise ValueError('Live Rakuten page is too old to confirm month rollover: ' + url)
    return result


def _japan(archive, since, today):
    month = since.replace(day=1)
    events = []
    while month <= today:
        events.extend(_japan_month(archive, month, today))
        month = (month + timedelta(days=32)).replace(day=1)
    return events


@lru_cache(maxsize=1)
def _kerala_index():
    raw = _get(KERALA)
    table = re.search(r'<table\b[^>]*\bid=["\']example["\'][^>]*>(.*?)</table\s*>', raw, re.I | re.S)
    if not table:
        raise ValueError('Kerala result index has no public result table')
    result = []
    # LOTIS omits opening tr tags in its tbody but closes every result row.
    for row in re.split(r'</tr\s*>', table[1], flags=re.I):
        cells = _cells(row)
        if not cells or not cells[0].isdigit():
            continue
        if len(cells) < 4:
            raise ValueError('Incomplete Kerala result row')
        code = re.search(r'\(([A-Z]+)-(\d+)\)\s*$', cells[1])
        day = datetime.strptime(cells[2], '%d-%m-%Y').date()
        # Sale schedules have dates too. Only rows linking a published result qualify.
        ready = re.search(r'<a\b[^>]*(?:data-item-id=["\'][\da-fA-F-]{36}["\']|href=["\'][^"\']*/results/[^"\']+["\'])[^>]*>', row, re.I)
        if not ready or 'download' not in cells[3].lower():
            raise ValueError('Kerala published result link missing for ' + cells[1])
        if code and code[1] in KERALA_CODES:
            link = re.search(r'(?:data-item-id=["\']|/results/)([0-9a-f-]{36})', ready[0], re.I)
            if not link or not re.fullmatch(r'[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}', link[1], re.I):
                raise ValueError('Missing Kerala result document identity for ' + cells[1])
            result.append((day, code[1], f'{code[1]}-{code[2]}', link[1].lower()))
    if not result:
        raise ValueError('No Kerala weekly results in the official table')
    return result


def _india(code, since, today):
    rows = [r for r in _kerala_index() if r[0] <= today]
    if not rows or not any(r[1] == code for r in rows):
        raise ValueError('Kerala archive does not show the requested weekly game')
    if since < min(r[0] for r in rows):
        raise ValueError('Manual backfill needed: requested start precedes the Kerala public index')
    return [{**_event(day, draw, KERALA), 'documentId': document}
            for day, prefix, draw, document in rows if prefix == code]


@lru_cache(maxsize=64)
def _kerala_ticket(day, draw, document_id):
    # This public calendar links to the department's actual PDF. Never use
    # numbers transcribed by the calendar, or construct unlisted download links.
    lookup = '/en/results/' + day
    paths = set(re.findall(r'href=["\'](' + re.escape(lookup) + r'/[a-z0-9-]+-'
                           + re.escape(draw.lower()) + r')["\']', _get(KERALA_CALENDAR + lookup)))
    if len(paths) != 1:
        raise ValueError('Published Kerala PDF listing not available for ' + draw)
    detail = _get(KERALA_CALENDAR + paths.pop())
    published = {unescape(s) for s in re.findall(r'href=["\']([^"\']+)["\']', detail)}
    pdf_url = KERALA_PDFS + document_id
    if pdf_url not in published:
        raise ValueError('Public PDF and official Kerala index do not agree for ' + draw)
    from pdfminer.high_level import extract_text
    with urlopen(Request(pdf_url, headers={'User-Agent': 'DrawAtlas/1.0'}), timeout=25) as response:
        if response.geturl() != pdf_url:
            raise ValueError('Unexpected Kerala PDF redirect')
        raw = response.read(4_000_001)
    if not raw.startswith(b'%PDF-') or len(raw) > 4_000_000:
        raise ValueError('Invalid Kerala result PDF for ' + draw)
    page = ' '.join(extract_text(BytesIO(raw), page_numbers=[0], maxpages=1).split())
    identity = re.search(r'LOTTERY\s+NO\.?\s*([A-Z]+-\d+)\s*(?:st|nd|rd|th)?\s+DRAW\s+held on\s*[:-]+\s*(\d{2}/\d{2}/\d{4})', page, re.I)
    if not identity or identity[1] != draw or datetime.strptime(identity[2], '%d/%m/%Y').date().isoformat() != day:
        raise ValueError('Kerala PDF draw or date differs from the official index for ' + draw)
    prize = re.search(r'\b1st\s+Prize\b(.*?)(?:\bCons(?:olation)?\.?\s+Prize|\b2nd\s+Prize)', page, re.I)
    tickets = re.findall(r'\b([A-Z]{2})\s+([0-9]{6})\b', prize[1]) if prize else []
    if len(tickets) != 1:
        raise ValueError('Expected one six-digit first-prize ticket for ' + draw)
    return pdf_url, tickets[0]


def hydrate(game, event):
    """Load the official first-prize PDF only for needed Kerala comparisons."""
    if game['country'] != 'in':
        return event
    url, (series, number) = _kerala_ticket(event['date'], event['drawNo'], event['documentId'])
    return {**event, 'sourceUrl': url, 'ticket': {'series': series, 'number': number}}


def _korean_page(url, today, home=False):
    data = json.loads(_get(url))['data']
    rows = data['result']['pstLtEpstInfo']['lt645'] if home else data['list']
    events = {}
    for row in rows:
        day = datetime.strptime(row['ltRflYmd'], '%Y%m%d').date()
        if day > today:
            continue
        draw = int(row['ltEpsd'])
        if draw < 1:
            raise ValueError('Invalid Donghaeng draw number')
        balls = _balls([int(row[k]) for k in [*(f'tm{i}WnNo' for i in range(1, 7)), 'bnsWnNo']], 7, 45)
        events[draw] = {**_event(day, draw, f'{KOREA}/lt645/result?ltEpsd={draw}'),
                        'rounds': [{'main': balls[:6], 'extra': balls[6:]}]}
    if not events:
        raise ValueError('Official Donghaeng data contains no confirmed draw')
    return events


def _korea(since, today):
    events = _korean_page(KOREA + '/selectMainInfo.do', today, home=True)
    while min(r['date'] for r in events.values()) > since.isoformat() and min(events) > 1:
        older = min(events) - 1
        url = f'{KOREA}/lt645/selectPstLt645InfoNew.do?srchDir=center&srchLtEpsd={older}'
        page = _korean_page(url, today)
        if older not in page:
            raise ValueError('Manual backfill needed: Donghaeng history is incomplete')
        events.update(page)
    if len(events) != max(events) - min(events) + 1:
        raise ValueError('Missing draw in the Donghaeng history range')
    return list(events.values())


def history(game, since):
    country = game['country']
    if country not in {'in', 'kr', 'jp'}:
        raise ValueError('Unsupported Asian lottery edition')
    offset = timedelta(hours=5, minutes=30) if country == 'in' else timedelta(hours=9)
    today = datetime.now(timezone(offset)).date()
    if since > today:
        return []
    if country == 'in':
        events = _india(game['archive'], since, today)
    elif country == 'kr':
        events = _korea(since, today)
    else:
        events = _japan(game['archive'], since, today)
    return sorted((r for r in events if since.isoformat() <= r['date'] <= today.isoformat()),
                  key=lambda r: r['date'])


discover = history
