// 예상 조합 생성 — 전략별 세트. 시드 고정(게임+대상 회차)이라 재빌드해도 결과가 안 변한다.

// ── 시드 RNG (FNV-1a → mulberry32) ──────────────────────────────────────────
function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 가중치 기반 비복원 추출 */
function weightedPick(rng, weights, count, max) {
  const picked = new Set();
  let guard = 0;
  while (picked.size < count && guard++ < 5000) {
    let total = 0;
    for (let n = 1; n <= max; n++) if (!picked.has(n)) total += weights[n];
    let r = rng() * total;
    for (let n = 1; n <= max; n++) {
      if (picked.has(n)) continue;
      r -= weights[n];
      if (r <= 0) {
        picked.add(n);
        break;
      }
    }
  }
  return [...picked].sort((a, b) => a - b);
}

function uniformWeights(max, base = 1) {
  const w = new Array(max + 1).fill(base);
  w[0] = 0;
  return w;
}

/**
 * 5세트(다이제스트 게임은 3세트) 생성.
 * @returns [{label, description, white[], special|null}]
 */
export function predictSets(game, stats, targetDate, setCount = 5) {
  const rng = mulberry32(hashSeed(`${game.id}:${targetDate}`));
  const M = game.whiteMax;
  const C = game.whiteCount;

  // 빈도 가중치 (스무딩 +1)
  const freqW = uniformWeights(M, 0);
  for (let n = 1; n <= M; n++) freqW[n] = stats.freq[n - 1] + 1;

  // 오버듀 가중치
  const overdueSet = new Set(stats.overdue.map((o) => o.num));

  const strategies = [
    {
      label: "Hot Streak",
      description: `Weighted toward the most frequent numbers of the last ${stats.window} draws.`,
      gen: () => weightedPick(rng, freqW, C, M),
    },
    {
      label: "Balanced Mix",
      description: `Follows the dominant odd/even and low/high pattern with a typical sum range.`,
      gen: () => balancedSet(rng, game, stats),
    },
    {
      label: "Overdue Watch",
      description: `Blends the longest-absent numbers with a hot-number core.`,
      gen: () => {
        const w = freqW.slice();
        for (const n of overdueSet) w[n] = stats.maxFreq + 2; // 오버듀를 최상위 가중치로
        return weightedPick(rng, w, C, M);
      },
    },
    {
      label: "Pattern Play",
      description: `Mirrors recent structural trends (consecutive pairs, repeats).`,
      gen: () => patternSet(rng, game, stats),
    },
    {
      label: "Wildcard",
      description: `A pure random spread across the full number pool.`,
      gen: () => weightedPick(rng, uniformWeights(M), C, M),
    },
  ].slice(0, setCount);

  return strategies.map((s) => {
    const white = s.gen();
    let special = null;
    if (game.specialMax > 0) {
      const sw = uniformWeights(game.specialMax);
      for (const { num, count } of stats.specialHot) sw[num] = count + 2;
      special = weightedPick(rng, sw, 1, game.specialMax)[0];
    }
    return { label: s.label, description: s.description, white, special };
  });
}

/** 홀짝·고저·합계 구간을 만족하는 세트 (200회 시도 후 최선 반환) */
function balancedSet(rng, game, stats) {
  const M = game.whiteMax;
  const C = game.whiteCount;
  const targetOdd = stats.oddSplit.best;
  const targetLow = stats.lowSplit.best;
  const uw = uniformWeights(M);
  let best = null;
  let bestScore = Infinity;
  for (let t = 0; t < 200; t++) {
    const cand = weightedPick(rng, uw, C, M);
    const odd = cand.filter((x) => x % 2 === 1).length;
    const low = cand.filter((x) => x <= stats.lowSplit.lowMax).length;
    const sum = cand.reduce((a, b) => a + b, 0);
    const sumPenalty =
      sum < stats.sum.p25 ? stats.sum.p25 - sum : sum > stats.sum.p75 ? sum - stats.sum.p75 : 0;
    const score = Math.abs(odd - targetOdd) * 10 + Math.abs(low - targetLow) * 10 + sumPenalty;
    if (score < bestScore) {
      bestScore = score;
      best = cand;
      if (score === 0) break;
    }
  }
  return best;
}

/** 최근 경향 반영: 연속수가 잦으면 연속 페어 1개 포함, 반복이 잦으면 직전 회차 번호 1개 포함 */
function patternSet(rng, game, stats) {
  const M = game.whiteMax;
  const C = game.whiteCount;
  const picked = new Set();

  if (stats.repeatPct >= 50 && stats.latest) {
    const src = stats.latest.white;
    picked.add(src[Math.floor(rng() * src.length)]);
  }
  if (stats.consecutivePct >= 40) {
    let a = 1 + Math.floor(rng() * (M - 1));
    let guard = 0;
    while ((picked.has(a) || picked.has(a + 1)) && guard++ < 50) {
      a = 1 + Math.floor(rng() * (M - 1));
    }
    picked.add(a);
    picked.add(a + 1);
  }

  const freqW = uniformWeights(M, 0);
  for (let n = 1; n <= M; n++) freqW[n] = stats.freq[n - 1] + 1;
  for (const n of picked) freqW[n] = 0;
  const rest = weightedPick(rng, freqW, C - picked.size, M);
  return [...picked, ...rest].sort((a, b) => a - b);
}
