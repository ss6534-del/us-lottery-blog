import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const appUrl = 'https://play.google.com/store/apps/details?id=appfactory.UK.lottery.uk_ai_lottery&hl=en_GB&gl=GB';
function appLink(section) {
  const url = new URL(appUrl);
  const referrer = new URLSearchParams({utm_source: 'ssgpost', utm_medium: 'web', utm_campaign: 'blog_uk', utm_content: section});
  url.searchParams.set('referrer', referrer.toString());
  return escape(url.href);
}

const games = {
  lotto: {
    name: 'Lotto', special: 'Bonus Ball',
    guide: 'Read the six main numbers together, then check the Bonus Ball separately. Where a second round is recorded, it has its own line of numbers and its own Bonus Ball.',
    app: 'Keep your six Lotto numbers together in the Android app and check your saved lines against the results.',
  },
  euromillions: {
    name: 'EuroMillions', special: 'Lucky Stars',
    guide: 'Check the five main numbers first, then the two Lucky Stars. A number can appear in both groups because the stars come from a separate pool.',
    app: 'Save your five main numbers and both Lucky Stars in the Android app so you can look up the whole line later.',
  },
  thunderball: {
    name: 'Thunderball', special: 'Thunderball',
    guide: 'Each result has five main numbers and a separate Thunderball. Compare the Thunderball with the one on your line, even when the same value appears among the main numbers.',
    app: 'Store your Thunderball lines in the Android app with the five main numbers and the Thunderball in separate fields.',
  },
};

const fullDate = new Intl.DateTimeFormat('en-GB', {dateStyle: 'full', timeZone: 'UTC'});
const monthDate = new Intl.DateTimeFormat('en-GB', {month: 'long', year: 'numeric', timeZone: 'UTC'});
const listFormat = new Intl.ListFormat('en-GB', {style: 'long', type: 'conjunction'});
const dateObject = date => new Date(date + 'T00:00:00Z');
const dateText = date => fullDate.format(dateObject(date));
const at = (name, date = '') => '/uk/' + name + '/' + (date && date + '/');
const articlePath = row => at(row.game, row.date);
const ordered = numbers => [...numbers].sort((a, b) => a - b);
const joinNumbers = numbers => listFormat.format(numbers.map(String));
const escape = text => String(text).replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));

function relative(current, target) {
  const link = path.posix.relative(current, target) || '.';
  return link + (target.endsWith('/') ? '/' : '');
}

function absolute(baseUrl, route) {
  return new URL(route.slice(1), baseUrl.replace(/\/+$/, '') + '/').href;
}

function navLink(current, target, label) {
  const active = current === target ? ' aria-current="page"' : '';
  return '<a href="' + relative(current, target) + '"' + active + '>' + label + '</a>';
}

function page({baseUrl, route, title, description, content, article = false, empty = false}) {
  const canonical = escape(absolute(baseUrl, route));
  const nav = Object.entries(games).map(([slug, game]) => navLink(route, at(slug), game.name)).join('');
  return `<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)} | AI Lottery Hub UK</title><meta name="description" content="${escape(description)}">
<link rel="canonical" href="${canonical}"><meta property="og:locale" content="en_GB"><meta property="og:type" content="${article ? 'article' : 'website'}">
<meta property="og:url" content="${canonical}"><meta property="og:title" content="${escape(title)}"><meta property="og:description" content="${escape(description)}">
${empty ? '<meta name="robots" content="noindex,follow">' : ''}
<link rel="alternate" type="application/rss+xml" title="AI Lottery Hub UK results" href="${relative(route, '/uk/feed.xml')}">
<link rel="stylesheet" href="${relative(route, '/uk/site.css')}"></head>
<body><a class="skip" href="#content">Skip to content</a><header class="mast"><div class="wrap mast-inner">
<a class="brand" href="${relative(route, '/uk/')}"><span class="brand-mark">UK</span> AI Lottery Hub</a>
<nav aria-label="Game archives">${nav}</nav></div></header>
<main class="wrap" id="content">${content}</main>
<footer><div class="wrap foot-inner"><div><strong>AI Lottery Hub · UK results</strong><p>Independent draw reports for readers aged 18+.</p></div>
<nav aria-label="More from AI Lottery Hub">${navLink(route, '/', 'US results')}${navLink(route, '/uk/feed.xml', 'UK RSS feed')}</nav></div></footer></body></html>`;
}

function time(date) {
  return `<time datetime="${date}">${dateText(date)}</time>`;
}

function balls(label, values, special = false) {
  const items = ordered(values).map(number => '<li>' + number + '</li>').join('');
  return `<div class="ball-group${special ? ' special' : ''}"><span>${label}</span><ol role="list" aria-label="${label}">${items}</ol></div>`;
}

function numberPanel(row, round, label) {
  return `<section class="result"><h2>${label}</h2><div class="ball-row">${balls('Main numbers', round.numbers)}${balls(games[row.game].special, round.special, true)}</div></section>`;
}

function archiveLinks(rows, route) {
  return '<ul class="entries">' + rows.map(row => `<li><a href="${relative(route, articlePath(row))}"><span><strong>${games[row.game].name}</strong>${time(row.date)}</span><span class="arrow" aria-hidden="true">↗</span></a></li>`).join('') + '</ul>';
}

function summary(row) {
  const game = games[row.game];
  const second = row.round2 ? ' Both rounds are listed.' : '';
  return `${game.name} results for ${dateText(row.date)}. Main numbers ${joinNumbers(ordered(row.numbers))}. ${game.special} ${joinNumbers(ordered(row.special))}.${second}`;
}

function drawNotes(row, previous) {
  const nums = ordered(row.numbers);
  const consecutive = nums.slice(1).flatMap((num, i) => num === nums[i] + 1 ? [`${nums[i]}–${num}`] : []);
  const start = row.round2 ? 'The first round' : 'The draw';
  const odd = nums.filter(n => n % 2 === 1).length;
  const spread = `${start} spanned ${nums[0]} to ${nums.at(-1)} among the main numbers. `;
  const composition = consecutive.length
    ? `${joinNumbers(consecutive)} ${consecutive.length === 1 ? 'was the only consecutive pair' : 'were the consecutive pairs'}.`
    : `The main set contained ${odd} odd and ${nums.length - odd} even numbers.`;
  let comparison = '';
  if (previous) {
    const matches = nums.filter(n => previous.numbers.includes(n));
    const ref = `<a href="../${previous.date}/">${dateText(previous.date)}</a>`;
    const field = row.round2 || previous.round2 ? 'opening main numbers' : 'main numbers';
    comparison = matches.length
      ? `<p>Comparing the ${field} with the entry for ${ref}, ${matches.length} ${matches.length === 1 ? 'number appears' : 'numbers appear'} in both sets (${joinNumbers(matches)}).</p>`
      : `<p>The ${field} share no values with the set recorded on ${ref}.</p>`;
  }
  let detail = '';
  if (row.round2) {
    const overlap = ordered(row.round2.numbers).filter(n => nums.includes(n));
    detail = overlap.length
      ? `<p>The two rounds share ${overlap.length} main ${overlap.length === 1 ? 'number' : 'numbers'} (${joinNumbers(overlap)}).</p>`
      : '<p>All the main numbers changed between the first and second rounds.</p>';
  } else if (row.game === 'euromillions') {
    const overlap = ordered(row.special).filter(n => nums.includes(n));
    detail = overlap.length
      ? `<p>${joinNumbers(overlap)} ${overlap.length === 1 ? 'appears' : 'appear'} in both the main draw and the Lucky Stars. Each occurrence counts only in its own group when checking a line.</p>`
      : `<p>The Lucky Stars, ${joinNumbers(ordered(row.special))}, were both different from every main number in this draw.</p>`;
  } else if (row.game === 'thunderball') {
    const ball = row.special[0];
    if (nums.includes(ball)) {
      detail = `<p>${ball} appears twice on the result, once among the main numbers and once as the Thunderball. Check the two fields separately on your line.</p>`;
    } else if (ball < nums[0]) {
      detail = `<p>The Thunderball was ${ball}, below the lowest main number of ${nums[0]}.</p>`;
    }
  }
  return '<p>' + spread + composition + '</p>' + detail + comparison;
}

function appPanel(slug) {
  return `<aside class="app"><h2>Keep your ${games[slug].name} lines</h2><p>${games[slug].app}</p>
<a href="${appLink(slug)}">Lotto AI hub on Google Play <span aria-hidden="true">↗</span></a></aside>`;
}

function article(baseUrl, row, previous) {
  const route = articlePath(row);
  const game = games[row.game];
  const source = new URL(row.sourceUrl);
  if (source.protocol !== 'https:') throw new Error('UK draw source must use HTTPS: ' + row.sourceUrl);
  const official = 'https://www.national-lottery.co.uk/results/' + row.game + '/draw-history';
  const title = game.name + ' results for ' + dateText(row.date);
  return page({baseUrl, route, title, description: summary(row), article: true, content: `
<a class="back" href="../">← ${game.name} archive</a><article><header class="article-head"><p class="kicker">${game.name} draw report</p><h1>${time(row.date)}</h1></header>
${numberPanel(row, row, row.round2 ? 'First round' : 'Drawn numbers')}${row.round2 ? numberPanel(row, row.round2, 'Second round') : ''}
<div class="split reading"><section class="copy"><h2>A closer look</h2>${drawNotes(row, previous)}
<h2>Reading this result</h2><p>${game.guide}</p>
<p class="sources"><a href="${escape(source.href)}">Draw source at ${escape(source.hostname.replace(/^www\./, ''))}</a> · <a href="${official}">Check with The National Lottery</a></p></section>${appPanel(row.game)}</div></article>`});
}

function gameIndex(baseUrl, slug, rows) {
  const game = games[slug];
  const route = at(slug);
  const groups = new Map();
  for (const row of rows) {
    const key = row.date.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const archive = [...groups.values()].map((month, i) => `<details class="archive-month"${i === 0 ? ' open' : ''}><summary>${monthDate.format(dateObject(month[0].date))}</summary>${archiveLinks(month, route)}</details>`).join('');
  return page({baseUrl, route, title: game.name + ' results archive', description: game.guide, empty: !rows.length, content: `
<a class="back" href="../">← UK results</a><header class="intro"><p class="kicker">Game archive</p><h1>${game.name} results</h1><p>${game.guide}</p></header>
<div class="split"><section><h2>Draws by month</h2>${archive || '<p>The first sourced result will appear here after it has been added to the archive.</p>'}</section>${appPanel(slug)}</div>`});
}

function recentCard(slug, rows) {
  const game = games[slug];
  const latest = rows[0];
  const round = (result, label) => `<div class="compact">
    ${label ? `<h4>${label}</h4>` : ''}
    <div class="ball-row">${balls('Main numbers', result.numbers)}${balls(game.special, result.special, true)}</div>
  </div>`;
  return `<article class="game-card game-card--${slug}">
    <header><h3>${game.name}</h3>${latest ? time(latest.date) : ''}</header>
    ${latest
      ? round(latest, latest.round2 ? 'First round' : '') + (latest.round2 ? round(latest.round2, 'Second round') : '')
      : '<p>Waiting for the first draw report.</p>'}
    <div class="game-card-links">
      ${latest ? `<a href="${slug}/${latest.date}/" aria-label="Read the ${game.name} draw report">Draw report <span aria-hidden="true">→</span></a>` : ''}
      <a class="archive-link" href="${slug}/" aria-label="Browse the ${game.name} archive">Archive</a>
    </div>
  </article>`;
}

function home(baseUrl, byGame, all) {
  const route = '/uk/';
  const earlier = all.filter(row => row !== byGame[row.game][0]).slice(0, 12);
  return page({baseUrl, route, title: 'UK lottery results and draw reports',
    description: 'Read UK Lotto, EuroMillions and Thunderball results with the main numbers, special balls and a closer look at each draw.',
    empty: !all.length, content: `<header class="hero">
<div class="hero-copy"><p class="kicker">United Kingdom</p><h1>UK lottery <em>draw reports.</em></h1>
<p>Check the latest Lotto, EuroMillions and Thunderball numbers, then take a closer look at each draw.</p>
<div class="hero-actions"><a class="draw-link" href="#latest-results">Latest results <span aria-hidden="true">↓</span></a>
<a class="home-app" href="${appLink('home')}">Get the UK Android app <span aria-hidden="true">↗</span></a></div></div>
<img class="hero-art" src="lottery-balls.webp" alt="" width="1080" height="720" fetchpriority="high"></header>
<section class="latest-results" aria-labelledby="latest-results"><h2 id="latest-results">Latest results</h2>
<div class="game-grid">${Object.keys(games).map(slug => recentCard(slug, byGame[slug])).join('')}</div></section>
${earlier.length ? `<section class="recent"><h2>Earlier draws</h2>${archiveLinks(earlier, route)}</section>` : ''}`});
}

function feed(baseUrl, rows) {
  const items = rows.slice(0, 40).map(row => {
    const link = escape(absolute(baseUrl, articlePath(row)));
    return `<item><title>${escape(games[row.game].name + ' results for ' + dateText(row.date))}</title><link>${link}</link><guid>${link}</guid><description>${escape(summary(row))}</description><pubDate>${dateObject(row.date).toUTCString()}</pubDate></item>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>AI Lottery Hub · UK results</title><link>${escape(absolute(baseUrl, '/uk/'))}</link><atom:link href="${escape(absolute(baseUrl, '/uk/feed.xml'))}" rel="self" type="application/rss+xml"/><language>en-gb</language><description>UK Lotto, EuroMillions and Thunderball draw reports.</description>${items.join('')}</channel></rss>`;
}

async function readGame(dataDir, slug) {
  const dir = path.join(dataDir, slug);
  let files;
  try {
    files = await readdir(dir);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const rows = [];
  for (const file of files.filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse()) {
    const row = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
    if (row.game !== slug || row.date + '.json' !== file) throw new Error('UK draw does not match its archive path: ' + path.join(dir, file));
    rows.push(row);
  }
  return rows;
}

export async function buildUkSection({dataDir, distDir, baseUrl}) {
  const root = path.join(distDir, 'uk');
  await mkdir(root, {recursive: true});
  await copyFile(new URL('../assets/uk.css', import.meta.url), path.join(root, 'site.css'));
  await copyFile(new URL('../assets/uk-lottery-balls.webp', import.meta.url), path.join(root, 'lottery-balls.webp'));
  const urls = [];
  const byGame = {};
  async function savePage(route, html, lastmod) {
    const directory = path.join(distDir, route.slice(1));
    await mkdir(directory, {recursive: true});
    await writeFile(path.join(directory, 'index.html'), html);
    if (lastmod) urls.push({path: route, lastmod});
  }
  for (const slug of Object.keys(games)) {
    const rows = await readGame(dataDir, slug);
    byGame[slug] = rows;
    await savePage(at(slug), gameIndex(baseUrl, slug, rows), rows[0]?.date);
    for (let i = 0; i < rows.length; i++) {
      await savePage(articlePath(rows[i]), article(baseUrl, rows[i], rows[i + 1]), rows[i].date);
    }
  }
  const all = Object.values(byGame).flat().sort((a, b) => b.date.localeCompare(a.date) || a.game.localeCompare(b.game));
  await savePage('/uk/', home(baseUrl, byGame, all), all[0]?.date);
  await writeFile(path.join(root, 'feed.xml'), feed(baseUrl, all));
  return {urls};
}
