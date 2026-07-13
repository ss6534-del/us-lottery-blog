// 새 회차 감지 → 분석 → 게시글 JSON 생성 (GitHub Actions cron이 매시간 실행).
// + 예측 성적표(직전 세트 자동 채점) + 월간 리캡 생성.
// 멱등: 이미 처리한 회차는 건너뛴다. 상태는 data/state.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, GAMES, DIGEST } from "../site.config.js";
import { fetchDraws, nextDrawDate, longDate, weekdayOf, addDays } from "../lib/soda.js";
import {
  analyze, analyzeDeep,
  analyzeRecurrence, analyzeBands, backtestSignals, analyzePopularity,
} from "../lib/stats.js";
import { predictSets } from "../lib/predict.js";
import { prosePicker, POOLS } from "../lib/prose.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA, "state.json");

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

function fillTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

function buildProse(game, targetDate, windowSize) {
  const pick = prosePicker(`${game.id}:${targetDate}`);
  const vars = { g: game.name, date: longDate(targetDate), n: windowSize, app: SITE.appName };
  return {
    intro: fillTemplate(pick(POOLS.intro), vars),
    recap: fillTemplate(pick(POOLS.recap), vars),
    hot: fillTemplate(pick(POOLS.hot), vars),
    cold: fillTemplate(pick(POOLS.cold), vars),
    patterns: fillTemplate(pick(POOLS.patterns), vars),
    predictionsLead: fillTemplate(pick(POOLS.predictionsLead), vars),
    outro: fillTemplate(pick(POOLS.outro), vars),
  };
}

function hotFromStats(stats, n = 10) {
  const entries = stats.freq.map((count, i) => ({ num: i + 1, count }));
  entries.sort((a, b) => b.count - a.count || a.num - b.num);
  return entries.slice(0, n);
}

/**
 * 조건부 코멘트 — 이번 결과가 실제로 특이할 때만 문장이 생성된다.
 * (합계 극단, 홀짝 쏠림, 이월수, 연속수, 가뭄 종료, 핫넘버 연속)
 */
function buildInsights(game, stats, draws) {
  const pick = prosePicker(`${game.id}:insight:${stats.latest.date}`);
  const latest = stats.latest;
  const out = [];

  const sum = latest.white.reduce((a, b) => a + b, 0);
  if (sum > stats.sum.p75) {
    out.push(fillTemplate(pick(POOLS.insightSumHigh), { sum, avg: stats.sum.avg }));
  } else if (sum < stats.sum.p25) {
    out.push(fillTemplate(pick(POOLS.insightSumLow), { sum, avg: stats.sum.avg }));
  }

  const odd = latest.white.filter((x) => x % 2 === 1).length;
  if (odd === 0 || odd === game.whiteCount) {
    out.push(fillTemplate(pick(POOLS.insightOddExtreme), { odd, c: game.whiteCount }));
  }

  if (stats.previous) {
    const prevSet = new Set(stats.previous.white);
    const repeats = latest.white.filter((x) => prevSet.has(x));
    if (repeats.length > 0) {
      out.push(fillTemplate(pick(POOLS.insightRepeat), { nums: repeats.join(" & ") }));
    }
  }

  const sorted = [...latest.white].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === sorted[i - 1] + 1) {
      out.push(fillTemplate(pick(POOLS.insightConsec), { pair: `${sorted[i - 1]}–${sorted[i]}` }));
      break;
    }
  }

  // 가뭄 종료: 이번 회차 번호 중 직전까지 20회 이상 미출현했던 번호
  const history = draws.slice(1);
  let drought = null;
  for (const num of latest.white) {
    const idx = history.findIndex((d) => d.white.includes(num));
    const gap = idx === -1 ? history.length : idx + 1;
    if (gap >= 20 && (!drought || gap > drought.gap)) drought = { num, gap };
  }
  if (drought) {
    out.push(fillTemplate(pick(POOLS.insightDrought), drought));
  }

  const hotSet = new Set(stats.hot.slice(0, 5).map((h) => h.num));
  const hotHit = latest.white.find((x) => hotSet.has(x));
  if (hotHit !== undefined && out.length < 3) {
    out.push(fillTemplate(pick(POOLS.insightHot), { num: hotHit }));
  }

  return out.slice(0, 3).join(" ");
}

/** 최근 성적표에서 앱 홍보용 소셜프루프 추출 (best set이 2개 이상 맞았을 때만) */
function latestProof(game) {
  const dir = path.join(DATA, "posts", game.slug);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().reverse();
  for (const f of files) {
    const p = readJson(path.join(dir, f), null);
    if (p && p.scorecard && p.scorecard.sets) {
      const best = p.scorecard.sets.reduce((a, b) => (b.matches > a.matches ? b : a));
      if (best.matches >= 2) {
        return { label: best.label, matches: best.matches, whiteCount: game.whiteCount, date: p.scorecard.forDate };
      }
      return null; // 최신 성적표가 부진하면 프루프 생략 (정직하게)
    }
  }
  return null;
}

/** 주간 심층 분석 글 (빅3, 주 1회 — 그 주 첫 회차 처리 시 생성) */
function maybeBuildAnalysis(game, draws, state) {
  const latest = draws[0];
  const weekStart = addDays(latest.date, -(weekdayOf(latest.date) - 1)); // 그 주 월요일
  const key = `analysis_${game.id}`;
  if (state[key] === weekStart) return false;
  if (draws.length < 25) return false;

  const stats = analyze(game, draws, SITE.analysisWindow);
  const deep = analyzeDeep(game, draws, SITE.analysisWindow);
  const targetDate = nextDrawDate(game, latest.date);
  const pick = prosePicker(`${game.id}:analysis:${weekStart}`);
  const vars = { g: game.name, n: stats.window, date: longDate(targetDate), app: SITE.appName };

  // 고급 분석 (회귀·밴드/미출·백테스트·비인기). draws는 인터랙티브 위젯용(윈도 화이트만).
  const recurrence = analyzeRecurrence(game, draws, Math.min(draws.length, 60));
  const bands = analyzeBands(game, draws, SITE.analysisWindow);
  const backtest = backtestSignals(game, draws, SITE.analysisWindow);
  const popularity = analyzePopularity(game);
  const winDraws = draws.slice(0, SITE.analysisWindow).map((d) => d.white);

  const analysis = {
    gameId: game.id,
    weekStart,
    publishedDate: latest.date,
    targetDate,
    title: `${game.name} Deep Analysis — Week of ${longDate(weekStart)} (Build Your Own Numbers)`,
    prose: {
      intro: fillTemplate(pick(POOLS.analysisIntro), vars),
      pools: fillTemplate(pick(POOLS.analysisPools), vars),
      outro: fillTemplate(pick(POOLS.analysisOutro), vars),
    },
    stats,
    deep,
    recurrence,
    bands,
    backtest,
    popularity,
    winDraws,
    proof: latestProof(game),
  };
  writeJson(path.join(DATA, "analysis", game.slug, `${weekStart}.json`), analysis);
  state[key] = weekStart;
  console.log(`[${game.id}] weekly analysis → week of ${weekStart}`);
  return true;
}

/** 예측 세트 채점 — 실제 당첨번호와 대조 */
function gradeSets(sets, draw, game) {
  const drawn = new Set(draw.white);
  const graded = sets.map((set) => ({
    label: set.label,
    matches: set.white.filter((n) => drawn.has(n)).length,
    specialHit: game.specialMax > 0 && set.special === draw.special,
  }));
  return { forDate: draw.date, sets: graded };
}

/** "2026-07" → "2026-06" */
function monthBefore(ym) {
  let [y, m] = ym.split("-").map(Number);
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** 월간 리캡 생성 (빅3 전용, 전월 회차가 데이터에 있을 때) */
function maybeBuildRecap(game, draws, state) {
  const latest = draws[0];
  const prevMonth = monthBefore(latest.date.slice(0, 7));
  const recKey = `recap_${game.id}`;
  if (state[recKey] === prevMonth) return false;

  const monthDraws = draws.filter((d) => d.date.startsWith(prevMonth));
  if (monthDraws.length < 3) return false; // 데이터 부족(윈도 밖) 시 건너뜀

  const [y, m] = prevMonth.split("-").map(Number);
  const monthName = `${MONTHS[m - 1]} ${y}`;
  const stats = analyze(game, monthDraws, monthDraws.length);

  // 그 달 성적표 집계 (outcome이 채점된 포스트들)
  const postsDir = path.join(DATA, "posts", game.slug);
  let ai = null;
  if (fs.existsSync(postsDir)) {
    const graded = fs
      .readdirSync(postsDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => readJson(path.join(postsDir, f), null))
      .filter((p) => p && p.outcome && p.outcome.sets && p.targetDate && p.targetDate.startsWith(prevMonth))
      .map((p) => {
        const best = p.outcome.sets.reduce((a, b) =>
          b.matches > a.matches || (b.matches === a.matches && b.specialHit) ? b : a
        );
        return { date: p.targetDate, label: best.label, matches: best.matches, specialHit: best.specialHit };
      });
    if (graded.length > 0) {
      const best = graded.reduce((a, b) =>
        b.matches > a.matches || (b.matches === a.matches && b.specialHit && !a.specialHit) ? b : a
      );
      ai = {
        postsGraded: graded.length,
        best,
        threePlus: graded.filter((g) => g.matches >= 3).length,
      };
    }
  }

  const recap = {
    gameId: game.id,
    month: prevMonth,
    monthName,
    title: `${game.name} in ${monthName} — Every Draw, Hot Numbers & Patterns`,
    draws: monthDraws,
    stats,
    hot: hotFromStats(stats, 8),
    ai,
  };
  writeJson(path.join(DATA, "recaps", game.slug, `${prevMonth}.json`), recap);
  state[recKey] = prevMonth;
  console.log(`[${game.id}] monthly recap → ${prevMonth} (${monthDraws.length} draws)`);
  return true;
}

async function processGame(game, state) {
  // +110: 롤링 백테스트(리프트·신호)에 충분한 과거 회차 확보 (윈도 밖은 슬라이스로 무시됨)
  const draws = await fetchDraws(game, SITE.analysisWindow + 110);
  if (draws.length === 0) {
    console.warn(`[${game.id}] no draws returned — skipping`);
    return false;
  }
  const latest = draws[0];
  let changed = false;

  // 월간 리캡 + 주간 심층 분석 (빅3만; 새 회차 여부와 무관하게 주기가 넘어가면 생성)
  if (game.mode === "post") {
    if (maybeBuildRecap(game, draws, state)) changed = true;
    if (maybeBuildAnalysis(game, draws, state)) changed = true;
  }

  if (state[game.id] === latest.date) {
    console.log(`[${game.id}] up to date (${latest.date})`);
    return changed;
  }

  const stats = analyze(game, draws, SITE.analysisWindow);
  const targetDate = nextDrawDate(game, latest.date);

  if (game.mode === "post") {
    // 직전 글(이 회차를 예측했던 글) 채점 → 성적표 + 그 글에 결과 기록
    let scorecard = null;
    const prevFile = path.join(DATA, "posts", game.slug, `${latest.date}.json`);
    const prevPost = readJson(prevFile, null);
    if (prevPost && Array.isArray(prevPost.sets) && prevPost.targetDate === latest.date) {
      scorecard = gradeSets(prevPost.sets, latest, game);
      prevPost.outcome = { white: latest.white, special: latest.special, sets: scorecard.sets };
      writeJson(prevFile, prevPost);
      console.log(`[${game.id}] graded previous post ${latest.date}`);
    }

    const post = {
      gameId: game.id,
      title: `${game.name} Predictions for ${longDate(targetDate)} — Hot & Cold Numbers, AI Picks`,
      resultDate: latest.date,
      targetDate,
      publishedDate: latest.date,
      prose: { ...buildProse(game, targetDate, stats.window), insight: buildInsights(game, stats, draws) },
      stats,
      hot10: hotFromStats(stats, 10),
      sets: predictSets(game, stats, targetDate, 5),
      scorecard,
    };
    writeJson(path.join(DATA, "posts", game.slug, `${targetDate}.json`), post);
    console.log(`[${game.id}] new post → ${game.slug}/${targetDate}`);
  } else {
    // 다이제스트: 직전 날짜 다이제스트의 이 게임 섹션 채점
    let scorecard = null;
    const prevDate = draws[1] ? draws[1].date : null;
    if (prevDate) {
      const prevFile = path.join(DATA, "digests", `${prevDate}.json`);
      const prevDigest = readJson(prevFile, null);
      const prevSec = prevDigest && prevDigest.sections ? prevDigest.sections[game.id] : null;
      if (prevSec && Array.isArray(prevSec.sets) && prevSec.targetDate === latest.date) {
        scorecard = gradeSets(prevSec.sets, latest, game);
        prevSec.outcome = { white: latest.white, special: latest.special, sets: scorecard.sets };
        writeJson(prevFile, prevDigest);
        console.log(`[${game.id}] graded previous digest section ${prevDate}`);
      }
    }

    const file = path.join(DATA, "digests", `${latest.date}.json`);
    const digest = readJson(file, {
      date: latest.date,
      title: `${DIGEST.title.replace("Daily Results", "Results")} — ${longDate(latest.date)}`,
      intro:
        `Your daily roundup of New York's fast games for ${longDate(latest.date)}: ` +
        `Take 5 (midday and evening) plus Millionaire for Life — latest results, ` +
        `quick hot/overdue reads, and AI picks for the next drawings.`,
      sections: {},
    });
    digest.sections[game.id] = {
      resultDate: latest.date,
      targetDate,
      stats,
      sets: predictSets(game, stats, targetDate, 3),
      scorecard,
    };
    writeJson(file, digest);
    console.log(`[${game.id}] digest section → ${latest.date}`);
  }

  state[game.id] = latest.date;
  return true;
}

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const state = readJson(STATE_FILE, {});
  let changed = false;

  for (const game of GAMES) {
    try {
      if (await processGame(game, state)) changed = true;
    } catch (err) {
      // 한 게임 실패가 나머지를 막지 않게 한다
      console.error(`[${game.id}] FAILED: ${err.message}`);
    }
  }

  if (changed) writeJson(STATE_FILE, state);

  console.log(changed ? "CHANGED=true" : "CHANGED=false");
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\n`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
