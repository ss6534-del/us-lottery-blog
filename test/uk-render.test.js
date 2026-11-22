import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildUkSection } from '../lib/uk-render.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'uk-journal-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const distDir = path.join(root, 'dist');
  const dataDir = path.join(root, 'data');
  return {
    root, dataDir, distDir,
    read: file => readFile(path.join(distDir, file), 'utf8'),
    add: async (game, date, numbers, special, round2) => {
      const dir = path.join(dataDir, game);
      await mkdir(dir, {recursive: true});
      await writeFile(path.join(dir, date + '.json'), JSON.stringify({
        game, date, numbers, special, round2, sourceUrl: 'https://example.org/results?game=' + game + '&day=' + date,
      }));
    },
  };
}

test('UK articles, canonical links and feed work under a Pages project path', async t => {
  const files = await fixture(t);
  await files.add('lotto', '2026-11-14', [14, 8, 11, 29, 31, 37], [12]);
  await files.add('lotto', '2026-11-18', [3, 7, 8, 17, 39, 43], [25], {numbers:[2, 7, 20, 25, 31, 50], special:[27]});
  await files.add('euromillions', '2026-11-17', [3, 5, 9, 25, 44], [3, 9]);
  await files.add('thunderball', '2026-11-18', [2, 5, 7, 19, 28], [2]);
  const {urls} = await buildUkSection({...files, baseUrl: 'https://example.org/blog/'});
  assert.equal(urls.length, 8);
  assert.deepEqual(urls.find(entry => entry.path === '/uk/lotto/'), {path: '/uk/lotto/', lastmod: '2026-11-18'});
  const html = await files.read('uk/lotto/2026-11-18/index.html');
  assert.match(html, /href="https:\/\/example.org\/blog\/uk\/lotto\/2026-11-18\/"/);
  assert.match(html, /href="\.\.\/\.\.\/site.css"/);
  assert.match(html, /href="\.\.\/\.\.\/\.\.\/">US results/);
  assert.match(html, /href="\.\.\/2026-11-14\/"/);
  assert.match(html, /1 number appears in both sets \(8\)/);
  assert.match(html, /two rounds share 1 main number \(7\)/);
  assert.match(html, /7–8/);
  assert.match(html, /First round/);
  assert.match(html, /Second round/);
  assert.match(html, /results\?game=lotto&amp;day=/);
  assert.match(html, /id=appfactory\.UK\.lottery\.uk_ai_lottery&amp;hl=en_GB/);
  const euro = await files.read('uk/euromillions/2026-11-17/index.html');
  assert.match(euro, /<ol role="list" aria-label="Lucky Stars"><li>3<\/li><li>9<\/li>/);
  assert.match(euro, /3 and 9 appear in both the main draw and the Lucky Stars/);
  const thunder = await files.read('uk/thunderball/2026-11-18/index.html');
  assert.match(thunder, /aria-label="Thunderball"/);
  assert.match(thunder, /2 appears twice on the result/);
  const feed = await files.read('uk/feed.xml');
  assert.equal((feed.match(/<item>/g) || []).length, 4);
  assert.match(feed, /https:\/\/example.org\/blog\/uk\/feed\.xml/);
  const home = await files.read('uk/index.html');
  assert.match(home, /href="euromillions\/2026-11-17\/"/);
  assert.match(home, /uk_ai_lottery&amp;hl=en_GB/);
  assert.match(home, /AI Lottery Hub UK/);
  const cardFor = slug => home.split(`game-card--${slug}">`)[1].split('</article>')[0];
  const groups = (card, label) => [...card.matchAll(new RegExp(`<ol role="list" aria-label="${label}">(.*?)</ol>`, 'g'))]
    .map(match => [...match[1].matchAll(/<li>(\d+)<\/li>/g)].map(item => Number(item[1])));
  const lottoCard = cardFor('lotto');
  assert.match(lottoCard, /<h4>First round<\/h4>[\s\S]+<h4>Second round<\/h4>/);
  assert.deepEqual(groups(lottoCard, 'Main numbers'), [[3, 7, 8, 17, 39, 43], [2, 7, 20, 25, 31, 50]]);
  assert.deepEqual(groups(lottoCard, 'Bonus Ball'), [[25], [27]]);
  assert.deepEqual(groups(cardFor('euromillions'), 'Lucky Stars'), [[3, 9]]);
  assert.deepEqual(groups(cardFor('thunderball'), 'Thunderball'), [[2]]);
  for (const [markup, section] of [[home, 'home'], [html, 'lotto'], [euro, 'euromillions'], [thunder, 'thunderball']]) {
    const href = markup.match(/href="(https:\/\/play\.google\.com[^"]+)"/)[1].replaceAll('&amp;', '&');
    const referrer = new URL(href).searchParams.get('referrer');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(referrer)), {
      utm_source: 'ssgpost', utm_medium: 'web', utm_campaign: 'blog_uk', utm_content: section,
    });
  }
  assert.match(await files.read('uk/site.css'), /\.game-grid/);
});

test('missing games have a reading guide and are omitted from sitemap until their first draw', async t => {
  const files = await fixture(t);
  const {urls} = await buildUkSection({...files, baseUrl: 'https://ssgpost.org'});
  assert.deepEqual(urls, []);
  const home = await files.read('uk/index.html');
  assert.match(home, /href="https:\/\/ssgpost.org\/uk\/"/);
  assert.match(home, /noindex,follow/);
  assert.equal((home.match(/Waiting for the first draw report\./g) || []).length, 3);
  assert.doesNotMatch(home, /class="ball-group/);
  const lotto = await files.read('uk/lotto/index.html');
  assert.match(lotto, /Bonus Ball/);
  assert.match(lotto, /noindex,follow/);
  assert.doesNotMatch(await files.read('uk/feed.xml'), /<item>/);
});
