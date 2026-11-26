"""Discover completed US, Canadian, UK and Australian draws in operator archives."""

import csv
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
import io
import json
import re
import time
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


NY_LIVE = 'https://nylottery.ny.gov/drupal-api/api/all/draw_games_fallback?_format=json'
ZONES = {'us': 'America/New_York', 'ca': 'America/Toronto',
         'uk': 'Europe/London', 'au': 'Australia/Sydney'}
# Primary count, primary maximum, extra count, extra maximum.
US_RULES = {
    'powerball': ('powerball', 5, 69, 1, 26),
    'mega-millions': ('megamillions', 5, 70, 1, 24),
    'ny-lotto': ('lotto', 6, 59, 1, 59),
    'millionaire-for-life': ('million4life', 5, 58, 1, 5),
    'take-5': ('take5', 5, 39, 0, 0),
}
CA_RULES = {'lotto-649': (6, 49, 1, 49), 'lotto-max': (7, 52, 1, 52),
            'daily-grand': (5, 49, 1, 7)}
AU_RULES = {'5127': (6, 45, 2, 45), '5132': (7, 35, 1, 20), '5303': (6, 45, 2, 45)}


@lru_cache(maxsize=48)
def _download(url, minute):
    request = Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; DrawAtlas/1.0)'})
    with urlopen(request, timeout=15) as response:
        return response.read().decode('utf-8-sig')


def _get(url):
    return _download(url, int(time.time() // 60))


def _check(value, message):
    if not value:
        raise ValueError(message)


def _balls(numbers, count, maximum):
    values = [int(n) for n in numbers]
    _check(len(values) == count and len(set(values)) == count and
           all(1 <= n <= maximum for n in values), f'Invalid result numbers: {values}')
    return sorted(values)


def _round(main, extra, rules, *, same_pool=False):
    n, maximum, e, extra_max = rules
    main = _balls(main, n, maximum)
    extra = _balls(extra, e, extra_max)
    _check(not same_pool or set(main).isdisjoint(extra), 'Bonus number repeated in the same number pool')
    return {'main': main, 'extra': extra}


def _record(day, rounds, source, number=None, slot=None):
    record = {'date': date.fromisoformat(day).isoformat(), 'rounds': rounds, 'sourceUrl': source}
    if number is not None:
        _check(str(number).isdigit() and int(number) > 0, 'Invalid draw number')
        record['drawNo'] = str(number)
    if slot is not None:
        record['drawSlot'] = slot
    return record


def _ny_history(game, since, rules):
    key = game['gameKey']
    endpoint = f"https://data.ny.gov/resource/{game['dataset']}.json"
    # Keyset page on date (Take 5 has both slots in one row). This avoids
    # offsets drifting when the operator inserts a new draw between requests.
    where = f"draw_date >= '{since - timedelta(days=8)}T00:00:00'"
    rows = []
    through = None
    while True:
        query = urlencode({'$where': where + (f" AND draw_date < '{through}'" if through else ''),
                           '$order': 'draw_date DESC', '$limit': 1000})
        page = json.loads(_get(f'{endpoint}?{query}'))
        _check(isinstance(page, list), 'Invalid NY archive response')
        rows.extend(page)
        if len(page) < 1000:
            break
        oldest = page[-1]['draw_date']
        _check(not through or oldest < through, 'NY archive pagination did not advance')
        through = oldest
    result = []
    for row in rows:
        day = row['draw_date'][:10]
        source = endpoint + '?' + urlencode({'draw_date': row['draw_date']})
        if key == 'take-5':
            for slot in ('midday', 'evening'):
                numbers = row.get(f'{slot}_winning_numbers')
                if numbers:
                    result.append(_record(day, [_round(numbers.split(), [], rules)], source, slot=slot))
            continue
        numbers = row['winning_numbers'].split()
        if key == 'powerball':
            main, extra = numbers[:-1], numbers[-1:]
        else:
            field = {'mega-millions': 'mega_ball', 'ny-lotto': 'bonus',
                     'millionaire-for-life': 'mill_ball'}[key]
            main, extra = numbers, [row[field]]
        result.append(_record(day, [_round(main, extra, rules, same_pool=key == 'ny-lotto')], source))
    return result


def _us(game, since):
    key = game['gameKey']
    live_name, *rules = US_RULES[key]
    zone = ZoneInfo(ZONES['us'])
    result = []
    try:
        live = json.loads(_get(NY_LIVE))['data'][live_name]['draws']
    except (TimeoutError, URLError):
        return _ny_history(game, since, rules)
    for row in live:
        if not row.get('results'):
            continue  # The feed includes the next sale/draw, with no result yet.
        regular = [r for r in row['results'] if r.get('prizeTierId') == 'Regular']
        _check(len(regular) == 1, f'Unidentified NY draw tier for {key}')
        balls = _round(regular[0]['primary'], regular[0].get('secondary', []), rules,
                       same_pool=key == 'ny-lotto')
        day = datetime.fromtimestamp(row['drawTime'] / 1000, zone).date().isoformat()
        slot = {1: 'midday', 2: 'evening'}[int(row['drawPeriod'])] if key == 'take-5' else None
        source = (f'https://www.powerball.com/draw-result?date={day}&gc=powerball'
                  if key == 'powerball' else f"https://data.ny.gov/d/{game['dataset']}")
        result.append(_record(day, [balls], source, row['drawNumber'], slot))
    if not result:
        return _ny_history(game, since, rules)
    # The oldest date may contain only an evening slot. Get both via the archive.
    if since.isoformat() <= min(row['date'] for row in result):
        return _ny_history(game, since, rules) + result
    return result


def _ca(game, since):
    archive = game['archive']
    raw = _get(f'https://www.wclc.com/winning-numbers/{archive}.htm')
    entries = re.split(r'<div\s+class="pastWinNum"\s*>', raw)[1:]
    result = []
    for entry in entries:
        heading = re.search(r'<div class="pastWinNumDate">\s*<h4>\s*([^<]+)', entry)
        draw = re.search(r'(/[-a-z0-9]+-prize-details\.htm\?drawNumber=(\d+))\b', entry)
        _check(heading and draw, f'Missing WCLC draw identity for {archive}')
        day = datetime.strptime(heading[1].strip(), '%A, %B %d, %Y').date()
        # The main/Classic draw is the first list. Later lists are side prizes.
        balls = re.search(r'<ul class="pastWinNumbers">(.*?)</ul>', entry, re.S)
        _check(balls, f'Missing WCLC main draw on {day}')
        main = re.findall(r'<li class="pastWinNumber">\s*(\d+)\s*</li>', balls[1])
        extra = re.findall(r'<li class="(?:pastWinNumberBonus|winNumHomeNumberBonusDG)">.*?</span>\s*(\d+)\s*</li>', balls[1], re.S)
        balls = _round(main, extra, CA_RULES[game['gameKey']], same_pool=game['gameKey'] != 'daily-grand')
        result.append(_record(day.isoformat(), [balls], 'https://www.wclc.com' + draw[1], draw[2]))
    return result


def _uk(game, since):
    archive = game['archive']
    raw = _get(f'https://www.national-lottery.co.uk/results/{archive}/draw-history')
    entries = re.split(r'<div\s+data-testid="draw-history-mobile-content-\d+">', raw)[1:]
    result = []
    for entry in entries:
        target = re.search(r'href="/results/' + re.escape(archive) +
                           r'/draw-details\?drawNo=(\d+)"', entry)
        _check(target, f'Missing UK {archive} draw link')
        draw = entry[:target.start()]
        heading = re.search(r'<span class="[^"]*_drawDate">([^<]+)</span>', draw)
        _check(heading, f'Missing UK {archive} draw date')
        day = datetime.strptime(heading[1].strip(), '%a %d %b %Y').date()
        numbers = re.findall(r'<div\b[^<>]*class="[^"]*_number"[^<>]*>(\d+)</div>', draw)
        if archive == 'lotto':
            count = 2 if day >= date(2026, 6, 10) else 1
            _check(len(numbers) == 7 * count, f'Incomplete UK Lotto rounds for {day}')
            # Mobile markup shows all main sets first, then each bonus ball.
            rounds = [_round(numbers[i*6:i*6+6], [numbers[count*6+i]], (6, 59, 1, 59), same_pool=True)
                      for i in range(count)]
        elif archive == 'euromillions':
            rounds = [_round(numbers[:5], numbers[5:], (5, 50, 2, 12))]
        elif archive == 'thunderball':
            rounds = [_round(numbers[:5], numbers[5:], (5, 39, 1, 14))]
        else:
            raise ValueError(f'Unrecognised UK game {archive}')
        source = f'https://www.national-lottery.co.uk/results/{archive}/draw-details?drawNo={target[1]}'
        result.append(_record(day.isoformat(), rounds, source, target[1]))
    return result


def _au(game, since):
    archive = game['archive']
    rules = AU_RULES[archive]
    url = f'https://www.lotterywest.wa.gov.au/api/games/{archive}/results-csv'
    # The CSV covers the game from its launch. The JSON feed has only ten draws.
    # Old game matrices may differ, so do not apply today's rules to older rows.
    cutoff = since - timedelta(days=8)
    result = []
    for row in csv.DictReader(io.StringIO(_get(url))):
        day = datetime.strptime(row['Draw date'], '%d/%m/%Y').date()
        if day < cutoff:
            continue
        main = [row[f'Winning Number {i+1}'] for i in range(rules[0])]
        extra = ([row['Powerball Number']] if archive == '5132' else
                 [row[f'Supplementary Number {i+1}'] for i in range(rules[2])])
        balls = _round(main, extra, rules, same_pool=archive != '5132')
        result.append(_record(day.isoformat(), [balls], url, row['Draw number']))
    return result


def _available(game, since, strict):
    country = game['country']
    today = datetime.now(timezone.utc).astimezone(ZoneInfo(ZONES[country])).date()
    if since > today:
        return []
    rows = {'us': _us, 'ca': _ca, 'uk': _uk, 'au': _au}[country](game, since)
    _check(rows, f"{game['name']} archive returned no completed results")
    if strict:
        _check(min(row['date'] for row in rows) <= since.isoformat(),
               f"{game['name']} archive does not cover {since}; check the operator archive manually")
    by_id = {}
    for row in rows:
        day, slot = row['date'], row.get('drawSlot', '')
        if since.isoformat() <= day <= today.isoformat():
            ident = (day, slot)
            old = by_id.get(ident, {})
            _check(not old or (old['rounds'] == row['rounds'] and
                   not (old.get('drawNo') and row.get('drawNo') and old['drawNo'] != row['drawNo'])),
                   f'Conflicting operator results for {ident}')
            by_id[ident] = {**old, **row}
    return sorted(by_id.values(), key=lambda row: (row['date'], row.get('drawSlot') == 'evening'))


def history(game, since):
    """Available verified results on or after since; rolling archives may begin later."""
    return _available(game, since, strict=False)


def discover(game, since):
    """Verified results on or after since; require archive coverage of the cutoff."""
    return _available(game, since, strict=True)
