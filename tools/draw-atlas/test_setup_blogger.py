import unittest
from unittest.mock import Mock, patch

import setup_blogger as setup


class EnrollmentTests(unittest.TestCase):
    def info(self, **changes):
        return {'blog': {'id': setup.BLOG_ID, 'url': 'https://goldnum.blogspot.com/'},
                'blog_user_info': {'role': 'ADMIN', 'blogId': setup.BLOG_ID, **changes}}

    def test_verifies_admin_after_refresh(self):
        responses = [{'refresh_token': 'sample-refresh', 'scope': setup.SCOPE},
                     {'access_token': 'sample-access'}, self.info()]
        with patch.object(setup, 'confirm_google', return_value={}), patch.object(setup, 'google', side_effect=responses) as api:
            self.assertEqual(setup.authorize({'client_id': 'sample'}), 'sample-refresh')
            self.assertEqual(api.call_args.args[0].full_url, setup.USER_BLOG)

    def test_refuses_wrong_blog_or_reader(self):
        for info in (self.info(blogId='other'), self.info(role='READER')):
            with self.subTest(info=info):
                responses = [{'refresh_token': 'sample-refresh', 'scope': setup.SCOPE},
                             {'access_token': 'sample-access'}, info]
                with patch.object(setup, 'confirm_google', return_value={}), patch.object(setup, 'google', side_effect=responses):
                    with self.assertRaisesRegex(setup.SetupError, 'does not administer'):
                        setup.authorize({'client_id': 'sample'})

    def test_repository_check_before_google(self):
        with patch.object(setup, 'gh', side_effect=['signed-in', 'READ']) as gh:
            with self.assertRaisesRegex(setup.SetupError, 'write access'):
                setup.check_repository()
            self.assertEqual(gh.call_count, 2)

    def test_secret_is_passed_on_stdin(self):
        sample = 'private-sample'
        with patch.object(setup.shutil, 'which', return_value='gh'), patch.object(setup.subprocess, 'run', return_value=Mock(returncode=0, stdout='')) as sub:
            setup.gh(['secret', 'set', 'BLOGGER_CLIENT_SECRET', '--repo', setup.REPO], sample)
            self.assertNotIn(sample, sub.call_args.args[0])
            self.assertEqual(sub.call_args.kwargs['input'], sample)
            self.assertNotIn('GH_DEBUG', sub.call_args.kwargs['env'])


if __name__ == '__main__':
    unittest.main()
