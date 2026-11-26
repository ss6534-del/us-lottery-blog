import json
from contextlib import redirect_stderr, redirect_stdout
import io
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import daily
from write_report import make_report


HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / 'games.json').read_text(encoding='utf-8'))


def game(country, key):
    return next(g for g in CONFIG['games'] if (g['country'], g['gameKey']) == (country, key))


def draw(day, number, first=1, second_round=False):
    rounds = [{'main': list(range(first, first + 6)), 'extra': [31]}]
    if second_round:
        rounds.append({'main': list(range(20, 26)), 'extra': [32]})
    return {'date': day, 'drawNo': str(number), 'rounds': rounds,
            'sourceUrl': f'https://example.org/results/{number}'}


class LocalizedReportTests(unittest.TestCase):
    def test_country_data_survives_localization_and_html_rendering(self):
        dates = ['2027-01-19', '2027-01-12', '2027-01-05']
        cases = [('uk', 'lotto'), ('ca', 'lotto-649'), ('in', 'karunya'),
                 ('jp', 'loto6'), ('kr', 'lotto-645')]
        bodies = {}
        for country, key in cases:
            events = [draw(day, 100 - i, i + 1, second_round=country == 'uk')
                      for i, day in enumerate(dates)]
            if country == 'in':
                for i, event in enumerate(events):
                    del event['rounds']
                    event.update(ticket={'series': 'KU', 'number': f'{5432 + i:06d}'},
                                 drawNo=f'KR-{100 - i}')
            report = make_report(game(country, key), CONFIG['editions'][country], events)
            body = bodies[country.upper()] = daily.render(report)
            self.assertIn(f'data-draw-atlas-id="atlas-{country}-{key}-{dates[0]}"', body)
            self.assertIn('atlas-sentence-break', body)
            self.assertIn('atlas-analysis', body)
        self.assertEqual(bodies['UK'].count('class="atlas-analysis-group"'), 2)
        self.assertIn('Round 2', bodies['UK'])
        for language in ('en-CA', 'fr-CA'):
            self.assertIn(f'lang="{language}"', bodies['CA'])
        self.assertIn('tirage classique', bodies['CA'])
        self.assertIn('>005432</span>', bodies['IN'])
        self.assertIn('>005433</span>', bodies['IN'])
        self.assertIn('lang="ml"', bodies['IN'])
        self.assertIn('lang="ja"', bodies['JP'])
        self.assertNotIn('play.google.com', bodies['JP'])
        self.assertIn('최근 3회', bodies['KR'])


class DailyRunnerTests(unittest.TestCase):
    def setUp(self):
        self.game = {**game('us', 'take-5'), 'after': '2027-01-11', 'afterSlot': 'midday'}
        self.edition = CONFIG['editions']['us']
        self.summary = {'preview': [], 'published': [], 'existing': [], 'errors': []}
        self.rows = []
        for day in ['2027-01-10', '2027-01-11', '2027-01-12']:
            for slot in ('midday', 'evening'):
                event = draw(day, len(self.rows) + 1)
                event.update(drawSlot=slot, rounds=[{'main': [1, 2, 3, 4, 5], 'extra': []}])
                self.rows.append(event)
        self.ids = [daily.identity(self.game, row) for row in self.rows]
        self.client = Mock()
        self.client.publish_once.return_value = {'outcome': 'published', 'url': 'https://example.org/post'}

    def process(self, rows, existing, client):
        with patch.object(daily.discover_west, 'history', return_value=rows), \
                patch.object(daily, 'render', return_value='<article>'), redirect_stdout(io.StringIO()):
            daily.process_game(self.game, self.edition, existing, client, self.summary)

    def test_missing_slot_backfilled_even_before_later_published_anchor(self):
        # Opening midday is the configured baseline. Evening was reported late.
        existing = {self.ids[4]}
        self.process(self.rows, existing, self.client)
        self.assertEqual(self.summary['published'], [self.ids[3], self.ids[5]])
        self.assertEqual(existing, set(self.ids[3:]))
        self.process(self.rows, existing, self.client)
        self.assertEqual(self.client.publish_once.call_count, 2)

    def test_incomplete_anchor_duplicate_or_unsorted_archive_cannot_publish(self):
        for rows in (self.rows[3:], self.rows + self.rows[-1:], list(reversed(self.rows))):
            with self.subTest(stamps=[daily.stamp(r) for r in rows]):
                with self.assertRaises(ValueError):
                    self.process(rows, set(), self.client)
        self.client.publish_once.assert_not_called()

    def test_quota_failure_keeps_pending_draws_eligible_for_next_run(self):
        success = self.client.publish_once.return_value
        self.client.publish_once.side_effect = [success, daily.BloggerError('HTTP 429')]
        existing = set()
        with self.assertRaises(daily.BloggerError):
            self.process(self.rows, existing, self.client)
        self.assertEqual(existing, {self.ids[3]})
        self.client.publish_once.side_effect = None
        self.process(self.rows, existing, self.client)
        self.assertEqual(self.summary['published'], self.ids[3:])
        self.assertEqual([call.args[0] for call in self.client.publish_once.call_args_list],
                         [self.ids[3], self.ids[4], self.ids[4], self.ids[5]])

    def test_one_bad_archive_does_not_block_the_next_country_in_preview(self):
        au = {**game('au', 'saturday-lotto'), 'after': '2027-01-09'}
        config = {**CONFIG, 'games': [self.game, au]}
        au_draws = [draw('2027-01-09', 22), draw('2027-01-16', 23)]
        with patch.object(daily.FEED, 'inventory', return_value=(set(), [])), \
                patch.object(daily.Path, 'read_text', return_value=json.dumps(config)), \
                patch.object(daily.discover_west, 'history', side_effect=[ValueError('unavailable'), au_draws]), \
                patch.object(daily.BloggerClient, 'from_env') as client, \
                patch.object(daily, 'render', return_value='<article>'), \
                patch.dict(daily.os.environ, {'GITHUB_STEP_SUMMARY': ''}), \
                redirect_stdout(io.StringIO()) as output, redirect_stderr(io.StringIO()) as errors:
            self.assertEqual(daily.run(False), 1)
        self.assertIn('us/take-5', errors.getvalue())
        self.assertIn(daily.identity(au, au_draws[-1]), output.getvalue())
        client.assert_not_called()
