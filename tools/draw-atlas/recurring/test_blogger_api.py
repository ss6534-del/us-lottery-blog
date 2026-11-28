import unittest
from datetime import datetime, timedelta, timezone
from email.message import Message
from email.utils import format_datetime
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request
from unittest.mock import Mock, patch

from blogger_api import BloggerClient, BloggerError, BloggerRateLimitError, STATUSES, _json, feed


KEY = 'atlas-jp-loto6-2026-11-26'
BODY = f'<div class="atlas-draw {KEY}" data-draw-atlas-id="{KEY}"><p>結果</p></div>'


def post(status='LIVE'):
    return {'blog': {'id': feed.BLOG_ID}, 'id': '123', 'status': status, 'content': BODY,
            'url': 'https://goldnum.blogspot.com/2026/11/sample.html' if status == 'LIVE' else '',
            'title': 'ロト6'}


def page(*posts, **fields):
    return {'kind': 'blogger#postList', 'items': list(posts), **fields}


class PublishTests(unittest.TestCase):
    def setUp(self):
        self.client = BloggerClient({})

    def publish(self):
        return self.client.publish_once(KEY, 'ロト6', ['JP', 'ロト6'], BODY)

    def test_inventory_includes_draft_and_scheduled_pages_before_inserting(self):
        for state in STATUSES:
            with self.subTest(state=state):
                self.client = BloggerClient({})
                self.client._request = Mock(side_effect=[page(nextPageToken='next'), page(post(state))])
                self.assertEqual(self.publish()['outcome'], 'existing')
                requests = self.client._request.call_args_list
                self.assertEqual(len(requests), 2)
                self.assertEqual(parse_qs(urlsplit(requests[0].args[0]).query)['status'], list(STATUSES))
                self.assertIn('pageToken=next', requests[1].args[0])

    def test_legacy_seed_permalink(self):
        entry = {**post(), 'url': 'https://goldnum.blogspot.com/2026/11/atlas-kr-2026-11-21.html',
                 'content': '<p>기존 글</p>'}
        self.client._request = Mock(return_value=page(entry))
        self.assertIn('atlas-kr-lotto-645-2026-11-21', self.client.inventory())

    def test_lowercase_status_is_normalized(self):
        self.client._request = Mock(return_value=page({**post('DRAFT'), 'status': 'draft'}))
        self.assertEqual(self.publish()['status'], 'DRAFT')

    def test_publish_once_and_verify(self):
        self.client._request = Mock(side_effect=[page(), {'id': '123'}, post()])
        self.assertEqual(self.publish()['status'], 'LIVE')
        self.assertEqual(self.publish()['outcome'], 'existing')
        requests = self.client._request.call_args_list
        self.assertEqual(len(requests), 3)
        self.assertEqual(requests[1].args[1]['content'], BODY)
        self.assertIn('/123?', requests[2].args[0])

    def test_timeout_after_insert_reconciles_through_admin_read(self):
        self.client._request = Mock(side_effect=[page(), BloggerError('timed out'), page(post())])
        self.assertEqual(self.publish()['outcome'], 'published')
        self.assertEqual(len(self.client._request.call_args_list[-1].args), 1)

    def test_ambiguous_absent_result_never_repeats_insert(self):
        self.client._request = Mock(side_effect=[page(), BloggerError('timed out'), page()])
        with self.assertRaisesRegex(BloggerError, 'Publication unconfirmed'):
            self.publish()
        with self.assertRaisesRegex(BloggerError, 'Unresolved earlier submission'):
            self.publish()
        self.assertEqual(self.client._request.call_count, 3)

    def test_incomplete_paginated_listing_and_duplicate_marker_fail_closed(self):
        other = {**post(), 'id': '456'}
        for response in ([page(nextPageToken='x'), page(nextPageToken='x')],
                         [page(post(), other)], [{'items': []}]):
            with self.subTest(response=response):
                self.client._request = Mock(side_effect=response)
                with self.assertRaises(BloggerError):
                    self.publish()
                self.assertTrue(all(len(call.args) == 1 for call in self.client._request.call_args_list))

    def test_reject_wrong_body_or_country_before_network(self):
        self.client._request = Mock()
        with self.assertRaises(BloggerError):
            self.client.publish_once(KEY, 'ロト6', ['US'], BODY)
        with self.assertRaises(BloggerError):
            self.client.publish_once(KEY, 'ロト6', ['JP'], '<p>unmarked</p>')
        self.client._request.assert_not_called()


class RateLimitTests(unittest.TestCase):
    def setUp(self):
        self.client = BloggerClient({}, paced_publishing=True)
        self.now = 0
        self.events = []
        sleeper = patch('blogger_api.sleep', side_effect=self.wait)
        sleeper.start()
        self.addCleanup(sleeper.stop)
        clock = patch('blogger_api.monotonic', side_effect=lambda: self.now)
        clock.start()
        self.addCleanup(clock.stop)

    def wait(self, seconds):
        self.events.append(('wait', seconds))
        self.now += seconds

    def publish(self, key=KEY):
        return self.client.publish_once(key, 'ロト6', ['JP', 'ロト6'], BODY.replace(KEY, key))

    def replies(self, *responses):
        responses = iter(responses)

        def request(url, payload=None):
            action = 'insert' if payload is not None else ('verify' if '/123?' in url else 'inventory')
            self.events.append(action)
            reply = next(responses)
            if isinstance(reply, Exception):
                raise reply
            return reply

        self.client._request = request

    def test_http_429_preserves_retry_after_seconds_and_http_date(self):
        future = datetime.now(timezone.utc) + timedelta(seconds=300)
        for value, low, high in [('180', 180, 180), (format_datetime(future, usegmt=True), 295, 301)]:
            with self.subTest(value=value):
                headers = Message()
                headers['Retry-After'] = value
                error = HTTPError('https://blogger.googleapis.com', 429, 'Too Many Requests', headers, None)
                with patch('blogger_api.build_opener') as opener:
                    opener.return_value.open.side_effect = error
                    with self.assertRaises(BloggerRateLimitError) as raised:
                        _json(Request('https://blogger.googleapis.com'), 'Blogger posts API')
                    self.assertTrue(low <= raised.exception.retry_after <= high)

    def test_waits_then_rechecks_all_statuses_before_retrying_rejected_insert(self):
        for header, expected in [(222, 222), (None, 150)]:
            with self.subTest(retry_after=header):
                self.client = BloggerClient({}, paced_publishing=True)
                self.events.clear()
                self.replies(page(), BloggerRateLimitError('insert 429', header),
                             page(nextPageToken='next'), page(), {'id': '123'}, post())
                self.assertEqual(self.publish()['status'], 'LIVE')
                self.assertEqual(self.events, ['inventory', 'insert', ('wait', expected),
                                               'inventory', 'inventory', 'insert', 'verify'])

    def test_existing_marker_after_throttle_suppresses_second_insert(self):
        for status in STATUSES:
            with self.subTest(status=status):
                self.client = BloggerClient({}, paced_publishing=True)
                self.events.clear()
                self.replies(page(), BloggerRateLimitError('insert 429', 200),
                             page(nextPageToken='next'), page(post(status)))
                try:
                    received = self.publish()
                except BloggerError:
                    self.assertIn(status, ('DRAFT', 'SCHEDULED'))
                else:
                    self.assertEqual(received['status'], status)
                self.assertEqual(self.events, ['inventory', 'insert', ('wait', 200),
                                               'inventory', 'inventory'])

    def test_throttled_verification_never_reinserts_even_when_inventory_is_stale(self):
        def request(url, payload=None):
            if payload is not None:
                self.events.append('insert')
                return {'id': '123'}
            if '/123?' in url:
                self.events.append('verify')
                raise BloggerRateLimitError('verification GET 429', 12)
            self.events.append('inventory')
            return page()
        self.client._request = request
        with self.assertRaises(BloggerError):
            self.publish()
        self.assertEqual(self.events.count('insert'), 1)

    def test_long_retry_after_defers_without_sleeping_or_reinserting(self):
        self.replies(page(), BloggerRateLimitError('insert 429', 601), page())
        with self.assertRaises(BloggerError):
            self.publish()
        with self.assertRaises(BloggerError):
            self.publish('atlas-jp-loto6-2026-11-30')
        self.assertEqual(self.events.count('insert'), 1)
        self.assertFalse(any(isinstance(event, tuple) for event in self.events))

    def test_persistent_rate_limit_stops_after_one_retry(self):
        def request(url, payload=None):
            if payload is None:
                return page()
            self.events.append('insert')
            if self.events.count('insert') > 2:
                self.fail('A second retry submitted the same draw a third time')
            raise BloggerRateLimitError('insert 429', 180)
        self.client._request = request
        with self.assertRaises(BloggerError):
            self.publish()
        self.assertEqual(self.events.count('insert'), 2)

    def test_failed_reconciliation_cannot_authorize_a_new_insert(self):
        self.replies(page(), BloggerRateLimitError('insert 429', 150),
                     {'unexpected': True}, {'unexpected': True})
        with self.assertRaises(BloggerError):
            self.publish()
        self.assertEqual(self.events.count('insert'), 1)

    def test_existing_posts_do_not_count_toward_three_insert_batches(self):
        keys = [f'atlas-jp-loto6-2026-11-{day}' for day in (21, 22, 23, 24, 25)]
        replies = [page({**post(), 'content': BODY.replace(KEY, keys[0]), 'id': '120'})]
        for key in keys[1:]:
            replies.extend([{'id': '123'}, {**post(), 'content': BODY.replace(KEY, key)}])
        self.replies(*replies)
        for key in keys[:4]:
            self.publish(key)
        self.assertEqual(self.events, ['inventory', 'insert', 'verify', 'insert', 'verify', 'insert', 'verify'])
        self.publish(keys[4])
        self.assertEqual(self.events[-3:], [('wait', 150), 'insert', 'verify'])


if __name__ == '__main__':
    unittest.main()
