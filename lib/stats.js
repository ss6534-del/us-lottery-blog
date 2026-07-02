// 최근 N회차 통계 분석. draws는 최신순 [{date, white[], special}].

export function analyze(game, draws, windowSize = 50) {
  const win = draws.slice(0, windowSize);
  const n = win.length;
  if (n === 0) throw new Error(`No draws to analyze for ${game.id}`);

  // ── 출현 빈도 ──
  const freq = new Array(game.whiteMax + 1).fill(0);
  for (const d of win) for (const num of d.white) freq[num]++;

  const byFreq = [];
  for (let num = 1; num <= game.whiteMax; num++) byFreq.push({ num, count: freq[num] });
  const hotSorted = [...byFreq].sort((a, b) => b.count - a.count || a.num - b.num);
  const coldSorted = [...byFreq].sort((a, b) => a.count - b.count || a.num - b.num);

  // ── 미출현(오버듀) 기간: 마지막 출현 이후 지난 회차 수 ──
  const lastSeen = new Array(game.whiteMax + 1).fill(-1);
  win.forEach((d, idx) => {
    for (const num of d.white) if (lastSeen[num] === -1) lastSeen[num] = idx;
  });
  const overdue = [];
  for (let num = 1; num <= game.whiteMax; num++) {
    overdue.push({ num, gap: lastSeen[num] === -1 ? n : lastSeen[num] });
  }
  overdue.sort((a, b) => b.gap - a.gap || a.num - b.num);

  // ── 홀짝 / 고저 분포 ──
  const lowMax = Math.floor(game.whiteMax / 2);
  const oddSplits = {};
  const lowSplits = {};
  for (const d of win) {
    const odd = d.white.filter((x) => x % 2 === 1).length;
    const low = d.white.filter((x) => x <= lowMax).length;
    oddSplits[odd] = (oddSplits[odd] || 0) + 1;
    lowSplits[low] = (lowSplits[low] || 0) + 1;
  }
  const topOddSplit = topKey(oddSplits);
  const topLowSplit = topKey(lowSplits);

  // ── 번호 합계 ──
  const sums = win.map((d) => d.white.reduce((a, b) => a + b, 0));
  const sorted = [...sums].sort((a, b) => a - b);
  const sumStats = {
    avg: Math.round(sums.reduce((a, b) => a + b, 0) / n),
    min: sorted[0],
    max: sorted[n - 1],
    p25: sorted[Math.floor(n * 0.25)],
    p75: sorted[Math.min(n - 1, Math.floor(n * 0.75))],
  };

  // ── 연속수 / 직전 회차 반복수 ──
  let consecCount = 0;
  for (const d of win) {
    const s = [...d.white].sort((a, b) => a - b);
    if (s.some((v, i) => i > 0 && v === s[i - 1] + 1)) consecCount++;
  }
  let repeatCount = 0;
  for (let i = 0; i < win.length - 1; i++) {
    const prev = new Set(win[i + 1].white);
    if (win[i].white.some((x) => prev.has(x))) repeatCount++;
  }

  // ── 스페셜 볼 빈도 ──
  let specialHot = [];
  if (game.specialMax > 0) {
    const sf = new Array(game.specialMax + 1).fill(0);
    for (const d of win) if (d.special !== null) sf[d.special]++;
    specialHot = [];
    for (let num = 1; num <= game.specialMax; num++) specialHot.push({ num, count: sf[num] });
    specialHot.sort((a, b) => b.count - a.count || a.num - b.num);
  }

  return {
    window: n,
    latest: win[0],
    previous: win[1] || null,
    freq: freq.slice(1), // index 0 → number 1
    maxFreq: hotSorted[0].count,
    hot: hotSorted.slice(0, 7),
    cold: coldSorted.slice(0, 7),
    overdue: overdue.slice(0, 7),
    oddSplit: {
      best: Number(topOddSplit),
      pct: pct(oddSplits[topOddSplit], n),
      avgOdd: round1(win.reduce((a, d) => a + d.white.filter((x) => x % 2 === 1).length, 0) / n),
    },
    lowSplit: {
      best: Number(topLowSplit),
      pct: pct(lowSplits[topLowSplit], n),
      lowMax,
    },
    sum: sumStats,
    consecutivePct: pct(consecCount, n),
    repeatPct: win.length > 1 ? pct(repeatCount, win.length - 1) : 0,
    specialHot: specialHot.slice(0, 3),
  };
}

function topKey(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0][0];
}
function pct(count, total) {
  return Math.round((count / total) * 100);
}
function round1(x) {
  return Math.round(x * 10) / 10;
}
