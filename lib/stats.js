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

/**
 * 주간 심층 분석용 지표 — 용지 패턴(구간·끝수), 회귀/트렌드, 모멘텀,
 * 사카이(인접수), 직접 조합용 번호 풀.
 */
export function analyzeDeep(game, draws, windowSize = 50) {
  const win = draws.slice(0, windowSize);
  const n = win.length;
  if (n < 5) throw new Error(`Not enough draws for deep analysis of ${game.id}`);

  // ── 용지 패턴: 끝수(0~9) 분포 ──
  const digits = new Array(10).fill(0);
  for (const d of win) for (const num of d.white) digits[num % 10]++;

  // ── 용지 패턴: 구간(10단위 행) 분포 ──
  const decCount = Math.ceil(game.whiteMax / 10);
  const decades = new Array(decCount).fill(0);
  for (const d of win) for (const num of d.white) decades[Math.floor((num - 1) / 10)]++;
  const decadeLabels = Array.from({ length: decCount }, (_, i) =>
    `${i * 10 + 1}–${Math.min((i + 1) * 10, game.whiteMax)}`
  );

  // ── 사카이(인접수): 직전 회차 번호 ±1이 다음 회차에 등장하는 비율 ──
  let nbrHits = 0;
  for (let i = 0; i < n - 1; i++) {
    const nbr = new Set();
    for (const x of win[i + 1].white) {
      if (x > 1) nbr.add(x - 1);
      if (x < game.whiteMax) nbr.add(x + 1);
    }
    if (win[i].white.some((x) => nbr.has(x))) nbrHits++;
  }
  const neighborRate = n > 1 ? Math.round((nbrHits / (n - 1)) * 100) : 0;
  const latestSet = new Set(win[0].white);
  const neighborPool = [];
  for (const x of win[0].white) {
    for (const v of [x - 1, x + 1]) {
      if (v >= 1 && v <= game.whiteMax && !latestSet.has(v) && !neighborPool.includes(v)) {
        neighborPool.push(v);
      }
    }
  }
  neighborPool.sort((a, b) => a - b);

  // ── 회귀/트렌드: 최근 20회 합계의 선형회귀 기울기 ──
  const sumsAsc = win
    .slice(0, Math.min(20, n))
    .map((d) => d.white.reduce((a, b) => a + b, 0))
    .reverse(); // 과거→최근
  const m = sumsAsc.length;
  const xb = (m - 1) / 2;
  const yb = sumsAsc.reduce((a, b) => a + b, 0) / m;
  let cov = 0, varx = 0;
  sumsAsc.forEach((y, x) => {
    cov += (x - xb) * (y - yb);
    varx += (x - xb) * (x - xb);
  });
  const slope = varx ? cov / varx : 0;
  const sumTrend = {
    slope: Math.round(slope * 10) / 10,
    direction: slope > 0.8 ? "rising" : slope < -0.8 ? "falling" : "flat",
    series: sumsAsc,
    avg: Math.round(yb),
  };

  // ── 모멘텀: 최근 10회 출현율 vs 윈도 전체 출현율 ──
  const c10 = new Array(game.whiteMax + 1).fill(0);
  const cAll = new Array(game.whiteMax + 1).fill(0);
  win.slice(0, 10).forEach((d) => d.white.forEach((x) => c10[x]++));
  win.forEach((d) => d.white.forEach((x) => cAll[x]++));
  const mom = [];
  for (let v = 1; v <= game.whiteMax; v++) {
    mom.push({ num: v, r: c10[v] / 10 - cAll[v] / n, c10: c10[v], cAll: cAll[v] });
  }
  const expected = (n * game.whiteCount) / game.whiteMax;
  const risers = mom.filter((x) => x.c10 >= 2).sort((a, b) => b.r - a.r).slice(0, 5);
  const fallers = mom
    .filter((x) => x.c10 === 0 && x.cAll >= Math.ceil(expected))
    .sort((a, b) => b.cAll - a.cAll)
    .slice(0, 5);

  // ── 직접 조합용 번호 풀 ──
  const byFreq = [];
  for (let v = 1; v <= game.whiteMax; v++) byFreq.push({ num: v, count: cAll[v] });
  byFreq.sort((a, b) => b.count - a.count || a.num - b.num);
  const hotPool = byFreq.slice(0, 8);
  const midStart = Math.floor(byFreq.length / 2) - 4;
  const midPool = byFreq.slice(midStart, midStart + 8);
  const lastSeen = new Array(game.whiteMax + 1).fill(-1);
  win.forEach((d, idx) => {
    for (const num of d.white) if (lastSeen[num] === -1) lastSeen[num] = idx;
  });
  const overduePool = [];
  for (let v = 1; v <= game.whiteMax; v++) {
    overduePool.push({ num: v, gap: lastSeen[v] === -1 ? n : lastSeen[v] });
  }
  overduePool.sort((a, b) => b.gap - a.gap || a.num - b.num);

  return {
    window: n,
    digits,
    decades,
    decadeLabels,
    neighborRate,
    neighborPool,
    sumTrend,
    risers,
    fallers,
    pools: {
      hot: hotPool,
      mid: midPool.sort((a, b) => a.num - b.num),
      overdue: overduePool.slice(0, 6),
    },
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

// ════════════════════════════════════════════════════════════════════════════
//  Advanced modules (recurrence · frequency/gap bands + backtest · popularity)
//  All draws are newest-first: draws[0] = latest. Pure functions, no I/O.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Recurrence ("휴식") analysis. For a step s, two draws s apart are compared;
 * a draw "rests" for step s when it shares NO white number with the draw s before it.
 * currentRest = trailing run of rests from the latest draw; maxRest = longest run
 * that has already ended. currentRest ≥ maxRest ⇒ a record-long rest = "recurrence due".
 */
export function analyzeRecurrence(game, draws, windowSize = 60, maxStep = 40) {
  const win = draws.slice(0, windowSize);
  const n = win.length;
  const cap = Math.min(maxStep, n - 2);
  const steps = [];
  for (let s = 1; s <= cap; s++) {
    let current = 0, max = 0, run = 0, trailing = true, lastHit = -1;
    for (let i = 0; i <= n - 1 - s; i++) {
      const bset = new Set(win[i + s].white);
      const rest = !win[i].white.some((x) => bset.has(x));
      if (rest) {
        run++;
      } else {
        if (trailing) { current = run; trailing = false; }
        if (run > max) max = run;
        run = 0;
        if (lastHit === -1) lastHit = i;
      }
    }
    if (trailing) current = run; // never broke: whole series rested
    else if (run > max) max = run;
    steps.push({ s, current, max, diff: current - max, lastHit });
  }
  const hot = steps
    .filter((r) => r.current >= r.max && r.current > 0)
    .sort((a, b) => b.diff - a.diff || b.current - a.current || a.s - b.s);
  // Candidate numbers for the NEXT draw: numbers s draws before the next draw (= win[s-1]).
  const cand = new Array(game.whiteMax + 1).fill(0);
  for (const r of hot) {
    const src = win[r.s - 1];
    if (src) for (const nu of src.white) cand[nu]++;
  }
  const candidates = [];
  for (let nu = 1; nu <= game.whiteMax; nu++) if (cand[nu] > 0) candidates.push({ num: nu, hits: cand[nu] });
  candidates.sort((a, b) => b.hits - a.hits || a.num - b.num);
  return { window: n, maxStep: cap, steps, hot: hot.slice(0, 12), candidates: candidates.slice(0, 14) };
}

const GAP_BAND = (g) => (g <= 4 ? g : g <= 6 ? 5 : g <= 9 ? 6 : 7);
export const GAP_BAND_LABEL = ["Out 0 (just hit)", "Out 1", "Out 2", "Out 3", "Out 4", "Out 5–6", "Out 7–9", "Out 10+"];

/** Rolling lift: classify every number into a band from a lookback window, then
 *  measure how many of the next draw's numbers fell in each band vs random. */
function liftByBand(draws, windowSize, M, C, classifierFor) {
  const agg = {};
  for (let j = 0; j < draws.length; j++) {
    const lb = draws.slice(j + 1, j + 1 + windowSize);
    if (lb.length < windowSize) continue;
    const bandOf = classifierFor(lb);
    const sizes = {};
    for (let x = 1; x <= M; x++) { const b = bandOf(x); sizes[b] = (sizes[b] || 0) + 1; }
    for (const b in sizes) {
      const a = (agg[b] = agg[b] || { act: 0, exp: 0, rounds: 0, size: 0 });
      a.exp += (sizes[b] * C) / M; a.rounds++; a.size += sizes[b];
    }
    for (const x of draws[j].white) agg[bandOf(x)].act++;
  }
  return Object.entries(agg)
    .map(([b, a]) => ({
      band: Number(b), rounds: a.rounds,
      avgSize: round1(a.size / a.rounds),
      act: Math.round((a.act / a.rounds) * 100) / 100,
      exp: Math.round((a.exp / a.rounds) * 100) / 100,
      lift: Math.round((a.act / a.exp) * 100) / 100,
    }))
    .filter((r) => r.rounds >= 15)
    .sort((x, y) => y.band - x.band);
}

/**
 * Sakai frequency bands + missing-interval (gap) bands, each with a rolling
 * "does it beat random?" lift backtest, plus a last-appearance grid
 * (whiteCount columns by sorted position — reappeared numbers left blank).
 */
export function analyzeBands(game, draws, windowSize = 50) {
  const M = game.whiteMax, C = game.whiteCount;
  const win = draws.slice(0, windowSize);
  const n = win.length;

  const cnt = new Array(M + 1).fill(0);
  for (const d of win) for (const x of d.white) cnt[x]++;
  const sakai = [];
  for (let b = 6; b >= 0; b--) {
    const nums = [];
    for (let x = 1; x <= M; x++) if (Math.min(cnt[x], 6) === b) nums.push(x);
    if (nums.length) sakai.push({ band: b, label: b >= 6 ? "6+×" : `${b}×`, nums });
  }

  const lastSeen = new Array(M + 1).fill(-1);
  win.forEach((d, i) => { for (const x of d.white) if (lastSeen[x] === -1) lastSeen[x] = i; });
  const missing = [];
  for (let b = 0; b <= 7; b++) {
    const nums = [];
    for (let x = 1; x <= M; x++) {
      const g = lastSeen[x] === -1 ? n : lastSeen[x];
      if (GAP_BAND(g) === b) nums.push({ num: x, gap: g });
    }
    if (nums.length) missing.push({ band: b, label: GAP_BAND_LABEL[b], nums: nums.sort((a, z) => a.gap - z.gap || a.num - z.num) });
  }

  // Last-appearance grid: rows = draws back until every number has appeared once.
  let startRow = 0;
  for (let x = 1; x <= M; x++) if (lastSeen[x] > startRow) startRow = lastSeen[x];
  startRow = Math.min(startRow, n - 1);
  const grid = [];
  for (let i = startRow; i >= 0; i--) {
    const sorted = [...win[i].white].sort((a, b) => a - b);
    const cells = sorted.map((num) => (lastSeen[num] === i ? num : null));
    grid.push({ ago: i + 1, has: cells.some((c) => c !== null), cells });
  }

  const sakaiLift = liftByBand(draws, windowSize, M, C, (lb) => {
    const c = new Array(M + 1).fill(0);
    for (const d of lb) for (const x of d.white) c[x]++;
    return (x) => Math.min(c[x], 6);
  });
  const gapLift = liftByBand(draws, windowSize, M, C, (lb) => {
    const ls = new Array(M + 1).fill(-1);
    lb.forEach((d, i) => { for (const x of d.white) if (ls[x] === -1) ls[x] = i; });
    return (x) => GAP_BAND(ls[x] === -1 ? lb.length : ls[x]);
  });

  return { window: n, whiteCount: C, sakai, missing, grid, sakaiLift, gapLift };
}

/** Signal backtest: do hot / cold / overdue number pools beat random in the next draw? */
export function backtestSignals(game, draws, windowSize = 50) {
  const M = game.whiteMax, C = game.whiteCount;
  const P = Math.max(6, C + 3);
  const acc = { hot: { act: 0, exp: 0, r: 0 }, cold: { act: 0, exp: 0, r: 0 }, overdue: { act: 0, exp: 0, r: 0 } };
  for (let j = 0; j < draws.length; j++) {
    const lb = draws.slice(j + 1, j + 1 + windowSize);
    if (lb.length < windowSize) continue;
    const next = new Set(draws[j].white);
    const c = new Array(M + 1).fill(0);
    for (const d of lb) for (const x of d.white) c[x]++;
    const byFreq = Array.from({ length: M }, (_, i) => i + 1).sort((a, b) => c[b] - c[a] || a - b);
    const ls = new Array(M + 1).fill(-1);
    lb.forEach((d, i) => { for (const x of d.white) if (ls[x] === -1) ls[x] = i; });
    const gp = (x) => (ls[x] === -1 ? lb.length : ls[x]);
    const byGap = Array.from({ length: M }, (_, i) => i + 1).sort((a, b) => gp(b) - gp(a) || a - b);
    const pools = { hot: byFreq.slice(0, P), cold: byFreq.slice(-P), overdue: byGap.slice(0, P) };
    for (const k of Object.keys(pools)) {
      acc[k].act += pools[k].filter((x) => next.has(x)).length;
      acc[k].exp += (pools[k].length * C) / M;
      acc[k].r++;
    }
  }
  const out = {};
  for (const k of Object.keys(acc)) {
    const a = acc[k];
    out[k] = a.r
      ? { rounds: a.r, poolSize: P, act: Math.round((a.act / a.r) * 100) / 100, exp: Math.round((a.exp / a.r) * 100) / 100, lift: Math.round((a.act / a.exp) * 100) / 100 }
      : null;
  }
  return out;
}

/** Popularity / jackpot-split heuristic. No odds change — only expected payout
 *  if you win, because most players cluster on calendar numbers (1–31). */
export function analyzePopularity(game) {
  const M = game.whiteMax;
  const CAL = 31;
  const unpopularPool = [];
  for (let x = CAL + 1; x <= M; x++) unpopularPool.push(x);
  return {
    poolMax: M,
    whiteCount: game.whiteCount,
    calendarMax: CAL,
    calendarSharePct: Math.round((CAL / M) * 100),
    aboveCount: unpopularPool.length,
    unpopularPool,
    // "big" jackpot pools where the effect is most worth it
    isBig: game.specialMax > 0 && M >= 50,
  };
}
