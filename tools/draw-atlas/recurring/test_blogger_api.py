import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import Mock

from blogger_api import BloggerClient, BloggerError, STATUSES, feed


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


if __name__ == '__main__':
    unittest.main()
