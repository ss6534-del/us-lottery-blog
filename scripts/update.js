// 새 회차 감지 → 분석 → 게시글 JSON 생성 (GitHub Actions cron이 매시간 실행).
// 멱등: 이미 처리한 회차는 건너뛴다. 상태는 data/state.json.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, GAMES, DIGEST } from "../site.config.js";
import { fetchDraws, nextDrawDate, longDate } from "../lib/soda.js";
import { analyze } from "../lib/stats.js";
import { predictSets } from "../lib/predict.js";
import { prosePicker, POOLS } from "../lib/prose.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const STATE_FILE = path.join(DATA, "state.json");

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

function hot10FromStats(stats) {
  const entries = stats.freq.map((count, i) => ({ num: i + 1, count }));
  entries.sort((a, b) => b.count - a.count || a.num - b.num);
  return entries.slice(0, 10);
}

async function processGame(game, state) {
  const draws = await fetchDraws(game, SITE.analysisWindow + 10);
  if (draws.length === 0) {
    console.warn(`[${game.id}] no draws returned — skipping`);
    return false;
  }
  const latest = draws[0];
  if (state[game.id] === latest.date) {
    console.log(`[${game.id}] up to date (${latest.date})`);
    return false;
  }

  const stats = analyze(game, draws, SITE.analysisWindow);
  const targetDate = nextDrawDate(game, latest.date);

  if (game.mode === "post") {
    const post = {
      gameId: game.id,
      title: `${game.name} Predictions for ${longDate(targetDate)} — Hot & Cold Numbers, AI Picks`,
      resultDate: latest.date,
      targetDate,
      publishedDate: latest.date,
      prose: buildProse(game, targetDate, stats.window),
      stats,
      hot10: hot10FromStats(stats),
      sets: predictSets(game, stats, targetDate, 5),
    };
    writeJson(path.join(DATA, "posts", game.slug, `${targetDate}.json`), post);
    console.log(`[${game.id}] new post → ${game.slug}/${targetDate}`);
  } else {
    // 다이제스트: 결과 날짜별 파일에 게임 섹션을 누적
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
