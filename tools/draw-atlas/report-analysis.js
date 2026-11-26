'use strict';

// Only the main pool sets the upper bound of the final ten-number band.
// Country is part of the key: Australian and US Powerball use different pools.
const mainMax = {
  us:{powerball:69, 'mega-millions':70, 'ny-lotto':59, 'millionaire-for-life':58, 'take-5':39},
  ca:{'lotto-649':49, 'lotto-max':52, 'daily-grand':49},
  uk:{lotto:59, euromillions:50, thunderball:39},
  au:{'saturday-lotto':45, powerball:35, 'weekday-windfall':45},
  kr:{'lotto-645':45},
  jp:{loto6:43, loto7:37, 'mini-loto':31}
};

// The original seven articles were published before the gameKey field existed.
const originalGames = {
  us:['Powerball', 'powerball'], ca:['Lotto 6/49', 'lotto-649'], uk:['Lotto', 'lotto'],
  au:['Saturday Lotto', 'saturday-lotto'], kr:['로또 6/45', 'lotto-645'], jp:['ロト6', 'loto6']
};

const text = {
  en:{
    title:'Inside the draw', note:'These figures use only the main numbers shown in the draw table.',
    parity:'Odd and even', counts:(odd, even) => `${odd} odd · ${even} even`,
    sum:'Sum of the main numbers', pairs:'Consecutive pairs', repeats:'Numbers in both draws',
    bands:'Main numbers in each range', none:'None'
  },
  fr:{
    title:'Le tirage en chiffres', note:'Ces calculs portent uniquement sur les numéros principaux du tableau.',
    parity:'Impairs et pairs',
    counts:(odd, even) => `${odd} impair${odd > 1 ? 's' : ''} · ${even} pair${even > 1 ? 's' : ''}`,
    sum:'Somme des numéros principaux', pairs:'Paires consécutives', repeats:'Numéros communs aux deux tirages',
    bands:'Numéros principaux par tranche', none:'Aucun'
  },
  ko:{
    title:'이번 회차 숫자 분석', note:'추첨 결과표의 본번호만 집계했습니다.',
    parity:'홀짝 구성', counts:(odd, even) => `홀수 ${odd}개 · 짝수 ${even}개`,
    sum:'본번호 합계', pairs:'연속 번호 쌍', repeats:'두 회차에 모두 나온 번호',
    bands:'구간별 본번호 개수', none:'없음'
  },
  ja:{
    title:'抽せん数字の内訳', note:'結果表にある本数字だけを集計しています。',
    parity:'奇数と偶数', counts:(odd, even) => `奇数${odd}個・偶数${even}個`,
    sum:'本数字の合計', pairs:'連番の組', repeats:'2回に共通する本数字',
    bands:'範囲別の本数字の個数', none:'なし'
  }
};

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g,
    character => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[character]));
}

function metric(label, value, context) {
  const detail = context ? `<br/><small class="atlas-analysis-context">${escapeHtml(context)}</small>` : '';
  return `<div class="atlas-analysis-metric"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}${detail}</dd></div>`;
}

function section(title, note, body) {
  return `<section class="atlas-analysis"><h2>${escapeHtml(title)}</h2>` +
    `<p class="atlas-analysis-note">${escapeHtml(note)}</p>${body}</section>`;
}

function mainNumbers(row) {
  if (!Array.isArray(row.main) || !row.main.length ||
      !row.main.every(n => Number.isSafeInteger(n) && n > 0) || new Set(row.main).size !== row.main.length) {
    throw new Error('Draw analysis requires distinct positive main numbers');
  }
  return [...row.main].sort((a, b) => a - b);
}

function drawRound(row) {
  const found = /\b(?:round\s*|r)([12])\b/i.exec(row.label);
  const round = String(row.round ?? found?.[1] ?? '');
  const day = row.date || (found && row.label.replace(found[0], '').replace(/^[\s·•|,;:/–—-]+|[\s·•|,;:/–—-]+$/g, ''));
  return {round, day};
}

function comparisons(rows, ukLotto) {
  if (!ukLotto) return [{latest:rows[0], prior:rows[1]}];
  const firstDay = drawRound(rows[0]).day;
  // A differently worded or partial result can still be summarised on its
  // own. Never compare two rounds of the same draw as consecutive draw dates.
  if (!firstDay) return [{latest:rows[0]}];
  const groups = [];
  for (const round of ['1', '2']) {
    const sameRound = rows.filter(row => drawRound(row).round === round);
    const latest = sameRound.find(row => drawRound(row).day === firstDay);
    if (!latest) continue;
    const prior = sameRound.find(row => drawRound(row).day && drawRound(row).day !== firstDay);
    groups.push({latest, prior});
  }
  return groups.length ? groups : [{latest:rows[0]}];
}

function rangeChart(numbers, maximum, heading) {
  if (!maximum || numbers[numbers.length - 1] > maximum) return '';
  const counts = Array(Math.ceil(maximum / 10)).fill(0);
  for (const number of numbers) counts[Math.floor((number - 1) / 10)]++;
  const items = counts.map((count, index) => {
    const start = index * 10 + 1;
    const end = Math.min(start + 9, maximum);
    const label = start === end ? String(start) : `${start}–${end}`;
    // Counts stay visible to readers without CSS and to users of feed readers.
    return `<li><span class="atlas-analysis-band-label">${label}</span> ` +
      `<meter class="atlas-analysis-meter" aria-hidden="true" min="0" max="${numbers.length}" value="${count}"></meter> ` +
      `<b>${count}</b></li>`;
  }).join('');
  return `<h4>${escapeHtml(heading)}</h4><ul class="atlas-analysis-bands">${items}</ul>`;
}

function numberGroup(latest, prior, copy, maximum, language) {
  const numbers = mainNumbers(latest);
  const odd = numbers.filter(n => n % 2 === 1).length;
  const pairs = [];
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] === numbers[i - 1] + 1) pairs.push(`${numbers[i - 1]}–${numbers[i]}`);
  }
  const fields = [
    metric(copy.parity, copy.counts(odd, numbers.length - odd)),
    metric(copy.sum, numbers.reduce((sum, n) => sum + n, 0)),
    metric(copy.pairs, pairs.length ? pairs.join(' · ') : (language === 'fr' ? 'Aucune' : copy.none))
  ];
  if (prior) {
    const earlier = new Set(mainNumbers(prior));
    const common = numbers.filter(n => earlier.has(n));
    fields.push(metric(copy.repeats, common.length ? common.join(' · ') : copy.none, prior.label));
  }
  return `<div class="atlas-analysis-group"><h3>${escapeHtml(latest.label)}</h3>` +
    `<dl class="atlas-analysis-grid">${fields.join('')}</dl>` +
    rangeChart(numbers, maximum, copy.bands) + '</div>';
}

function ticketAnalysis(rows) {
  const [latest, prior] = rows;
  if (!latest || !prior || ![latest, prior].every(r => typeof r.number === 'string' &&
      /^\d{6}$/.test(r.number) && typeof r.series === 'string' && r.series.trim())) {
    throw new Error('Ticket comparison requires two complete first-prize tickets with six digits');
  }
  const positions = Array.from(latest.number, (digit, i) => digit === prior.number[i] ? i + 1 : null)
    .filter(position => position !== null);
  let suffix = '';
  for (let i = 5; i >= 0 && latest.number[i] === prior.number[i]; i--) suffix = latest.number[i] + suffix;
  const fields = [
    metric('ടിക്കറ്റ് സീരീസ്', `${latest.series} / ${prior.series}`),
    metric('അവസാന നാല് അക്കങ്ങൾ', `${latest.number.slice(-4)} / ${prior.number.slice(-4)}`),
    metric('ഒരേ അക്കം വരുന്ന സ്ഥാനങ്ങൾ', positions.length ? positions.join(', ') : 'ഇല്ല', 'ഇടത്തുനിന്ന് വലത്തേക്ക് 1 മുതൽ 6 വരെ'),
    metric('ഒരുപോലെ അവസാനിക്കുന്ന അക്കങ്ങൾ', suffix || 'ഇല്ല')
  ];
  const body = `<div class="atlas-analysis-group"><dl class="atlas-analysis-grid">${fields.join('')}</dl></div>`;
  return section('ഒന്നാം സമ്മാന ടിക്കറ്റുകൾ തമ്മിൽ',
    'രണ്ട് ഒന്നാം സമ്മാന ടിക്കറ്റുകളുടെ വിവരങ്ങൾ പുതിയത് ആദ്യം എന്ന ക്രമത്തിലാണ് കാണിച്ചിരിക്കുന്നത്.', body);
}

function renderAnalysis(report) {
  if (report.key === 'in') return ticketAnalysis(report.chart.ticketRows);
  const language = report.language.split('-')[0];
  const copy = text[language];
  if (!copy) throw new Error('Unsupported report analysis language: ' + report.language);
  const original = originalGames[report.key];
  const game = report.gameKey || (report.game === original?.[0] ? original[1] : null);
  const groups = comparisons(report.chart.rows, report.key === 'uk' && game === 'lotto');
  const body = groups.map(({latest, prior}) =>
    numberGroup(latest, prior, copy, mainMax[report.key]?.[game], language)).join('');
  return section(copy.title, copy.note, body);
}

module.exports = {renderAnalysis};
