"""Check Draw Atlas report identities against the complete public Blogger feed."""

import argparse
from datetime import date
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


BLOG_ID = '3280204798052215871'
BLOG_TAG = 'tag:blogger.com,1999:blog-' + BLOG_ID
HOST = 'goldnum.blogspot.com'
SEED_DIR = Path(__file__).resolve().parent.parent / 'reports'
SEED_GAMES = {'us': 'powerball', 'ca': 'lotto-649', 'uk': 'lotto', 'au': 'saturday-lotto',
              'in': 'karunya', 'kr': 'lotto-645', 'jp': 'loto6'}
SLUG = r'[a-z0-9]+(?:-[a-z0-9]+)*'
DAY = r'[0-9]{4}-[0-9]{2}-[0-9]{2}'
DRAW_ID = re.compile(rf'atlas-(?:{"|".join(SEED_GAMES)})-{SLUG}-({DAY})(?:-{SLUG})?')


def check(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    with path.open(encoding='utf-8-sig') as source:
        return json.load(source)


def report_identity(report):
    country, game, day = report['key'], report['gameKey'], report['date']
    check(country in SEED_GAMES and re.fullmatch(SLUG, game), 'Invalid country or gameKey')
    check(re.fullmatch(DAY, day) and date.fromisoformat(day).isoformat() == day, 'Invalid draw date')
    identity = f'atlas-{country}-{game}-{day}'
    if 'drawSlot' in report:
        check(re.fullmatch(SLUG, report['drawSlot']), 'Invalid drawSlot')
        identity += '-' + report['drawSlot']
    return identity


def seed_aliases():
    aliases = {}
    for country, game in SEED_GAMES.items():
        seed = read_json(SEED_DIR / (country + '.json'))
        check(seed['key'] == country, 'Incorrect seed country')
        aliases[f'atlas-{country}-{seed["date"]}'] = report_identity({**seed, 'gameKey': game})
    return aliases


class DrawMarkers(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key == 'data-draw-atlas-id':
                match = DRAW_ID.fullmatch(value or '')
                check(match and date.fromisoformat(match[1]), 'Malformed published draw marker')
                self.ids.add(value)
            if key == 'class':
                classes = (value or '').split()
                if 'atlas-draw' in classes:
                    self.ids.update(token for token in classes if DRAW_ID.fullmatch(token))


def parse_post(entry, aliases):
    post_tag = entry['id']['$t']
    check(re.fullmatch(re.escape(BLOG_TAG) + r'\.post-[0-9]+', post_tag), 'Invalid Blogger post ID')
    links = [link['href'] for link in entry['link'] if link['rel'] == 'alternate'
             and link.get('type', 'text/html') == 'text/html']
    check(len(links) == 1, f'Missing or ambiguous post URL for {post_tag}')
    url = links[0]
    parts = urlsplit(url)
    check(parts.scheme in ('https', 'http') and parts.netloc == HOST and parts.path.endswith('.html'),
          f'Unexpected post URL for {post_tag}')
    content = entry.get('content', {}).get('$t')
    check(isinstance(content, str) and content.strip(), f'Missing full post content for {url}')
    markers = DrawMarkers()
    markers.feed(content)
    markers.close()
    slug = parts.path.rsplit('/', 1)[-1][:-5]
    if slug in aliases:
        markers.ids.add(aliases[slug])
    else:
        match = DRAW_ID.fullmatch(slug)
        if match and date.fromisoformat(match[1]):
            markers.ids.add(slug)
    check(len(markers.ids) <= 1, f'Conflicting draw identities in {url}')
    return post_tag, url, next(iter(markers.ids), None)


def download(start):
    url = f'https://{HOST}/feeds/posts/default?alt=json&max-results=100&start-index={start}'
    request = Request(url, headers={'Accept': 'application/json', 'User-Agent': 'DrawAtlasFeedCheck/1.0'})
    with urlopen(request, timeout=40) as response:
        check(response.status == 200 and urlsplit(response.geturl()).hostname == HOST,
              'Unexpected Blogger response')
        return json.load(response)


def inventory(feed_file):
    cached_pages = None
    if feed_file:
        cached = read_json(feed_file)
        cached_pages = iter(cached if isinstance(cached, list) else [cached])
    aliases = seed_aliases()
    identities, post_tags = {}, set()
    total, start = None, 1
    while True:
        document = next(cached_pages, None) if cached_pages is not None else download(start)
        check(isinstance(document, dict), 'Feed ended before all declared posts were read')
        feed = document['feed']
        check(feed['id']['$t'] == BLOG_TAG, 'Wrong Blogger blog ID')
        count = int(feed['openSearch$totalResults']['$t'])
        check(count >= 0 and (total is None or total == count), 'Post count changed during pagination')
        total = count
        check(int(feed['openSearch$startIndex']['$t']) == start, 'Unexpected Blogger page offset')
        entries = feed.get('entry', [])
        check(isinstance(entries, list) and len(post_tags) + len(entries) <= total,
              'Invalid Blogger entry count')
        for entry in entries:
            post_tag, url, identity = parse_post(entry, aliases)
            check(post_tag not in post_tags, 'Post repeated during pagination')
            post_tags.add(post_tag)
            if identity:
                check(identity not in identities, f'Multiple public posts use {identity}')
                identities[identity] = url
        if len(post_tags) == total:
            check(cached_pages is None or next(cached_pages, None) is None, 'Unexpected extra feed pages')
            return identities, total
        check(entries, 'Empty page before the final post')
        start += len(entries)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--feed-file', type=Path, help='Complete Blogger JSON feed or array of consecutive pages')
    parser.add_argument('reports', nargs='*', metavar='REPORT.json')
    args = parser.parse_args()
    identities, total = inventory(args.feed_file)
    published, missing = [], []
    for filename in args.reports:
        path = Path(filename)
        report = read_json(path)
        country = report['key']
        if 'gameKey' not in report and country in SEED_GAMES and path.resolve() == SEED_DIR / (country + '.json'):
            report['gameKey'] = SEED_GAMES[country]
        identity = report_identity(report)
        row = {'id': identity, 'path': filename}
        if identity in identities:
            published.append({**row, 'url': identities[identity]})
        else:
            missing.append(row)
    print(json.dumps({'blogId': BLOG_ID, 'postCount': total,
                      'inventory': [{'id': key, 'url': url} for key, url in sorted(identities.items())],
                      'published': published, 'missing': missing}, ensure_ascii=True))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
        print(f'Feed check failed: {error}', file=sys.stderr)
        sys.exit(1)
