// 데이터 기반 뉴스형 글 (kind:"news") — 이변 탐지 + 본문 구성.
// scripts/update.js가 사용한다. 탐지 규칙(우선순위 순):
//   1. long-absence     어떤 번호의 현재 미출현 gap이 윈도 내 최장 완료 기록을 갱신
//   2. repeat-number    직전 회차와 같은 번호 2개 이상 재출현
//   3. parity-extreme   홀수 또는 짝수만으로 구성된 회차
//   4. sum-extreme      합계가 윈도 내 최고/최저 기록 갱신
//   5. consecutive-pair 연속 번호 쌍 2개 이상
//
// 탐지가 없으면 뉴스 글은 없다. 같은 이슈(topic) 반복·하루 1건 제한은 update.js가
// state.json의 _news{date,topic}으로 관리한다(멱등).
//
// 문장은 시드 기반 회전이라 같은 글은 재빌드해도 문구가 안 바뀌고, 이변·회차가
// 다르면 다른 변형이 뽑힌다(lib/prose.js POOLS와 동일한 규칙).
//
// 법적 톤: win/odds/guaranteed/jackpot 등 금칙어를 쓰지 않는다.

import { SITE } from "../site.config.js";
import { analyze } from "./stats.js";
import { prosePicker, NEWS } from "./prose.js";
import { nextDrawDate, longDate } from "./soda.js";

// 희귀할수록·놀라울수록 앞. long-absence를 맨 앞에 두면 안 된다 —
// 실측 탐지 빈도가 long-absence 1254건 vs 나머지 각 65~134건이라, 앞에 두면
// 하루 1건 제한 때문에 뉴스 글이 거의 전부 "번호 X가 N회째 미출현"이 된다
// (독자에겐 지겹고, 검색엔진엔 유사 중복). 통계적으로 흔한 현상은 뉴스가 아니다.
// long-absence는 "그날 달리 이변이 없을 때의 기본값"으로 맨 뒤에 둔다.
const TYPE_PRIORITY = [
  "parity-extreme", // 전부 짝수/홀수 — 한눈에 놀랍다
  "repeat-number", // 직전 회차 번호가 되돌아옴
  "consecutive-pair", // 연속수 쌍이 여럿
  "sum-extreme", // 합계 신기록
  "long-absence", // 흔함 — 다른 이변이 없는 날의 폴백
];

const MIN_ABSENCE_GAP = 12; // 이보다 짧은 "기록 갱신"은 뉴스거리로 치지 않는다

function fillTemplate(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

// ── 탐지 ─────────────────────────────────────────────────────────────────────

/**
 * 최근 회차 기준 뉴스거리 탐지 — 우선순위 순으로 정렬된 배열 반환(없으면 []).
 * 각 항목: {type, priority, gameId, gameName, gameSlug, date, numbers[], facts, topic}
 */
export function detectNews(game, draws, windowSize = 50) {
  const win = draws.slice(0, windowSize);
  if (win.length < 10) return [];
  const latest = win[0];
  const out = [];

  // 1) long-absence — 현재 gap이 윈도 내 모든 완료 gap 기록을 넘어섰는가
  const la = detectLongAbsence(game, win);
  if (la) out.push(la);

  // 2) repeat-number — 직전 회차와 2개 이상 겹침
  if (win[1]) {
    const prevSet = new Set(win[1].white);
    const repeats = latest.white.filter((n) => prevSet.has(n));
    if (repeats.length >= 2) {
      const sortedRepeats = [...repeats].sort((a, b) => a - b);
      out.push({
        type: "repeat-number",
        numbers: sortedRepeats,
        facts: {
          nums: sortedRepeats,
          count: repeats.length,
          prevDate: win[1].date,
        },
        topicKey: sortedRepeats.join("-"),
      });
    }
  }

  // 3) parity-extreme — 전부 홀수 또는 전부 짝수
  const oddCount = latest.white.filter((x) => x % 2 === 1).length;
  if (oddCount === 0 || oddCount === game.whiteCount) {
    const parity = oddCount === 0 ? "even" : "odd";
    out.push({
      type: "parity-extreme",
      numbers: [...latest.white].sort((a, b) => a - b),
      facts: { parity, c: game.whiteCount },
      topicKey: `${parity}-${latest.date}`,
    });
  }

  // 4) sum-extreme — 윈도 내 최고/최저 갱신
  const sums = win.map((d) => d.white.reduce((a, b) => a + b, 0));
  const others = sums.slice(1);
  if (others.length >= 9) {
    const hi = Math.max(...others);
    const lo = Math.min(...others);
    const latestSum = sums[0];
    if (latestSum > hi || latestSum < lo) {
      const dir = latestSum > hi ? "highest" : "lowest";
      out.push({
        type: "sum-extreme",
        numbers: [...latest.white].sort((a, b) => a - b),
        facts: {
          sum: latestSum,
          dir,
          prevExtreme: dir === "highest" ? hi : lo,
          avg: Math.round(sums.reduce((a, b) => a + b, 0) / sums.length),
        },
        topicKey: `${dir}-${latestSum}`,
      });
    }
  }

  // 5) consecutive-pair — 연속 쌍 2개 이상
  const sorted = [...latest.white].sort((a, b) => a - b);
  const pairs = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) pairs.push([sorted[i - 1], sorted[i]]);
  }
  if (pairs.length >= 2) {
    out.push({
      type: "consecutive-pair",
      numbers: [...new Set(pairs.flat())].sort((a, b) => a - b),
      facts: { pairs: pairs.map((p) => `${p[0]}–${p[1]}`), count: pairs.length },
      topicKey: pairs.map((p) => p.join("-")).join("_"),
    });
  }

  return out
    .map((d) => ({
      ...d,
      gameId: game.id,
      gameName: game.name,
      gameSlug: game.slug,
      date: latest.date,
      priority: TYPE_PRIORITY.indexOf(d.type),
      topic: `${d.type}:${game.id}:${d.topicKey}`,
    }))
    .sort((a, b) => a.priority - b.priority);
}

function detectLongAbsence(game, win) {
  const n = win.length;
  let maxCompleted = 0; // 윈도 내에서 "끝난" 미출현 스트릭의 최장 기록
  let best = null; // 현재 진행 중 gap의 최댓값 {num, gap}
  for (let num = 1; num <= game.whiteMax; num++) {
    const idxs = [];
    for (let i = 0; i < n; i++) if (win[i].white.includes(num)) idxs.push(i);
    const current = idxs.length ? idxs[0] : n;
    for (let k = 1; k < idxs.length; k++) {
      const between = idxs[k] - idxs[k - 1] - 1;
      if (between > maxCompleted) maxCompleted = between;
    }
    if (!best || current > best.gap) best = { num, gap: current };
  }
  if (!best || best.gap < MIN_ABSENCE_GAP || best.gap <= maxCompleted) return null;
  // 윈도(n회) 안에 한 번도 안 나온 번호는 gap이 n으로 잘린다 — 실제로는 더 오래됐을 수 있다.
  // 그 경우 "50 draws"는 정확값이 아니라 하한이므로 "50+"로 표기해 과장·오도를 피한다.
  const capped = best.gap >= n;
  return {
    type: "long-absence",
    numbers: [best.num],
    facts: {
      num: best.num,
      gap: best.gap,
      gapText: capped ? `${best.gap}+` : String(best.gap),
      capped,
      record: maxCompleted,
    },
    topicKey: String(best.num),
  };
}

// ── 제목 ─────────────────────────────────────────────────────────────────────

function cap(s) {
  return String(s).charAt(0).toUpperCase() + String(s).slice(1);
}

/** [16,55,64] → "16, 55 & 64" — 3개 이상을 " & "로만 이으면 읽기 힘들다. */
function andList(arr) {
  const a = arr.map(String);
  if (a.length <= 1) return a[0] || "";
  return `${a.slice(0, -1).join(", ")} & ${a.at(-1)}`;
}

/** 헤드라인 — 이변 종류별. 제목에도 금칙어를 쓰지 않는다. */
export function newsHeadline(det) {
  const f = det.facts;
  switch (det.type) {
    case "long-absence":
      // gapText: 윈도에 잘린 경우 "50+" — 하한을 정확값처럼 쓰지 않는다
      return `Number ${f.num} Has Gone Quiet for ${f.gapText || f.gap} Draws`;
    case "repeat-number":
      return `${andList(f.nums)} Came Straight Back`;
    case "parity-extreme":
      return `An All-${cap(f.parity)} Line Just Landed`;
    case "sum-extreme":
      return `The ${f.dir === "highest" ? "Biggest" : "Smallest"} Line Total We've Logged`;
    case "consecutive-pair":
      return `${f.count} Consecutive Pairs in a Single Draw`;
    default:
      return "A Draw Worth Noting";
  }
}

export function newsTitle(game, det) {
  return `${game.name} Number Watch — ${newsHeadline(det)}`;
}

// ── 뉴스 글 빌드 ─────────────────────────────────────────────────────────────

function templateVars(game, det, stats, targetDate) {
  const f = det.facts;
  return {
    g: game.name,
    app: SITE.appName, // NEWS.outro가 쓴다 — 빠지면 "{app}"이 본문에 그대로 나간다
    date: longDate(det.date),
    next: longDate(targetDate),
    n: stats.window,
    c: game.whiteCount,
    hot: stats.hot.slice(0, 3).map((h) => h.num).join(", "),
    num: f.num,
    // 산문의 {gap}도 하한 표기를 따른다 — 제목만 "50+"이고 본문이 "50"이면 어긋난다
    gap: f.gapText || f.gap,
    record: f.record,
    nums: f.nums ? andList(f.nums) : "",
    count: f.count,
    parity: f.parity,
    sum: f.sum,
    dir: f.dir,
    prevExtreme: f.prevExtreme,
    avg: f.avg,
    pairs: f.pairs ? f.pairs.join(" and ") : "",
  };
}

/**
 * 탐지 결과 → 뉴스 글 JSON.
 * 렌더(lib/html.js)와 썸네일(lib/og.js)이 필요로 하는 stats를 함께 담는다.
 */
export function buildNewsPost(game, draws, det, windowSize = 50) {
  const stats = analyze(game, draws, windowSize);
  const targetDate = nextDrawDate(game, det.date);
  const pick = prosePicker(`news:${det.topic}:${det.date}`);
  const vars = templateVars(game, det, stats, targetDate);

  // 합계 스파크라인용 시계열 (과거→최근, 최대 20회) — sum-extreme 렌더에 쓴다
  const sumSeries = draws
    .slice(0, Math.min(20, windowSize))
    .map((d) => d.white.reduce((a, b) => a + b, 0))
    .reverse();

  return {
    kind: "news",
    newsType: det.type,
    gameId: game.id,
    gameSlug: game.slug,
    gameName: game.name,
    date: det.date, // = 결과일. URL·파일명의 키
    resultDate: det.date,
    targetDate,
    publishedDate: det.date,
    drawTimeEt: game.drawTimeEt,
    title: newsTitle(game, det),
    headline: newsHeadline(det),
    facts: { ...det.facts, numbers: det.numbers, topic: det.topic },
    prose: {
      intro: fillTemplate(pick(NEWS.intro[det.type]), vars),
      fact: fillTemplate(pick(NEWS.fact[det.type]), vars),
      context: fillTemplate(pick(NEWS.context), vars),
      outro: fillTemplate(pick(NEWS.outro), vars),
    },
    latest: stats.latest,
    sumSeries,
    // 렌더·썸네일용 통계 (글 전체 stats를 넣으면 JSON이 커진다)
    newsStats: {
      window: stats.window,
      hot: stats.hot,
      overdue: stats.overdue,
      sum: stats.sum,
      consecutivePct: stats.consecutivePct,
      repeatPct: stats.repeatPct,
      oddSplit: stats.oddSplit,
    },
  };
}
