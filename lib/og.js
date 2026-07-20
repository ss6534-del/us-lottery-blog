// 글별 대표 이미지(og:image / 리드 이미지 / 트윗 첨부) 합성.
//
// 설계 메모
// - 이미지 풀(assets/og-images/N.jpg)은 flux-dev로 만든 16:9 사진 10장. 글마다 시드로
//   1장을 골라 sharp로 데이터 오버레이를 합성해 dist/og/<name>.jpg 를 만든다.
//   같은 글은 재빌드해도 같은 그림 — 시드가 글 URL 경로라 고정된다.
// - 오버레이의 주인공은 "그 글의 실제 데이터"다. 글 JSON을 data/ 에서 직접 읽어
//   번호 볼 + 빈도 막대를 그린다(ogViz). X 타임라인에서 카드가 가로 500~600px로
//   줄어들어도 읽히도록 볼·글씨를 크게 잡았다.
// - sharp는 이 저장소의 유일한 의존성이다. 로드 실패/합성 실패/데이터 부재 시
//   기존처럼 텍스트만 얹거나(풀 원본 + 문구) 원본을 복사해 렌더는 반드시 계속된다.
// - 폰트 파일에 의존하지 않는다(DejaVu Sans / Arial / Helvetica) — Windows 로컬과
//   CI(ubuntu) 양쪽에서 렌더되어야 하므로.
// - 캐시: build.js가 dist/를 통째로 지우므로 합성본은 .og-cache/ 에 남겨두고
//   dist로 복사한다. 키에 데이터(viz) 해시가 들어가므로 숫자가 바뀌면 재합성된다.
// - 금칙어: win/winning/odds/guaranteed/jackpot 은 오버레이 문구에 쓰지 않는다.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, GAMES, DIGEST, gameById } from "../site.config.js";
import { prosePicker } from "./prose.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POOL_DIR = path.join(ROOT, "assets", "og-images");
const DATA_DIR = path.join(ROOT, "data");
const CACHE_DIR = path.join(ROOT, ".og-cache");
const CACHE_MANIFEST = path.join(CACHE_DIR, "manifest.json");

// 풀 이미지의 실제 픽셀 크기 — FLUX 16:9 1MP 출력
export const OG_W = 1344;
export const OG_H = 768;

export const OG_INDEX_FILE = "_index.jpg"; // 홈/인덱스용 — 풀 1번 고정

const ACCENT = "#FFD670"; // style.css --accent
const FF = "DejaVu Sans, Arial, Helvetica, sans-serif";
const PAD = 64;

// 레이아웃 버전 — 그리기 코드를 고치면 올려서 캐시를 통째로 무효화한다.
const LAYOUT_V = 3;

const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

// 다이제스트 볼 행의 게임 배지 문구 (표시명이 길어 축약)
const SHORT_NAME = {
  take5_mid: "TAKE 5 MID",
  take5_eve: "TAKE 5 EVE",
  millionaire: "MILLIONAIRE",
};

let sharpMod = null; // 동적 로드, 실패 시 null (원본 복사 폴백)
let sharpTried = false;

/** sharp 동적 로드 — 실패해도 throw하지 않는다. */
async function loadSharp() {
  if (sharpTried) return sharpMod;
  sharpTried = true;
  try {
    sharpMod = (await import("sharp")).default;
  } catch (e) {
    console.warn(`[og] sharp unavailable (${e.message}) — copying pool originals without overlay`);
    sharpMod = null;
  }
  return sharpMod;
}

/** 풀 파일명 목록(숫자 정렬). 풀이 없으면 빈 배열 → 호출자가 이미지를 생략한다. */
export function loadOgPool() {
  if (!fs.existsSync(POOL_DIR)) return [];
  return fs
    .readdirSync(POOL_DIR)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/** 시드(글 URL 경로) 기반 풀 선택 — 글마다 고정 */
function pickPoolFile(pool, seed) {
  if (pool.length === 0) return null;
  return prosePicker(`${seed}:og`)(pool);
}

/** "2026-07-15" → "JUL 15, 2026" (오버레이용 대문자). "2026-06" → "JUN 2026" */
function ogDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m) return String(iso).toUpperCase();
  const mon = MONTHS[m - 1].slice(0, 3);
  return d ? `${mon} ${d}, ${y}` : `${mon} ${y}`;
}

/** XML 이스케이프 (SVG 텍스트용) */
function escXml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── 데이터 로드 ───────────────────────────────────────────────────────────────
// 오버레이가 그 글의 실제 숫자를 그려야 하므로 글 JSON을 직접 읽는다.
// build.js(item = kind/gameSlug/date)와 social.js(큐 후보 — stats가 없다)가
// 같은 그림을 얻으려면, 두 호출부 모두 파일에서 데이터를 다시 읽는 편이 확실하다.

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function gameBySlug(slug) {
  return GAMES.find((g) => g.slug === slug) || null;
}

/** 글 JSON 경로 — build.js의 data/ 규칙과 일치해야 한다. */
function dataFileFor(kind, gameSlug, date) {
  if (kind === "digest") return path.join(DATA_DIR, "digests", `${date}.json`);
  if (!gameSlug) return null;
  if (kind === "news") return path.join(DATA_DIR, "news", gameSlug, `${date}.json`);
  if (kind === "analysis") return path.join(DATA_DIR, "analysis", gameSlug, `${date}.json`);
  if (kind === "recap") return path.join(DATA_DIR, "recaps", gameSlug, `${date}.json`);
  return path.join(DATA_DIR, "posts", gameSlug, `${date}.json`);
}

/** freq 배열(1-based 번호) → 상위 n개 [{num,count}] */
function topFreq(freq, n) {
  if (!Array.isArray(freq) || freq.length === 0) return [];
  return freq
    .map((count, i) => ({ num: i + 1, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count || a.num - b.num)
    .slice(0, n);
}

/** 핫 번호 n개 — 글이 이미 계산해 둔 hot10/stats.hot 우선, 없으면 freq에서 유도 */
function hotList(src, n) {
  const cands = [src?.hot10, src?.hot, src?.stats?.hot];
  for (const c of cands) {
    if (Array.isArray(c) && c.length >= n) return c.slice(0, n).map((x) => ({ num: x.num, count: x.count }));
  }
  const derived = topFreq(src?.stats?.freq, n);
  if (derived.length) return derived;
  for (const c of cands) {
    if (Array.isArray(c) && c.length) return c.map((x) => ({ num: x.num, count: x.count }));
  }
  return [];
}

/** stats.latest → 볼 배열. 숫자가 아니면 null(폴백). */
function ballsFromLatest(latest, game) {
  const white = Array.isArray(latest?.white) ? latest.white.filter((n) => Number.isFinite(n)) : [];
  if (white.length === 0) return null;
  const balls = white.map((n) => ({ n, special: false }));
  const sp = latest?.special;
  if (sp != null && Number.isFinite(Number(sp))) {
    balls.push({ n: Number(sp), special: true, color: game?.color || ACCENT });
  }
  return balls;
}

/**
 * 글 1건의 시각화 스펙 — 볼/차트/문구를 한 객체로 정규화한다.
 * 데이터가 없거나 모양이 다르면 null → 호출자가 텍스트-only 폴백으로 간다.
 */
export function ogViz(item) {
  try {
    return buildViz(item);
  } catch (e) {
    console.warn(`[og] viz build failed for ${item?.kind}/${item?.gameSlug}/${item?.date}: ${e.message}`);
    return null;
  }
}

function buildViz({ kind, gameSlug, date }) {
  const file = dataFileFor(kind, gameSlug, date);
  if (!file || !fs.existsSync(file)) return null;
  const j = readJsonSafe(file);
  if (!j) return null;

  if (kind === "digest") return vizDigest(j);
  if (kind === "news") return vizNews(j, gameBySlug(gameSlug));
  if (kind === "recap") return vizRecap(j, gameBySlug(gameSlug));
  if (kind === "analysis") return vizAnalysis(j, gameBySlug(gameSlug));
  return vizPost(j, gameBySlug(gameSlug));
}

// 이변 종류별 키커 — 무엇이 화제인지 한 줄로 못 박는다
const NEWS_KICKER = {
  "long-absence": "NUMBER WATCH · ABSENCE RECORD",
  "repeat-number": "NUMBER WATCH · BACK-TO-BACK",
  "parity-extreme": "NUMBER WATCH · ONE PARITY",
  "sum-extreme": "NUMBER WATCH · TOTAL RECORD",
  "consecutive-pair": "NUMBER WATCH · PAIRS",
};

/**
 * news: 화제의 번호를 큰 볼로 + 이변에 맞는 차트.
 * 볼은 게임색(special)으로 칠해 "이 글이 다루는 번호"임을 시각적으로 못 박는다.
 */
function vizNews(j, game) {
  const nums = Array.isArray(j?.facts?.numbers)
    ? j.facts.numbers.filter((n) => Number.isFinite(n))
    : [];
  if (nums.length === 0) return null;
  const color = game?.color || ACCENT;
  const balls = nums.map((n) => ({ n, special: true, color }));
  const win = j?.newsStats?.window;

  // long-absence는 "얼마나 안 나왔나"가 주인공이라 빈도 대신 미출현 랭킹을 그린다
  let chart = null;
  if (j?.newsType === "long-absence") {
    const od = (j?.newsStats?.overdue || []).slice(0, 8);
    if (od.length) {
      chart = {
        title: `DRAWS SINCE LAST SEEN${win ? ` · WINDOW OF ${win}` : ""}`,
        bars: od.map((o) => ({ label: o.num, value: o.gap })),
      };
    }
  } else {
    const hot = (j?.newsStats?.hot || []).slice(0, 8);
    if (hot.length) {
      chart = {
        title: `HOT NUMBERS${win ? ` · LAST ${win} DRAWS` : ""}`,
        bars: hot.map((h) => ({ label: h.num, value: h.count })),
      };
    }
  }
  return {
    mode: "balls",
    kicker: NEWS_KICKER[j?.newsType] || "NUMBER WATCH",
    labelDate: j?.resultDate || j?.date || null,
    balls,
    chart,
  };
}

/** post: 최신 결과 볼(크게) + 핫 8 막대 */
function vizPost(j, game) {
  const balls = ballsFromLatest(j?.stats?.latest, game);
  if (!balls) return null;
  const hot = hotList(j, 8);
  const win = j?.stats?.window;
  return {
    mode: "balls",
    kicker: "LATEST DRAW",
    labelDate: j?.stats?.latest?.date || j?.resultDate || j?.publishedDate || null,
    balls,
    chart: hot.length
      ? { title: `HOT NUMBERS${win ? ` · LAST ${win} DRAWS` : ""}`, bars: hot.map((h) => ({ label: h.num, value: h.count })) }
      : null,
  };
}

/** analysis: 예측 세트가 없는 데이터 리포트 → 빈도 차트를 크게 + 핫 볼 6개 */
function vizAnalysis(j, game) {
  const hot = hotList(j, 10);
  if (!hot.length) return null;
  const win = j?.stats?.window;
  return {
    mode: "chart",
    kicker: (game?.name || "DEEP ANALYSIS").toUpperCase(),
    labelDate: j?.weekStart || j?.publishedDate || null,
    balls: hot.slice(0, 6).map((h) => ({ n: h.num, special: false })),
    ballsCaption: "TOP OF THE HOT POOL",
    chart: { title: `NUMBER FREQUENCY${win ? ` · LAST ${win} DRAWS` : ""}`, bars: hot.map((h) => ({ label: h.num, value: h.count })) },
  };
}

/** recap: 그 달의 핫 번호 볼 + 작은 차트 */
function vizRecap(j, game) {
  const hot = hotList(j, 8);
  if (!hot.length) return null;
  const drawCount = Array.isArray(j?.draws) ? j.draws.length : j?.stats?.window;
  return {
    mode: "balls",
    kicker: "HOT THIS MONTH",
    labelDate: j?.month || null,
    balls: hot.slice(0, 6).map((h) => ({ n: h.num, special: false })),
    chart: {
      title: `TIMES DRAWN${drawCount ? ` · ${drawCount} DRAWS` : ""}`,
      bars: hot.map((h) => ({ label: h.num, value: h.count })),
    },
  };
}

/** digest: 게임별 볼 행을 쌓는다 (배지 + 볼) */
function vizDigest(j) {
  const sections = j?.sections;
  if (!sections || typeof sections !== "object") return null;
  const rows = [];
  for (const id of DIGEST.gameIds) {
    const s = sections[id];
    if (!s) continue;
    let game = null;
    try {
      game = gameById(id);
    } catch {
      game = null;
    }
    const balls = ballsFromLatest(s?.stats?.latest, game);
    if (!balls) continue;
    rows.push({ label: SHORT_NAME[id] || (game?.name || id).toUpperCase(), color: game?.color || ACCENT, balls });
  }
  if (!rows.length) return null;
  const labelDate = DIGEST.gameIds.map((id) => sections[id]?.stats?.latest?.date).find(Boolean) || j?.date || null;
  return { mode: "rows", kicker: "LATEST DRAWS", labelDate, rows };
}

// ── 추가 이미지(트윗용 다중 첨부) ────────────────────────────────────────────
//
// 블로그 og:image는 글마다 1장(ogInfo)이지만, 트윗은 최대 4장을 붙일 수 있다.
// 여기서는 "그 글의 다른 데이터를 다른 레이아웃으로" 보조 이미지를 만든다.
// 각 보조 viz는 그 자체로 읽히는 정보여야 하고, 1장차(ogInfo)와 중복이면 뺀다.
//   post : ①최신 볼+핫차트(ogInfo) ②예측 세트 카드 ③오버데유(장기 미출현) 차트
//   news : ①화제 번호+근거 차트(ogInfo) ②반대 신호 차트(핫↔오버듀)
// 데이터가 없으면 그 장을 조용히 건너뛴다(장수 자동 축소, 최소 1장 = ogInfo).

/** post 예측 세트 5줄 카드 — 라벨 칩 + 볼 행. j.sets 사용. */
function vizPostSets(j, game) {
  const raw = Array.isArray(j?.sets) ? j.sets : [];
  const sets = raw.filter((s) => Array.isArray(s?.white) && s.white.length);
  if (sets.length < 2) return null; // 세트가 거의 없으면 카드로 의미 없음
  const color = game?.color || ACCENT;
  const rows = sets.slice(0, 5).map((s) => {
    const balls = s.white.filter((n) => Number.isFinite(n)).map((n) => ({ n, special: false }));
    if (Number.isFinite(Number(s.special))) balls.push({ n: Number(s.special), special: true, color });
    return { label: String(s.label || "SET").toUpperCase(), color, balls };
  });
  return { mode: "sets", kicker: "NEW LINES FOR THE NEXT DRAW", labelDate: j?.targetDate || null, rows };
}

/** post 오버듀(장기 미출현) 차트 — stats.overdue 사용. 1장차의 핫차트와 반대 신호라 중복 아님. */
function vizPostOverdue(j) {
  const od = Array.isArray(j?.stats?.overdue) ? j.stats.overdue.slice(0, 8) : [];
  if (od.length < 3) return null;
  const win = j?.stats?.window;
  return {
    mode: "chart",
    kicker: "OVERDUE WATCH",
    labelDate: j?.stats?.latest?.date || j?.publishedDate || null,
    balls: od.slice(0, 6).map((o) => ({ n: o.num, special: false })),
    ballsCaption: "LONGEST ABSENT NUMBERS",
    chart: {
      title: `DRAWS SINCE LAST SEEN${win ? ` · LAST ${win} DRAWS` : ""}`,
      bars: od.map((o) => ({ label: o.num, value: o.gap })),
    },
  };
}

/**
 * news 보조 차트 — 1장차가 보여준 것과 반대 신호를 그린다.
 *   long-absence: 1장차=오버듀 → 보조=핫
 *   그 외:        1장차=핫     → 보조=오버듀
 */
function vizNewsSecondary(j) {
  const win = j?.newsStats?.window;
  if (j?.newsType === "long-absence") {
    const hot = Array.isArray(j?.newsStats?.hot) ? j.newsStats.hot.slice(0, 8) : [];
    if (hot.length < 3) return null;
    return {
      mode: "chart",
      kicker: "HOT NUMBERS",
      labelDate: j?.resultDate || j?.date || null,
      balls: hot.slice(0, 6).map((h) => ({ n: h.num, special: false })),
      ballsCaption: "MOST DRAWN IN THE WINDOW",
      chart: { title: `TIMES DRAWN${win ? ` · LAST ${win} DRAWS` : ""}`, bars: hot.map((h) => ({ label: h.num, value: h.count })) },
    };
  }
  const od = Array.isArray(j?.newsStats?.overdue) ? j.newsStats.overdue.slice(0, 8) : [];
  if (od.length < 3) return null;
  return {
    mode: "chart",
    kicker: "OVERDUE WATCH",
    labelDate: j?.resultDate || j?.date || null,
    balls: od.slice(0, 6).map((o) => ({ n: o.num, special: false })),
    ballsCaption: "LONGEST ABSENT NUMBERS",
    chart: { title: `DRAWS SINCE LAST SEEN${win ? ` · LAST ${win} DRAWS` : ""}`, bars: od.map((o) => ({ label: o.num, value: o.gap })) },
  };
}

/** 글 종류별 보조 viz 배열(0~2개). 파일에서 데이터를 직접 읽는다(ogViz와 같은 규칙). */
function extraVizFor(item) {
  const { kind, gameSlug, date } = item;
  const file = dataFileFor(kind, gameSlug, date);
  if (!file || !fs.existsSync(file)) return [];
  const j = readJsonSafe(file);
  if (!j) return [];
  const game = gameBySlug(gameSlug);
  try {
    if (kind === "post") return [vizPostSets(j, game), vizPostOverdue(j)].filter(Boolean);
    if (kind === "news") return [vizNewsSecondary(j)].filter(Boolean);
  } catch (e) {
    console.warn(`[og] extra viz build failed for ${kind}/${gameSlug}/${date}: ${e.message}`);
  }
  return []; // digest/analysis/recap는 1장 유지
}

/**
 * 트윗용 이미지 정보 배열(1~4장). 0번은 ogInfo(블로그 og:image와 동일 = 대표 이미지),
 * 이후는 보조 이미지. 데이터가 없으면 0번 1장만 반환한다.
 * @returns {{file:string, seed:string, big:string, small:string, viz:object|null}[]}
 */
export function ogInfoSet(item, cap = 4) {
  const base = ogInfo(item);
  const out = [base];
  if (!base.viz) return out; // 데이터 없음 → 대표 1장만(보조도 그릴 게 없다)
  const extras = extraVizFor(item);
  extras.forEach((viz, i) => {
    out.push({
      file: base.file.replace(/\.jpg$/i, `-${i + 2}.jpg`),
      seed: `${base.seed}#${i + 2}`, // 시드를 달리해 배경 풀을 다르게 고른다(장끼리 배경 반복 회피)
      big: base.big,
      small: base.small,
      viz,
    });
  });
  return out.slice(0, cap);
}

/**
 * 글 1건의 이미지 정보 — 파일명·시드·오버레이 문구를 한곳에서 결정한다.
 * build.js(렌더)와 social.js(트윗)가 같은 함수를 써야 두 그림이 일치한다.
 *
 * 날짜 주의: post의 date는 "예측 대상일"이라 화면에 그린 결과 볼과 짝지으면 안 된다.
 * viz가 있으면 라벨은 viz.labelDate(= 결과일)를 쓴다.
 *
 * @param {object} item
 * @param {"post"|"digest"|"analysis"|"recap"} item.kind
 * @param {string} [item.gameSlug] 게임 slug (post/analysis/recap)
 * @param {string} [item.gameName] 게임 표시명 (post)
 * @param {string} item.date  post=targetDate, digest=date, analysis=weekStart, recap=month
 * @returns {{file:string, seed:string, big:string, small:string, viz:object|null}}
 */
export function ogInfo(item) {
  const { kind, gameSlug, gameName, date } = item;
  let file;
  let seed;
  let head;

  if (kind === "digest") {
    file = `${DIGEST.slug}-${date}.jpg`;
    seed = `/${DIGEST.slug}/${date}/`;
    head = "DAILY DIGEST";
  } else if (kind === "news") {
    file = `${gameSlug}-${date}-news.jpg`;
    seed = `/${gameSlug}/${date}-news/`;
    // "NUMBER WATCH"는 키커가 이미 말한다 — 하단 블록은 게임·날짜만
    head = (gameName || "NUMBER WATCH").toUpperCase();
  } else if (kind === "analysis") {
    file = `${gameSlug}-${date}-analysis.jpg`;
    seed = `/${gameSlug}/${date}-analysis/`;
    head = "DEEP ANALYSIS";
  } else if (kind === "recap") {
    file = `${gameSlug}-${date}-recap.jpg`;
    seed = `/${gameSlug}/${date}-recap/`;
    head = "MONTHLY RECAP";
  } else {
    file = `${gameSlug}-${date}.jpg`;
    seed = `/${gameSlug}/${date}/`;
    head = (gameName || "AI PICKS").toUpperCase();
  }

  const viz = ogViz(item);
  // 볼이 그려지면 라벨도 그 결과일이어야 한다 (targetDate가 아니라).
  const d = ogDate(viz?.labelDate || date);
  return { file, seed, big: d ? `${head} · ${d}` : head, small: SITE.title.toUpperCase(), viz };
}

// ── SVG 조각 ─────────────────────────────────────────────────────────────────

/** 로또볼 — 흰 배경 + 검은 숫자(스페셜은 게임색 + 흰 숫자). 그림자는 뒤 원으로. */
function ballSvg(cx, cy, r, n, special, color) {
  const fs = Math.round(r * (String(n).length > 2 ? 0.72 : 0.94));
  const fill = special ? color || ACCENT : "url(#ballw)";
  const tf = special ? "#ffffff" : "#141414";
  return `<circle cx="${cx}" cy="${cy + Math.round(r * 0.07)}" r="${r}" fill="rgba(0,0,0,0.45)"/>
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="rgba(0,0,0,0.35)" stroke-width="${Math.max(2, Math.round(r * 0.045))}"/>
  <text x="${cx}" y="${cy + Math.round(fs * 0.35)}" text-anchor="middle" font-size="${fs}" font-weight="800" fill="${tf}">${escXml(n)}</text>`;
}

/** 볼 한 줄을 [x0, x0+w] 안에 배치. 볼이 많으면 반지름을 줄인다. */
function ballRowSvg(balls, x0, w, cy, rMax, { center = true } = {}) {
  const n = balls.length;
  if (n === 0) return "";
  const gap = Math.round(rMax * 0.28);
  let r = Math.min(rMax, Math.floor((w - gap * (n - 1)) / (2 * n)));
  r = Math.max(18, r);
  const g = Math.round(r * 0.28);
  const total = n * 2 * r + g * (n - 1);
  const startX = center ? Math.round(x0 + (w - total) / 2) : x0;
  return balls
    .map((b, i) => ballSvg(startX + r + i * (2 * r + g), cy, r, b.n, b.special, b.color))
    .join("\n  ");
}

/** 막대 차트 — 썸네일용(굵은 막대 + 큰 번호 라벨). bars: [{label, value}] */
function barsSvg({ x, w, baseY, bars, maxH, color, barMax = 96 }) {
  if (!bars || !bars.length) return "";
  const max = Math.max(...bars.map((b) => Number(b.value) || 0), 1);
  const slot = w / bars.length;
  const bw = Math.max(18, Math.min(barMax, Math.round(slot * 0.6)));
  let out = `<line x1="${x}" y1="${baseY + 1}" x2="${x + w}" y2="${baseY + 1}" stroke="rgba(255,255,255,0.4)" stroke-width="2"/>`;
  bars.forEach((b, i) => {
    const cx = Math.round(x + slot * i + slot / 2);
    const h = Math.max(8, Math.round(((Number(b.value) || 0) / max) * maxH));
    const by = baseY - h;
    out += `\n  <rect x="${Math.round(cx - bw / 2)}" y="${by}" width="${bw}" height="${h}" rx="5" fill="${color}"/>`;
    out += `\n  <text x="${cx}" y="${by - 11}" text-anchor="middle" font-size="26" font-weight="700" fill="rgba(255,255,255,0.92)">${escXml(b.value)}</text>`;
    out += `\n  <text x="${cx}" y="${baseY + 36}" text-anchor="middle" font-size="32" font-weight="800" fill="#ffffff">${escXml(b.label)}</text>`;
  });
  return out;
}

/** 좌상단 키커 (accent 대문자 트래킹) */
function kickerSvg(text) {
  return `<text x="${PAD}" y="96" font-size="30" font-weight="800" letter-spacing="5" fill="${ACCENT}">${escXml(text)}</text>`;
}

/** 하단 블록 텍스트 — accent 바 + 게임명·날짜 + 사이트명 (유지) */
function footerText(big, small) {
  const H = OG_H;
  let fs1 = 60;
  const maxW = OG_W - PAD * 2;
  if (big.length * fs1 * 0.62 > maxW) {
    fs1 = Math.max(34, Math.floor(maxW / (big.length * 0.62)));
  }
  const smallText = small
    ? `<text x="${PAD}" y="${H - 46}" font-size="26" font-weight="600" letter-spacing="3" fill="rgba(255,255,255,0.82)">${escXml(small)}</text>`
    : "";
  return `<rect x="${PAD}" y="${H - 176}" width="92" height="10" rx="3" fill="${ACCENT}"/>
  <text x="${PAD}" y="${H - 104}" font-size="${fs1}" font-weight="800" fill="#ffffff">${escXml(big)}</text>
  ${smallText}`;
}

/** 하단 그라데이션(텍스트-only 폴백용) — 아래 절반만 */
function footerScrim() {
  return `<rect x="0" y="${Math.round(OG_H * 0.5)}" width="${OG_W}" height="${Math.round(OG_H * 0.5)}" fill="url(#g)"/>`;
}

function svgDefs() {
  return `<defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.55" stop-color="#000000" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="ballw" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="#e2e4e8"/>
    </linearGradient>
    <linearGradient id="gfull" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#05070f" stop-opacity="0.76"/>
      <stop offset="0.4" stop-color="#05070f" stop-opacity="0.56"/>
      <stop offset="0.74" stop-color="#05070f" stop-opacity="0.66"/>
      <stop offset="1" stop-color="#05070f" stop-opacity="0.94"/>
    </linearGradient>
  </defs>`;
}

function wrap(inner) {
  return Buffer.from(
    `<svg width="${OG_W}" height="${OG_H}" viewBox="0 0 ${OG_W} ${OG_H}" xmlns="http://www.w3.org/2000/svg">
  ${svgDefs()}
  <g font-family="${FF}">
${inner}
  </g>
</svg>`
  );
}

/**
 * 텍스트 오버레이 SVG — 하단 어두운 그라데이션 + accent 바 + 볼드 텍스트.
 * 데이터가 없을 때의 폴백(기존 동작 그대로).
 */
function overlaySvg(big, small) {
  return wrap(`  ${footerScrim()}
  ${footerText(big, small)}`);
}

/**
 * 데이터 오버레이 SVG — 종류별 레이아웃.
 * 세로 예산: 키커 96 / 데이터 120~570 / 하단 블록 592~730.
 */
function dataOverlaySvg(viz, big, small) {
  const W = OG_W;
  const innerW = W - PAD * 2;
  let body = "";

  if (viz.mode === "rows") {
    // digest — 게임 배지 + 볼 행 3줄
    const rows = viz.rows.slice(0, 3);
    const cys = rows.length >= 3 ? [190, 330, 470] : rows.length === 2 ? [240, 400] : [320];
    const chipW = 262;
    const ballsX = PAD + chipW + 30;
    const ballsW = W - PAD - ballsX;
    rows.forEach((row, i) => {
      const cy = cys[i];
      body += `\n  <rect x="${PAD}" y="${cy - 27}" width="${chipW}" height="54" rx="27" fill="${row.color}" stroke="rgba(0,0,0,0.35)" stroke-width="2"/>`;
      body += `\n  <text x="${PAD + chipW / 2}" y="${cy + 9}" text-anchor="middle" font-size="25" font-weight="800" letter-spacing="1" fill="#ffffff">${escXml(row.label)}</text>`;
      body += `\n  ${ballRowSvg(row.balls, ballsX, ballsW, cy, 54, { center: false })}`;
    });
  } else if (viz.mode === "sets") {
    // post 예측 세트 — 라벨 칩 + 볼 행을 최대 5줄 쌓는다
    const rows = viz.rows.slice(0, 5);
    const n = rows.length;
    const top = 172;
    const bottom = 556;
    const step = n > 1 ? (bottom - top) / (n - 1) : 0;
    const chipW = 236;
    const ballsX = PAD + chipW + 26;
    const ballsW = W - PAD - ballsX;
    rows.forEach((row, i) => {
      const cy = Math.round(n > 1 ? top + step * i : (top + bottom) / 2);
      body += `\n  <rect x="${PAD}" y="${cy - 25}" width="${chipW}" height="50" rx="25" fill="${row.color}" stroke="rgba(0,0,0,0.35)" stroke-width="2"/>`;
      body += `\n  <text x="${PAD + chipW / 2}" y="${cy + 8}" text-anchor="middle" font-size="23" font-weight="800" letter-spacing="1" fill="#ffffff">${escXml(row.label)}</text>`;
      body += `\n  ${ballRowSvg(row.balls, ballsX, ballsW, cy, 40, { center: false })}`;
    });
  } else if (viz.mode === "chart") {
    // analysis — 핫 볼 6개 + 큰 빈도 차트
    body += `\n  ${ballRowSvg(viz.balls, PAD, innerW, 190, 58)}`;
    if (viz.ballsCaption) {
      body += `\n  <text x="${W / 2}" y="278" text-anchor="middle" font-size="23" font-weight="700" letter-spacing="3" fill="rgba(255,255,255,0.75)">${escXml(viz.ballsCaption)}</text>`;
    }
    body += `\n  <text x="${PAD}" y="330" font-size="27" font-weight="700" letter-spacing="2" fill="rgba(255,255,255,0.85)">${escXml(viz.chart.title)}</text>`;
    body += `\n  ${barsSvg({ x: PAD, w: innerW, baseY: 524, bars: viz.chart.bars, maxH: 150, color: ACCENT, barMax: 78 })}`;
  } else {
    // post / recap — 큰 볼 + 작은 빈도 차트
    body += `\n  ${ballRowSvg(viz.balls, PAD, innerW, 208, 80)}`;
    if (viz.chart) {
      body += `\n  <text x="${PAD}" y="352" font-size="27" font-weight="700" letter-spacing="2" fill="rgba(255,255,255,0.85)">${escXml(viz.chart.title)}</text>`;
      body += `\n  ${barsSvg({ x: PAD, w: innerW, baseY: 520, bars: viz.chart.bars, maxH: 118, color: ACCENT, barMax: 92 })}`;
    }
  }

  // 스크림을 먼저 깔고 데이터를 그 위에 그린다 — 순서가 반대면 그라데이션이 차트를 덮어 흐려진다.
  return wrap(`  <rect x="0" y="0" width="${W}" height="${OG_H}" fill="url(#gfull)"/>
  ${kickerSvg(viz.kicker)}${body}
  ${footerText(big, small)}`);
}

// ── 캐시 ─────────────────────────────────────────────────────────────────────
// build.js가 dist/를 새로 만들므로 합성본을 .og-cache/ 에 보관하고 복사해 쓴다.
// 키 = 풀 파일 + 오버레이 문구 + 데이터(viz) 해시 + 레이아웃 버전.
// 같은 글이라도 숫자가 바뀌면 키가 달라져 다시 합성된다.

let manifest = null;

function loadManifest() {
  if (manifest) return manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(CACHE_MANIFEST, "utf8"));
  } catch {
    manifest = {};
  }
  return manifest;
}

export function saveManifest() {
  if (!manifest) return;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(CACHE_MANIFEST, JSON.stringify(manifest), "utf8");
  } catch (e) {
    console.warn(`[og] cache manifest write failed: ${e.message}`);
  }
}

function cacheKey(poolFile, big, small, viz) {
  const src = fs.statSync(path.join(POOL_DIR, poolFile));
  const vizHash = viz ? crypto.createHash("sha1").update(JSON.stringify(viz)).digest("hex") : "novis";
  return crypto
    .createHash("sha1")
    .update(`${poolFile}|${src.size}|${src.mtimeMs}|${big}|${small}|${vizHash}|${ACCENT}|${OG_W}x${OG_H}|v${LAYOUT_V}`)
    .digest("hex");
}

// ── 합성 ─────────────────────────────────────────────────────────────────────

/**
 * 배경 파이프라인 — 데이터를 얹을 때만 블러+디밍해 가독성을 확보한다.
 * 데이터가 없으면(텍스트-only) 원본 그대로 = 기존 그림.
 */
function backdrop(sharp, src, viz) {
  const p = sharp(src).resize(OG_W, OG_H, { fit: "cover" });
  return viz ? p.blur(4).modulate({ brightness: 0.66, saturation: 1.05 }) : p;
}

function overlayFor(viz, big, small) {
  if (!viz) return overlaySvg(big, small);
  try {
    return dataOverlaySvg(viz, big, small);
  } catch (e) {
    console.warn(`[og] data overlay failed (${e.message}) — text-only overlay`);
    return overlaySvg(big, small);
  }
}

/**
 * 풀 원본 + 오버레이 → outFile. sharp가 없거나 합성이 실패하면 원본을 복사한다.
 * @returns {Promise<"composed"|"cached"|"fallback">}
 */
async function composeTo(poolFile, outFile, big, small, viz, { useCache = true } = {}) {
  const src = path.join(POOL_DIR, poolFile);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  // 1) 캐시 히트 — 소스·문구·데이터가 그대로면 복사만
  if (useCache) {
    const key = cacheKey(poolFile, big, small, viz);
    const cached = path.join(CACHE_DIR, `${key}.jpg`);
    const mf = loadManifest();
    if (mf[key] && fs.existsSync(cached)) {
      fs.copyFileSync(cached, outFile);
      return "cached";
    }
    const sharp = await loadSharp();
    if (sharp) {
      try {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        await backdrop(sharp, src, viz)
          .composite([{ input: overlayFor(viz, big, small), top: 0, left: 0 }])
          .jpeg({ quality: 84, mozjpeg: true })
          .toFile(cached);
        mf[key] = 1;
        fs.copyFileSync(cached, outFile);
        return "composed";
      } catch (e) {
        console.warn(`[og] composite failed for ${outFile}: ${e.message} — falling back to original`);
      }
    }
    fs.copyFileSync(src, outFile);
    return "fallback";
  }

  // 2) 캐시 미사용 경로 (트윗 이미지 — 임시 파일로 1장)
  const sharp = await loadSharp();
  if (sharp) {
    try {
      await backdrop(sharp, src, viz)
        .composite([{ input: overlayFor(viz, big, small), top: 0, left: 0 }])
        .jpeg({ quality: 84, mozjpeg: true })
        .toFile(outFile);
      return "composed";
    } catch (e) {
      console.warn(`[og] composite failed for ${outFile}: ${e.message} — falling back to original`);
    }
  }
  fs.copyFileSync(src, outFile);
  return "fallback";
}

/**
 * 글 1건의 합성 이미지를 outDir 에 만든다 (build.js 렌더 파이프라인용).
 * @returns {Promise<{file:string, status:string}|null>} 풀이 비면 null
 */
export async function renderOgImage(item, outDir, pool = loadOgPool()) {
  if (pool.length === 0) return null;
  const { file, seed, big, small, viz } = ogInfo(item);
  const poolFile = pickPoolFile(pool, seed);
  const status = await composeTo(poolFile, path.join(outDir, file), big, small, viz);
  return { file, status };
}

/** 홈/인덱스용 — 풀 1번 고정, 사이트명만 크게 (데이터 없음 = 텍스트-only) */
export async function renderIndexImage(outDir, pool = loadOgPool()) {
  if (pool.length === 0) return null;
  const status = await composeTo(
    pool[0],
    path.join(outDir, OG_INDEX_FILE),
    SITE.title.toUpperCase(),
    SITE.tagline.toUpperCase(),
    null
  );
  return { file: OG_INDEX_FILE, status };
}

/**
 * 글 1건의 합성 이미지를 임의 경로(임시 파일)에 만든다 — social.js가 트윗 첨부용으로 쓴다.
 * 블로그 og:image와 같은 시드·같은 오버레이라 트윗 이미지와 글 대표 이미지가 일치한다.
 * @returns {Promise<boolean>} 파일이 만들어졌는지
 */
export async function composePostImage(item, outFile) {
  const pool = loadOgPool();
  if (pool.length === 0) {
    console.warn(`[og] no image pool — cannot compose ${outFile}`);
    return false;
  }
  const { seed, big, small, viz } = ogInfo(item);
  const poolFile = pickPoolFile(pool, seed);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await composeTo(poolFile, outFile, big, small, viz, { useCache: false });
  return fs.existsSync(outFile);
}

/**
 * 글 1건의 트윗용 합성 이미지 여러 장(1~cap)을 outDir 에 만든다 — social.js가 다중 첨부에 쓴다.
 * 0번은 composePostImage와 같은 대표 이미지, 이후는 보조 데이터 이미지.
 * 데이터가 부족한 글은 자연히 1장(대표)만 만들어진다. 한 장 합성이 실패해도 나머지는 계속.
 * @returns {Promise<string[]>} 실제로 만들어진 파일 경로들(표시 순서 = 배열 순서)
 */
export async function composePostImages(item, outDir, cap = 4) {
  const pool = loadOgPool();
  if (pool.length === 0) {
    console.warn(`[og] no image pool — cannot compose images for ${item?.kind}/${item?.gameSlug}`);
    return [];
  }
  fs.mkdirSync(outDir, { recursive: true });
  const infos = ogInfoSet(item, cap);
  const files = [];
  for (let i = 0; i < infos.length; i++) {
    const info = infos[i];
    const poolFile = pickPoolFile(pool, info.seed);
    const outFile = path.join(outDir, `img-${i}.jpg`);
    try {
      await composeTo(poolFile, outFile, info.big, info.small, info.viz, { useCache: false });
      if (fs.existsSync(outFile)) files.push(outFile);
    } catch (e) {
      console.warn(`[og] compose image ${i} failed for ${item?.kind}: ${e.message}`);
    }
  }
  return files;
}
