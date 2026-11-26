'use strict';

// Run node build-report-import.js in any directory. Import the resulting XML
// through Blogger Settings > Manage blog > Import content.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {renderAnalysis} = require('./report-analysis.js');
const keys = ['us', 'ca', 'uk', 'au', 'in', 'kr', 'jp'];
const blogId = '3280204798052215871';
const site = 'https://goldnum.blogspot.com';
// The first seven reports predate per-game permalinks and draw markers.
const seedGameKeys = {us:'powerball', ca:'lotto-649', uk:'lotto', au:'saturday-lotto', in:'karunya', kr:'lotto-645', jp:'loto6'};
const countryLanguages = {us:'en', ca:'en', uk:'en', au:'en', in:'ml', kr:'ko', jp:'ja'};
const gameSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const words = {
  en: {draw:'Draw', table:'Draw comparison', sources:'Sources', repeated:'Main numbers common to the two draws', frequency:'Main-number frequency', count:'Appearances', number:'Number'},
  fr: {draw:'Tirage', table:'Comparaison des tirages', sources:'Sources', repeated:'Numéros principaux communs aux deux tirages', frequency:'Fréquence des numéros principaux', count:'Apparitions', number:'Numéro'},
  ko: {draw:'회차', table:'회차별 당첨번호', sources:'자료 출처', repeated:'최근 두 회차에 모두 나온 본번호', frequency:'본번호 출현 빈도', count:'출현 횟수', number:'번호'},
  ja: {draw:'抽せん回', table:'抽せん結果の比較', sources:'出典', repeated:'直近2回に共通する本数字', frequency:'本数字の出現回数', count:'回数', number:'数字'},
  ml: {draw:'നറുക്കെടുപ്പ്', table:'രണ്ട് നറുക്കെടുപ്പുകളിലെ ഒന്നാം സമ്മാന ടിക്കറ്റുകൾ', sources:'ഉറവിടങ്ങൾ', series:'സീരീസ്', ticket:'ആറക്ക നമ്പർ'}
};
const cell = 'padding:.5em .35em;border-bottom:1px solid #c8c8c8;text-align:start;vertical-align:top';
const escapeXml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));

function ballGroup(numbers, label, pool, repeated = []) {
  if (!numbers.length) return '';
  const balls = numbers.map(n => {
    requireValue(Number.isSafeInteger(n) && n > 0, 'Invalid number ball');
    const classes = ['atlas-ball', pool === 'extra' ? 'atlas-ball-extra' : 'atlas-ball-main', 'atlas-band-' + Math.ceil(n / 10)];
    if (repeated.includes(n)) classes.push('is-repeat');
    return `<span class="${classes.join(' ')}" data-number="${n}">${n}</span>`;
  }).join(' ');
  return `<span role="group" aria-label="${escapeXml(label)}" class="atlas-ball-group atlas-${pool}-group" style="--atlas-count:${numbers.length}">${balls}</span>`;
}

function drawChart(report, text) {
  const chart = report.chart;
  let headers, rows, note = '';
  if (chart.ticketRows) {
    headers = [text.draw, text.series, text.ticket];
    rows = chart.ticketRows.map(row => [escapeXml(row.label),
      `<span class="atlas-ticket-series">${escapeXml(row.series)}</span>`,
      `<span class="atlas-ticket-number">${escapeXml(row.number)}</span>`]);
  } else {
    const [current, previous] = chart.rows;
    // UK Lotto can have two rounds on a single date; its round comparisons are in the analysis.
    const shared = report.key === 'uk' && report.gameKey === 'lotto' ? [] :
      current.main.filter(n => previous.main.includes(n));
    const hasExtra = chart.rows.some(row => row.extra.length);
    headers = [text.draw, chart.mainLabel, ...(hasExtra ? [chart.extraLabel] : [])];
    rows = chart.rows.map((row,i) => [escapeXml(row.label),
      ballGroup(row.main, chart.mainLabel, 'main', i < 2 ? shared : []),
      ...(hasExtra ? [ballGroup(row.extra, chart.extraLabel, 'extra')] : [])]);
    if (shared.length) note = `<p><strong>${escapeXml(text.repeated)}</strong> · ${shared.join(', ')}</p>`;
  }
  const header = headers.map(s => `<th scope="col" style="${cell}">${escapeXml(s)}</th>`).join('');
  const cellClasses = chart.ticketRows ? ['atlas-series-cell', 'atlas-ticket-cell'] : ['atlas-main-cell', 'atlas-extra-cell'];
  const lines = rows.map(([label, ...results]) => {
    const cells = results.map((result,i) => `<td class="${cellClasses[i]}" data-label="${escapeXml(headers[i + 1])}" style="${cell}">${result}</td>`).join('');
    return `<tr><th scope="row" style="${cell}">${label}</th>${cells}</tr>`;
  }).join('\n');
  const tableClass = chart.ticketRows ? 'atlas-ticket-draws' : (headers.length === 2 ? 'atlas-no-extra' : '');
  return `<table class="atlas-report-draws ${tableClass}" style="width:100%;border-collapse:collapse"><caption style="text-align:start;font-weight:bold">${escapeXml(text.table)}</caption><thead><tr>${header}</tr></thead><tbody>${lines}</tbody></table>${note}`;
}

function frequencyChart(history, text, language) {
  if (!history) return '';
  const date = new Intl.DateTimeFormat(language, {year:'numeric', month:'short', day:'numeric', timeZone:'UTC'});
  const start = date.format(new Date(history.from + 'T00:00:00Z'));
  const end = date.format(new Date(history.to + 'T00:00:00Z'));
  const groups = new Map();
  for (const hit of history.hits) {
    if (!Number.isInteger(hit.count) || hit.count < 1 || hit.count > history.count || !Number.isInteger(hit.number)) throw new Error('Invalid frequency chart value');
    if (!groups.has(hit.count)) groups.set(hit.count, []);
    groups.get(hit.count).push(hit.number);
  }
  // The plain counts and denominator are visible even if an email reader
  // removes the inline bar styling. Each bar is scaled to all draws, not the biggest count.
  const rows = Array.from(groups, ([count, numbers]) => {
    const bar = `<span aria-hidden="true" style="display:block;width:100%;height:8px;background:#e4e5df;margin-top:5px"><span style="display:block;height:8px;width:${100 * count / history.count}%;background:#347164"></span></span>`;
    return `<tr><th scope="row" style="${cell}">${count} / ${history.count}${bar}</th><td style="${cell}">${ballGroup(numbers, text.number, 'frequency')}</td></tr>`;
  }).join('');
  return `<table class="atlas-report-frequency" style="width:100%;border-collapse:collapse"><caption style="text-align:start;font-weight:bold">${escapeXml(history.label)}<br/><small>${escapeXml(start)} – ${escapeXml(end)}</small></caption><thead><tr><th scope="col" style="${cell}">${escapeXml(text.count)}</th><th scope="col" style="${cell}">${escapeXml(text.number)}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ICU keeps decimals, quotation marks and Japanese punctuation intact. It can
// still propose a break between a title or place abbreviation and a proper name.
function reportSentences(value, language) {
  const parts = [];
  const split = new Intl.Segmenter(language, {granularity:'sentence'});
  for (const {index, segment} of split.segment(value)) {
    const previous = parts.at(-1);
    const end = previous?.segment.trimEnd() ?? '';
    const title = /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|St|M|Mme|Mlle|Me)|ഡോ|ശ്രീ)\.$/iu.test(end);
    const beforeNumber = /^\d/u.test(segment) &&
      /\b(?:Janv?|Feb|Févr|Mar|Apr|Avr|Jun|Jul|Juil|Aug|Sept?|Oct|Nov|Dec|Déc|No|Fig|Ch|p|pp)\.$/iu.test(end);
    const dotted = /(?:\b[A-Z]\.){2,}$|\b(?:i\.e|e\.g)\.$/u.test(end);
    const sentenceOpener = /^(?:The|These|Those|This|That|It|They|There|On|In|We|Both|However|Le|La|Ce|Cette|Les)\b/u.test(segment);
    if (previous && (title || beforeNumber || (dotted && !sentenceOpener))) {
      previous.segment += segment;
    } else {
      parts.push({index, segment});
    }
  }
  return parts;
}

function reportParagraphs(value, language, {lead = false, emphasis} = {}) {
  requireValue(emphasis === undefined || (isText(emphasis) && value.includes(emphasis)),
    'Report emphasis must be an exact excerpt from the source text');
  const limits = {ja:68, ko:110, en:175, fr:185, ml:210};
  const limit = limits[language.split('-')[0]] || limits.en;
  const paragraphs = [];
  for (const block of value.trim().split(/(?:\r?\n[\t ]*){2,}/)) {
    const selectedAt = emphasis ? block.indexOf(emphasis) : -1;
    let start = 0;
    for (const {index, segment} of reportSentences(block, language)) {
      const insideEmphasis = selectedAt >= 0 && index > selectedAt && index < selectedAt + emphasis.length;
      if (index - start >= limit / 2 && index + segment.trimEnd().length - start > limit && !insideEmphasis) {
        paragraphs.push({text:block.slice(start, index).trim(), emphasis:''});
        start = index;
      }
    }
    const rest = block.slice(start).trim();
    if (rest) paragraphs.push({text:rest, emphasis:''});
  }
  if (emphasis !== undefined) {
    const target = paragraphs.find(p => p.text.includes(emphasis));
    requireValue(target, 'Report emphasis must be within one paragraph');
    target.emphasis = emphasis;
  } else if (lead && paragraphs.length) {
    const first = reportSentences(paragraphs[0].text, language)[0].segment.trim();
    if (first.length <= limit && first !== value.trim()) paragraphs[0].emphasis = first;
  }
  return paragraphs;
}

function prose(value, language, options) {
  return reportParagraphs(value, language, options).map(({text, emphasis}, i) => {
    const at = emphasis ? text.indexOf(emphasis) : -1;
    const copy = reportSentences(text, language).map(({index, segment}) => {
      // Intersect the emphasis range with this sentence so a cross-sentence
      // excerpt retains its emphasis on both lines, without invalid nested HTML.
      const start = Math.max(0, at - index);
      const end = Math.min(segment.length, at + emphasis.length - index);
      const marked = at >= 0 && end > start ?
        escapeXml(segment.slice(0,start)) + `<strong class="atlas-report-emphasis">${escapeXml(segment.slice(start,end))}</strong>` + escapeXml(segment.slice(end)) :
        escapeXml(segment);
      return `<span class="atlas-sentence">${marked}</span>`;
    }).join('<br class="atlas-sentence-break"/>');
    const role = options.lead ? (i === 0 ? ' class="atlas-report-lead"' : ' class="atlas-report-intro-copy"') : '';
    return `<p${role}>${copy}</p>`;
  }).join('\n');
}

function article(report, languages = '') {
  const gameKey = report.gameKey ?? seedGameKeys[report.key];
  requireValue(keys.includes(report.key) && typeof gameKey === 'string' && gameSlug.test(gameKey), 'Unexpected country or game');
  report = {...report, gameKey};
  const base = report.language.split('-')[0];
  const text = words[base];
  if (!text || !report.intro || !report.sources.length || !report.sections.length) throw new Error('Incomplete article: ' + report.key);
  const sourceList = report.sources.map(source => {
    const url = new URL(source.url);
    if (url.protocol !== 'https:') throw new Error('Use HTTPS for source: ' + source.url);
    return `<li><a href="${escapeXml(url.href)}">${escapeXml(source.label)}</a></li>`;
  }).join('');
  const title = languages === 'atlas-lang-fr' ? `<h2 class="atlas-report-title">${escapeXml(report.title)}</h2>` : '';
  const lead = prose(report.intro, report.language, {lead:true, emphasis:report.introEmphasis});
  const sections = report.sections.map(s => `<section class="atlas-report-section"><h2>${escapeXml(s.heading)}</h2>
${prose(s.text, report.language, {emphasis:s.emphasis})}</section>`).join('\n');
  const classes = ['atlas-report', 'atlas-edition-' + report.key, 'atlas-game-' + gameKey, languages].filter(Boolean).join(' ');
  return `<div class="${classes}" lang="${escapeXml(report.language)}" data-country="${report.key}" data-game="${gameKey}">${title}${lead}
${drawChart(report, text)}
${renderAnalysis(report)}
${sections}
${frequencyChart(report.chart.history, text, report.language)}
<section class="atlas-report-sources"><h2>${escapeXml(text.sources)}</h2><ul>${sourceList}</ul></section></div>`;
}

function readReport(key) {
  const filename = path.join(__dirname, 'reports', key + '.json');
  const report = JSON.parse(fs.readFileSync(filename, 'utf8'));
  if (report.key !== key || report.labels[0] !== key.toUpperCase() || !/^\d{4}-\d{2}-\d{2}$/.test(report.date)) {
    throw new Error('Unexpected article key, label, or date in ' + filename);
  }
  return report;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function isText(value) {
  return typeof value === 'string' && Boolean(value.trim()) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
}

function reportIdentity(report) {
  requireValue(report && keys.includes(report.key), 'Unknown report country');
  requireValue(typeof report.gameKey === 'string' && gameSlug.test(report.gameKey), 'Expected lowercase gameKey such as powerball');
  requireValue(validDate(report.date), 'Invalid draw date');
  const parts = ['atlas', report.key, report.gameKey, report.date];
  if (report.drawSlot !== undefined) {
    requireValue(typeof report.drawSlot === 'string' && gameSlug.test(report.drawSlot), 'Invalid drawSlot');
    parts.push(report.drawSlot);
  }
  return parts.join('-');
}

function validateArticle(report) {
  for (const field of ['game','title','intro','language']) {
    requireValue(isText(report[field]), 'Missing article field: ' + field);
  }
  requireValue(Array.isArray(report.sections) && report.sections.length > 0 &&
    report.sections.every(s => s && isText(s.heading) && isText(s.text)), 'Missing section heading or text');
  requireValue(Array.isArray(report.sources) && report.sources.length > 0, 'Missing sources');
  for (const source of report.sources) {
    requireValue(source && isText(source.label) && isText(source.url), 'Missing source label or URL');
    const url = new URL(source.url);
    requireValue(url.protocol === 'https:' && !url.username && !url.password, 'Expected HTTPS source URL without credentials');
  }
  const chart = report.chart;
  requireValue(chart && typeof chart === 'object', 'Missing draw comparison');
  if (chart.ticketRows !== undefined) {
    requireValue(report.key === 'in' && Array.isArray(chart.ticketRows) && chart.ticketRows.length >= 2 &&
      chart.ticketRows.every(r => r && isText(r.label) && isText(r.series) && typeof r.number === 'string' &&
        /^\d{6}$/.test(r.number)), 'Expected two Kerala first-prize ticket rows with series and six-digit numbers');
  } else {
    const validNumbers = values => Array.isArray(values) && values.every(n => Number.isSafeInteger(n) && n > 0) &&
      new Set(values).size === values.length;
    requireValue(report.key !== 'in' && isText(chart.mainLabel) && isText(chart.extraLabel) &&
      Array.isArray(chart.rows) && chart.rows.length >= 2 &&
      chart.rows.every(r => r && isText(r.label) && validNumbers(r.main) && r.main.length && validNumbers(r.extra)),
    'Expected two or more labelled draw rows with numeric main and extra lists');
  }
  if (chart.history !== undefined) {
    const h = chart.history;
    requireValue(h && isText(h.label) && Number.isSafeInteger(h.count) && h.count > 0 &&
      validDate(h.from) && validDate(h.to) && h.from <= h.to && h.to <= report.date &&
      Array.isArray(h.hits) && h.hits.length && h.hits.every(hit => hit && Number.isSafeInteger(hit.number) &&
        hit.number > 0 && Number.isSafeInteger(hit.count) && hit.count >= 1 && hit.count <= h.count) &&
      new Set(h.hits.map(hit => hit.number)).size === h.hits.length, 'Invalid frequency history');
  }
}

function validateBatchReport(report) {
  const identity = reportIdentity(report);
  requireValue(Array.isArray(report.labels) && report.labels[0] === report.key.toUpperCase() &&
    report.labels.every(isText) && new Set(report.labels).size === report.labels.length, 'Missing or invalid country label');
  requireValue(!report.labels.slice(1).some(label => keys.includes(label.toLowerCase())), 'Conflicting country labels');
  validateArticle(report);
  requireValue(report.language.split('-')[0] === countryLanguages[report.key], 'Unexpected language for country');
  if (report.key === 'ca') {
    requireValue(report.fr && report.fr.language === 'fr-CA', 'Canada requires a French translation');
    requireValue((report.fr.key === undefined || report.fr.key === report.key) &&
      (report.fr.date === undefined || report.fr.date === report.date), 'Canadian translations disagree on country or draw date');
    const fr = {...report.fr, key:'ca', date:report.date, game:report.game};
    validateArticle(fr);
    const numbers = chart => JSON.stringify(chart.rows.map(r => [r.main,r.extra]));
    requireValue(numbers(report.chart) === numbers(fr.chart), 'Canadian translations disagree on draw results');
  } else {
    requireValue(report.fr === undefined, 'Unexpected French variant');
  }
  if (report.key === 'jp') {
    requireValue(!/(?:play\.google\.com|market:\/\/|apps\.apple\.com|itunes\.apple\.com|itms-apps:\/\/)/i.test(JSON.stringify(report)), 'Japan reports must omit app store promotions');
  }
  return identity;
}

function renderReportBody(report, identity) {
  const body = report.fr ? article({...report, language:'en-CA'}, 'atlas-lang-en') + '\n' +
    article({...report, ...report.fr, introEmphasis:report.fr.introEmphasis, key:report.key, language:'fr-CA'}, 'atlas-lang-fr') : article(report);
  if (!identity) return body;
  requireValue(identity === reportIdentity(report), 'Body identity differs from report');
  return `<div class="atlas-draw ${identity}" data-draw-atlas-id="${identity}">${body}</div>`;
}

function makeEntry(report, published, identity) {
  const idSeed = identity ? [blogId, identity].join('|') : [blogId, report.key, report.game, report.date].join('|');
  const number = crypto.createHash('sha256').update(idSeed).digest().readBigUInt64BE() & 0x7fffffffffffffffn;
  const postId = 'tag:blogger.com,1999:blog-' + blogId + '.post-' + number;
  const blogMonth = (identity ? report.date : published).slice(0,7).replace('-', '/');
  const slug = identity || 'atlas-' + report.key + '-' + report.date;
  const permalink = site + '/' + blogMonth + '/' + slug + '.html';
  const labels = report.labels.map(label => `<category scheme="http://www.blogger.com/atom/ns#" term="${escapeXml(label)}"/>`).join('\n');
  const body = renderReportBody(report, identity);
  return `<entry>
<id>${postId}</id><published>${published}</published><updated>${published}</updated>
<category scheme="http://schemas.google.com/g/2005#kind" term="http://schemas.google.com/blogger/2008/kind#post"/>
${labels}
<title type="text">${escapeXml(report.title)}</title><content type="html">${escapeXml(body)}</content>
<author><name>Draw Atlas</name></author>
<link rel="alternate" type="text/html" href="${escapeXml(permalink)}"/>
</entry>`;
}

function renderFeed(entries, instant) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>tag:blogger.com,1999:blog-${blogId}</id><updated>${new Date(instant).toISOString()}</updated>
<title type="text">Draw Atlas</title><author><name>Draw Atlas</name></author><link rel="alternate" type="text/html" href="${site}/"/>
${entries.join('\n')}
</feed>\n`;
}

function build() {
  const instant = Date.now();
  const entries = keys.map(readReport).map((report,i) => makeEntry(report, new Date(instant-i*1000).toISOString()));
  fs.writeFileSync(path.join(__dirname, 'reports-to-import.xml'), renderFeed(entries, instant), 'utf8');
}

function buildBatch(destination, filenames) {
  requireValue(destination && path.extname(destination).toLowerCase() === '.xml' && filenames.length,
    'Usage: node build-report-import.js --batch OUTPUT.xml REPORT.json [REPORT.json ...]');
  const output = path.resolve(destination);
  requireValue(output.toLowerCase() !== path.join(__dirname, 'reports-to-import.xml').toLowerCase(), 'Choose a separate incremental output XML');
  const seen = new Set();
  const seeds = new Map(keys.map(key => [key, readReport(key)]));
  const instant = Date.now();
  const entries = filenames.map((filename, i) => {
    try {
      const report = JSON.parse(fs.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
      const identity = validateBatchReport(report);
      const seed = seeds.get(report.key);
      const alreadyPublished = report.date === seed.date && (report.gameKey === seedGameKeys[report.key] || report.game === seed.game);
      requireValue(!alreadyPublished, 'Initial report already published at /2026/11/atlas-' + report.key + '-' + report.date + '.html');
      requireValue(!seen.has(identity), 'Duplicate draw in batch: ' + identity);
      seen.add(identity);
      return makeEntry(report, new Date(instant-i*1000).toISOString(), identity);
    } catch (err) {
      throw new Error(filename + ': ' + err.message);
    }
  });
  const temporary = output + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, renderFeed(entries, instant), {encoding:'utf8', flag:'wx'});
    fs.renameSync(temporary, output);
  } finally {
    fs.rmSync(temporary, {force:true});
  }
  return [...seen];
}

module.exports = {reportIdentity, buildBatch, reportSentences, reportParagraphs, renderReportBody, article};
if (require.main === module) {
  const [mode, destination, ...files] = process.argv.slice(2);
  try {
    if (mode === undefined) build();
    else if (mode === '--batch') console.log(buildBatch(destination, files).join('\n'));
    else throw new Error('Expected --batch OUTPUT.xml REPORT.json [REPORT.json ...] or no arguments');
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
