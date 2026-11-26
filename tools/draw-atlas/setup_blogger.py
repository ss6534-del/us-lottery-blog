"""Enroll Draw Atlas once. Run locally with Python 3 and an authenticated GitHub CLI."""

import argparse
import base64
import hashlib
from http.client import HTTPException
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import time
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import webbrowser


REPO = 'ss6534-del/us-lottery-blog'
BLOG_ID = '3280204798052215871'
SCOPE = 'https://www.googleapis.com/auth/blogger'
AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth'
TOKEN = 'https://oauth2.googleapis.com/token'
USER_BLOG = f'https://blogger.googleapis.com/v3/users/self/blogs/{BLOG_ID}'


class SetupError(Exception):
    pass


def gh(args, value=None):
    env = dict(os.environ, GH_HOST='github.com', GH_PROMPT_DISABLED='1')
    env.pop('GH_DEBUG', None)
    executable = shutil.which('gh')
    if not executable and os.name == 'nt':
        installed = Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'GitHub CLI' / 'gh.exe'
        if installed.is_file():
            executable = str(installed)
    if not executable:
        raise SetupError('Install GitHub CLI and sign in with gh auth login before running this helper.')
    result = subprocess.run([executable, *args], input=value, capture_output=True, env=env,
                            encoding='utf-8', errors='replace', timeout=40)
    if result.returncode:
        raise SetupError('GitHub CLI could not complete ' + ' '.join(args[:3])
                         + '. Check gh auth login and repository Actions secrets permissions.')
    return result.stdout.strip()


def check_repository():
    gh(['api', 'user', '--jq', '.login'])
    permission = gh(['repo', 'view', REPO, '--json', 'viewerPermission', '--jq', '.viewerPermission'])
    if permission not in ('ADMIN', 'MAINTAIN', 'WRITE'):
        raise SetupError('The signed-in GitHub account needs write access to ' + REPO)
    gh(['api', f'repos/{REPO}/actions/secrets/public-key', '--jq', '.key_id'])


def confirm_google(client_id):
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')
    outcome = {}

    class Callback(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # The redirect URL contains the one-time authorization code.

        def do_GET(self):
            parts = urlsplit(self.path)
            query = parse_qs(parts.query)
            if (parts.path != '/' or self.headers.get('Host') != f'127.0.0.1:{self.server.server_port}'
                    or len(query.get('state', [])) != 1
                    or not secrets.compare_digest(query['state'][0].encode(), state.encode())):
                self.send_error(400, 'Invalid callback')
                return
            if 'error' in query or len(query.get('code', [])) != 1:
                outcome['denied'] = True
            else:
                outcome['code'] = query['code'][0]
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.end_headers()
            self.wfile.write(b'Return to your terminal. You may close this window.')

    with HTTPServer(('127.0.0.1', 0), Callback) as server:
        redirect = f'http://127.0.0.1:{server.server_port}/'
        params = {'client_id': client_id, 'redirect_uri': redirect, 'response_type': 'code',
                  'scope': SCOPE, 'access_type': 'offline', 'prompt': 'consent select_account',
                  'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256'}
        if not webbrowser.open(AUTHORIZE + '?' + urlencode(params)):
            raise SetupError('Open this helper on a computer with a default web browser.')
        server.timeout = 1
        until = time.monotonic() + 300
        while not outcome and time.monotonic() < until:
            server.handle_request()
    if 'code' not in outcome:
        raise SetupError('Google authorization was declined or timed out.')
    return {'grant_type': 'authorization_code', 'code': outcome['code'],
            'redirect_uri': redirect, 'code_verifier': verifier}


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def google(request):
    try:
        with build_opener(NoRedirects()).open(request, timeout=30) as response:
            return json.load(response)
    except HTTPError as error:
        error.close()
        raise SetupError(f'Google returned HTTP {error.code}. Check Blogger API access and OAuth configuration.') from None
    except (OSError, HTTPException, ValueError):
        raise SetupError('Google did not return a valid response.') from None


def authorize(client):
    form = {**client, **confirm_google(client['client_id'])}
    granted = google(Request(TOKEN, data=urlencode(form).encode()))
    refresh = granted.get('refresh_token')
    if not refresh or SCOPE not in granted.get('scope', '').split():
        raise SetupError('Google did not grant offline Blogger publishing permission.')
    # Test exactly the offline flow that the scheduled job will use.
    form = {**client, 'grant_type': 'refresh_token', 'refresh_token': refresh}
    refreshed = google(Request(TOKEN, data=urlencode(form).encode()))
    if not refreshed.get('access_token'):
        raise SetupError('The new refresh token did not produce an access token.')
    info = google(Request(USER_BLOG, headers={'Authorization': 'Bearer ' + refreshed['access_token']}))
    blog = info.get('blog', {})
    access = info.get('blog_user_info', {})
    if (blog.get('id') != BLOG_ID or urlsplit(blog.get('url', '')).hostname != 'goldnum.blogspot.com'
            or access.get('blogId') != BLOG_ID
            or not (access.get('hasAdminAccess') is True or access.get('role') == 'ADMIN')):
        raise SetupError('This Google account does not administer the Draw Atlas blog.')
    return refresh


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('desktop_client_json', type=Path, help='Downloaded Google Desktop OAuth client JSON')
    path = parser.parse_args().desktop_client_json
    raw = json.loads(path.read_text(encoding='utf-8-sig')).get('installed', {})
    client = {field: raw.get(field) for field in ('client_id', 'client_secret')}
    if not all(isinstance(value, str) and value.strip() for value in client.values()):
        raise SetupError('Supply the downloaded JSON for a Google Desktop OAuth client.')
    check_repository()
    print('Sign in to Google as the administrator of goldnum.blogspot.com in the browser that opens.')
    refresh = authorize(client)
    for name, value in {**client, 'refresh_token': refresh}.items():
        gh(['secret', 'set', 'BLOGGER_' + name.upper(), '--repo', REPO, '--app', 'actions'], value)
    print('Registered the three Blogger Actions secrets in ' + REPO)


if __name__ == '__main__':
    try:
        main()
    except SetupError as error:
        sys.exit(str(error))
    except (OSError, ValueError, AttributeError, subprocess.TimeoutExpired) as error:
        sys.exit(f'Setup could not finish ({type(error).__name__}). Check the file, GitHub CLI and network.')
