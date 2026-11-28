"""Publish a Draw Atlas report through Blogger v3 from a serialized workflow."""

from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from importlib import import_module
import json
import os
from time import monotonic, sleep
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from http.client import HTTPException


feed = import_module('feed-check')
POSTS = f'https://blogger.googleapis.com/v3/blogs/{feed.BLOG_ID}/posts'
TOKEN = 'https://oauth2.googleapis.com/token'
STATUSES = ('LIVE', 'DRAFT', 'SCHEDULED')
FIELDS = 'id,blog/id,title,url,content,status'
PUBLISH_BATCH_SIZE = 3
PUBLISH_BATCH_GAP = 150
MAX_RATE_LIMIT_WAIT = 600


class BloggerError(RuntimeError):
    """Safe to display in the workflow log."""


class BloggerRateLimitError(BloggerError):
    def __init__(self, message, retry_after=None):
        super().__init__(message)
        self.retry_after = retry_after


class _NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward credentials to a redirected endpoint.


def _retry_after_seconds(value):
    value = (value or '').strip()
    try:
        if value.isascii() and value.isdigit():
            return int(value)
        until = parsedate_to_datetime(value)
        if until.tzinfo is None:
            until = until.replace(tzinfo=timezone.utc)
        return max(0, (until - datetime.now(timezone.utc)).total_seconds())
    except (ValueError, OverflowError):
        return None


def _json(request, operation):
    try:
        with build_opener(_NoRedirects()).open(request, timeout=40) as response:
            result = json.load(response)
    except HTTPError as error:
        rate_limited = error.code == 429 and operation == 'Blogger posts API'
        retry_after = _retry_after_seconds(error.headers.get('Retry-After')) if rate_limited and error.headers else None
        error.close()
        if rate_limited:
            raise BloggerRateLimitError(f'{operation} returned HTTP 429', retry_after) from None
        raise BloggerError(f'{operation} returned HTTP {error.code}') from None
    except (OSError, HTTPException, ValueError) as error:
        raise BloggerError(f'{operation} failed ({type(error).__name__})') from None
    if not isinstance(result, dict):
        raise BloggerError(f'{operation} returned an unexpected response')
    return result


def _markers(body):
    parser = feed.DrawMarkers()
    try:
        parser.feed(body)
        parser.close()
    except ValueError:
        raise BloggerError('Malformed draw marker in Blogger content') from None
    return parser.ids


class BloggerClient:
    def __init__(self, credentials, *, paced_publishing=False):
        self._credentials = credentials
        self._token = ''
        self._expires = 0
        self._posts = None
        self._uncertain = set()
        self._aliases = feed.seed_aliases()
        self._paced_publishing = paced_publishing
        self._batch_attempts = 0
        self._next_batch_at = 0
        self._defer_writes = False

    @classmethod
    def from_env(cls, *, paced_publishing=False):
        credentials = {}
        for field in ('client_id', 'client_secret', 'refresh_token'):
            name = 'BLOGGER_' + field.upper()
            value = os.environ.get(name, '').strip()
            if not value:
                raise BloggerError(f'Missing GitHub Actions secret {name}')
            credentials[field] = value
        return cls(credentials, paced_publishing=paced_publishing)

    def _request(self, url, post=None):
        if monotonic() >= self._expires:
            form = urlencode({**self._credentials, 'grant_type': 'refresh_token'}).encode()
            token = _json(Request(TOKEN, data=form), 'Blogger OAuth refresh')
            access = token.get('access_token')
            lifetime = token.get('expires_in')
            if not isinstance(access, str) or not access or not isinstance(lifetime, int) or lifetime <= 0:
                raise BloggerError('Blogger OAuth refresh returned no usable access token')
            self._token, self._expires = access, monotonic() + max(0, lifetime - 60)
        headers = {'Authorization': 'Bearer ' + self._token, 'Accept': 'application/json'}
        data = None
        if post is not None:
            headers['Content-Type'] = 'application/json; charset=UTF-8'
            data = json.dumps(post, ensure_ascii=False).encode('utf-8')
        return _json(Request(url, headers=headers, data=data), 'Blogger posts API')

    def _entry(self, post):
        if not isinstance(post, dict) or post.get('blog', {}).get('id') != feed.BLOG_ID:
            raise BloggerError('Post has unexpected blog ID')
        post_id = post.get('id')
        status = str(post.get('status', '')).upper()
        if not isinstance(post_id, str) or not post_id.isascii() or not post_id.isdigit() or status not in STATUSES:
            raise BloggerError('Invalid post ID or incomplete Blogger admin view')
        body = post.get('content')
        if not isinstance(body, str):
            # Blogger may omit empty content in a manually created draft.
            if body is None and status == 'DRAFT':
                body = ''
            else:
                raise BloggerError('Blogger admin view omitted a post body')
        ids = _markers(body)
        url = post.get('url', '')
        if url:
            parts = urlsplit(url)
            if parts.scheme not in ('https', 'http') or parts.netloc != feed.HOST:
                raise BloggerError('Unexpected post URL for Draw Atlas')
            slug = parts.path.rsplit('/', 1)[-1].removesuffix('.html')
            if slug in self._aliases:
                ids.add(self._aliases[slug])
            elif feed.DRAW_ID.fullmatch(slug):
                ids.add(slug)
        elif status == 'LIVE':
            raise BloggerError('Blogger omitted the URL of a live post')
        if len(ids) > 1:
            raise BloggerError('Conflicting draw markers in Blogger admin view')
        return next(iter(ids), None), {'id': post_id, 'status': status, 'url': url,
                                      'title': post.get('title', '')}

    def inventory(self):
        """Read the complete admin inventory, including unpublished and scheduled posts."""
        query = {'view': 'ADMIN', 'status': STATUSES, 'fetchBodies': 'true', 'maxResults': 100,
                 'fields': f'kind,nextPageToken,items({FIELDS})'}
        posts, seen_ids, seen_tokens = {}, set(), set()
        self._posts = None
        while True:
            page = self._request(POSTS + '?' + urlencode(query, doseq=True))
            items = page.get('items', [])
            if page.get('kind') != 'blogger#postList' or not isinstance(items, list):
                raise BloggerError('Incomplete Blogger post listing')
            for item in items:
                key, row = self._entry(item)
                if row['id'] in seen_ids or key is not None and key in posts:
                    raise BloggerError('Duplicate post or draw identity in Blogger admin view')
                seen_ids.add(row['id'])
                if key:
                    posts[key] = row
            token = page.get('nextPageToken')
            if not token:
                break
            if not isinstance(token, str) or token in seen_tokens:
                raise BloggerError('Invalid Blogger continuation token')
            seen_tokens.add(token)
            query['pageToken'] = token
        self._posts = posts
        return dict(posts)

    def _insert(self, payload):
        url = POSTS + '?isDraft=false&fields=id'
        if not self._paced_publishing:
            return self._request(url, payload)
        if self._batch_attempts == PUBLISH_BATCH_SIZE:
            delay = self._next_batch_at - monotonic()
            if delay > 0:
                print(f'Blogger: waiting {delay:.0f}s before the next publication batch', flush=True)
                sleep(delay)
            self._batch_attempts = 0
            self._next_batch_at = 0
        try:
            return self._request(url, payload)
        finally:
            # Count attempted writes too, since a failed response can follow a write.
            self._batch_attempts += 1
            if self._batch_attempts == PUBLISH_BATCH_SIZE:
                self._next_batch_at = monotonic() + PUBLISH_BATCH_GAP

    def _wait_for_rate_limit(self, error):
        delay = PUBLISH_BATCH_GAP if error.retry_after is None else error.retry_after
        if delay > MAX_RATE_LIMIT_WAIT:
            self._defer_writes = True
            raise BloggerError('Blogger HTTP 429 requires a longer wait; remaining publications deferred') from None
        delay = max(delay, self._next_batch_at - monotonic())
        print(f'Blogger HTTP 429: waiting {delay:.0f}s before checking for the post', flush=True)
        if delay > 0:
            sleep(delay)
        if self._next_batch_at or delay >= PUBLISH_BATCH_GAP:
            self._batch_attempts = 0
            self._next_batch_at = 0

    def _find_after_failure(self, key, error):
        throttled = self._paced_publishing and isinstance(error, BloggerRateLimitError)
        if throttled:
            self._wait_for_rate_limit(error)
        try:
            return self.inventory().get(key)
        except BloggerError as inventory_error:
            if self._paced_publishing and (throttled or isinstance(inventory_error, BloggerRateLimitError)):
                self._defer_writes = True
            raise

    def _insert_or_find(self, key, payload):
        try:
            return self._insert(payload), None
        except BloggerRateLimitError as error:
            if not self._paced_publishing:
                raise
            row = self._find_after_failure(key, error)
            if row is not None:
                return None, row
            try:
                return self._insert(payload), None
            except BloggerRateLimitError:
                self._defer_writes = True
                raise

    def publish_once(self, key, title, labels, html):
        """Verify the saved post and reconcile failures before any allowed retry."""
        if not isinstance(key, str) or not feed.DRAW_ID.fullmatch(key) or _markers(html) != {key}:
            raise BloggerError('Report body does not identify the expected draw')
        if (not isinstance(title, str) or not title.strip() or not isinstance(labels, list)
                or not all(isinstance(label, str) and label.strip() for label in labels)
                or not labels or labels[0] != key.split('-')[1].upper()):
            raise BloggerError('Invalid title or country label for draw')
        if self._defer_writes:
            raise BloggerError('Blogger HTTP 429 deferred remaining publications to a later run')
        if self._posts is None:
            self.inventory()
        if key in self._posts:
            return {'outcome': 'existing', **self._posts[key]}
        if key in self._uncertain:
            raise BloggerError(f'Unresolved earlier submission for {key}; check Blogger before retrying')
        self._uncertain.add(key)
        try:
            payload = {'kind': 'blogger#post', 'title': title, 'labels': labels, 'content': html}
            created, row = self._insert_or_find(key, payload)
            if row is None:
                post_id = created.get('id')
                if not isinstance(post_id, str) or not post_id.isascii() or not post_id.isdigit():
                    raise BloggerError('Blogger did not return a valid new post ID')
                params = urlencode({'view': 'ADMIN', 'fields': FIELDS})
                saved_key, row = self._entry(self._request(f'{POSTS}/{post_id}?{params}'))
                if saved_key != key or row['id'] != post_id or row['status'] != 'LIVE':
                    raise BloggerError('Could not verify the new live post')
        except BloggerError as error:
            if self._defer_writes:
                raise
            # Ambiguous writes and verification failures can be reconciled by reading.
            row = self._find_after_failure(key, error)
            if row is None or row['status'] != 'LIVE':
                raise BloggerError(f'Publication unconfirmed for {key} ({error}); inspect Blogger before retry') from None
        self._uncertain.discard(key)
        self._posts[key] = row
        return {'outcome': 'published' if row['status'] == 'LIVE' else 'existing', **row}
