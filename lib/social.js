// 자동 트윗(X) — 큐 적립 + 하루 2회 스케줄 발사 모델.
//
// 설계 메모
// - 의존성 0: OAuth 1.0a(HMAC-SHA1) 서명을 node:crypto로 직접 구현, 전송은 내장 fetch.
//   이미지 합성만 lib/og.js(sharp)를 재사용한다 — 트윗 그림 = 글 og:image.
// - 큐 모델: update.js가 매시간 돌면서 새 글을 state._social.queue 에 적립만 하고,
//   실제 발사는 미 동부 오전(9~12시) / 저녁(19~22시) 창에서 슬롯당 1건씩(하루 최대 2건).
//   "새 글이 생긴 시각"과 "미국 독자가 깨어 있는 시각"이 다르기 때문.
//   창으로 둔 이유는 FIRE_WINDOWS 주석 참고 — GitHub Actions 크론이 정시에 안 돈다.
// - DST: UTC 오프셋을 하드코딩하지 않고 Intl(America/New_York)로 현재 ET 시각을 구한다.
//   3월/11월 전환에도 9AM ET가 정확히 9AM ET다.
// - 단일 사이트라 promo-site의 "사이트 순환" 대신 "같은 게임 연속 회피"를 쓴다.
// - 미디어: v2 → v1.1 순으로 업로드를 시도하고, 둘 다 실패하면 로그만 남기고
//   "이미지 없는 텍스트 트윗"으로 폴백한다 — 트윗 자체는 반드시 나간다.
// - 실패 격리: 자격증명이 없거나 API가 실패해도 로그만 남기고 글 발행에는 영향 0.
// - 멱등: postedSlugs(롤링 100건)에 있는 글은 절대 재트윗하지 않는다.
//
// 검증용 env
//   SOCIAL_DRY_RUN=1    발사 창을 무시하고 "지금 쏜다면" 선택될 글·문구만 출력.
//                       실제 POST·업로드는 없지만 큐 적립은 저장한다 — 안 그러면 이 실행에서
//                       잡힌 새 회차가 큐에서 누락된 채 소비되어 영영 트윗되지 않는다.
//   SOCIAL_MEDIA_TEST=1 트윗하지 않고 이미지 업로드만 1회 시도해 성공/실패·응답을 로그로 출력
//   SOCIAL_FORCE_FIRE=1 발사 창을 무시하고 지금 실제로 1건 트윗(과금 발생) — 슬롯 소진 여부도 무시
//   SOCIAL_PROMO_FORCE=1 요일·주차 게이트를 무시하고 지금 앱 홍보 트윗 1건 강제 발사(테스트용)

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SITE, GAMES, DIGEST } from "../site.config.js";
import { prosePicker } from "./prose.js";
import {
  composePostImage, composePostImages, ogInfoSet,
  postDataFile, ogThreadInfo, composeInfoImage,
} from "./og.js";
import {
  buildPromoTweet, readPromoShots, promoBanned,
  isoWeekKey, etWeekday, normalizePromoState, decidePromo, selectPromoApp, recordPromo,
} from "./promo.js";

const TWEET_URL = "https://api.x.com/2/tweets";
const MEDIA_V2_URL = "https://api.x.com/2/media/upload";
const MEDIA_V1_URL = "https://upload.twitter.com/1.1/media/upload.json";

const MAX_TWEET = 280;
const TCO_LEN = 23; // X는 URL 길이와 무관하게 t.co 23자로 계산한다
const DAILY_LIMIT = 1; // 하루 최대 발사 건수 — 로또 글과 앱 홍보가 날마다 번갈아 나간다
// 발사 창(ET). "9시 정각에만"으로 두면 안 된다 — GitHub Actions의 schedule은 best-effort라
// 무료 저장소에서 2~3시간씩 밀리거나 통째로 누락된다(실측: 매시 :20 크론이 ET 02:30→05:23→07:51로 실행).
// 그래서 창 안에서 "그 슬롯이 아직 안 쏘였으면 첫 실행이 쏜다"로 바꿔 지연을 흡수한다.
// 슬롯당 하루 1건이므로 창을 넓혀도 총 2건/일은 그대로다.
// [시작시, 끝시) — 9:00~12:59 / 19:00~22:59. 실측 실행 간격이 2.4~3.5시간이라 3시간 창은 놓칠 수 있어 4시간으로 둔다.
const FIRE_WINDOWS = { morning: [9, 13], evening: [19, 23] };
const QUEUE_MAX = 20; // 큐 보관 상한 (초과 시 오래된 것부터 폐기)
const QUEUE_TTL_DAYS = 3; // 3일 지난 후보는 폐기 — 결과 글은 신선도가 생명
const POSTED_HISTORY = 100; // postedSlugs 롤링 보관 개수 (날짜가 바뀌어도 재트윗 방지)

// 기존 산문 규칙과 동일 — 당첨 보장·확률 암시 어휘 금지.
// 단어 경계로만 검사한다(substring이면 "following"의 "win" 등이 오탐).
const BANNED = /\b(win|wins|winning|won|winner|winners|odds|guaranteed|guarantee|jackpot|jackpots)\b/i;

/** update.js의 fillTemplate과 동일 — {key} 치환 */
function fillTemplate(str, vars) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** [16,55,64] → "16, 55 & 64" — lib/news.js의 andList와 같은 규칙(문구가 어긋나면 안 된다). */
function andList(arr) {
  const a = arr.map(String);
  if (a.length <= 1) return a[0] || "";
  return `${a.slice(0, -1).join(", ")} & ${a.at(-1)}`;
}

// ── OAuth 1.0a (HMAC-SHA1) ───────────────────────────────────────────────────

/**
 * RFC 3986 퍼센트 인코딩. unreserved = A-Za-z0-9-._~
 * encodeURIComponent는 !*'() 를 남기므로 추가로 인코딩한다(~ 는 그대로 둔다).
 */
export function pctEncode(str) {
  return encodeURIComponent(String(str)).replace(
    /[!*'()]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/**
 * 서명 base string 생성 — X 공식 문서 "Creating a signature" 절차 그대로.
 *   1. 모든 키/값을 퍼센트 인코딩
 *   2. 인코딩된 키 기준 사전순 정렬(키가 같으면 값 기준)
 *   3. key=value 를 & 로 연결 → parameter string
 *   4. METHOD & pctEncode(baseUrl) & pctEncode(parameterString)
 */
export function signatureBaseString(method, baseUrl, params) {
  const parameterString = Object.entries(params)
    .map(([k, v]) => [pctEncode(k), pctEncode(v)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `${method.toUpperCase()}&${pctEncode(baseUrl)}&${pctEncode(parameterString)}`;
}

/** 서명 키 = pctEncode(consumerSecret) & pctEncode(tokenSecret) */
export function signingKey(consumerSecret, tokenSecret) {
  return `${pctEncode(consumerSecret)}&${pctEncode(tokenSecret)}`;
}

/** HMAC-SHA1(base string, signing key) → base64 */
export function oauthSignature(method, baseUrl, params, consumerSecret, tokenSecret) {
  const base = signatureBaseString(method, baseUrl, params);
  return crypto
    .createHmac("sha1", signingKey(consumerSecret, tokenSecret))
    .update(base)
    .digest("base64");
}

/** Authorization 헤더 문자열 — OAuth k="v" 를 , 로 연결(값은 퍼센트 인코딩). */
export function authHeader(method, baseUrl, creds, extraParams = {}, overrides = {}) {
  const oauth = {
    oauth_consumer_key: creds.apiKey,
    oauth_nonce: overrides.nonce || crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: overrides.timestamp || String(Math.floor(Date.now() / 1000)),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  oauth.oauth_signature = oauthSignature(
    method,
    baseUrl,
    { ...oauth, ...extraParams },
    creds.apiSecret,
    creds.accessSecret
  );
  return (
    "OAuth " +
    Object.keys(oauth)
      .sort()
      .map((k) => `${pctEncode(k)}="${pctEncode(oauth[k])}"`)
      .join(", ")
  );
}

// ── 시각 (ET / DST) ──────────────────────────────────────────────────────────

/**
 * 미 동부(America/New_York) 기준 현재 시(0~23). DST는 Intl이 알아서 처리한다 —
 * UTC 오프셋을 하드코딩하면 3월/11월 전환 주에 1시간씩 어긋난다.
 * hourCycle:'h23' — hour12:false는 ICU 버전에 따라 자정을 "24"로 준다.
 */
export function etHour(now = new Date()) {
  const s = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(s) % 24;
}

/** 미 동부 기준 날짜 "YYYY-MM-DD" — 하루 카운트 리셋의 기준(UTC 자정 아님) */
export function etDate(now = new Date()) {
  // en-CA 로케일이 ISO 형식(YYYY-MM-DD)을 준다
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** 발사 창 안인가 — 창 안이면 슬롯 이름, 아니면 null */
export function slotOf(hour) {
  for (const [name, [from, to]] of Object.entries(FIRE_WINDOWS)) {
    if (hour >= from && hour < to) return name;
  }
  return null;
}

/** 발사 창 안인가 */
export function shouldFire(hour) {
  return slotOf(hour) !== null;
}

// ── 큐 ───────────────────────────────────────────────────────────────────────

const BIG_GAMES = new Set(["powerball", "mega"]);

/**
 * 낮을수록 우선. ①이변 뉴스 ②빅게임 결과 ③나머지 결과 ④주간 심층분석 ⑤다이제스트·리캡
 * 이변 뉴스가 최상위인 이유: 훅이 그 자체로 강하고("44가 50회째 잠잠"), 탐지된
 * 날에만 존재하는 희소한 글이라 슬롯을 양보하면 신선도가 먼저 죽는다.
 */
export function rankOf(item) {
  if (item.kind === "news") return 0;
  if (item.kind === "post") return BIG_GAMES.has(item.gameId) ? 1 : 2;
  if (item.kind === "analysis") return 3;
  return 4; // digest, recap
}

/**
 * 글의 URL 경로 — build.js의 URL 규칙과 반드시 일치해야 한다.
 * 큐의 키이자 og.js 시드이기도 하다(같은 글 = 같은 그림).
 */
export function urlPathOf(item) {
  if (item.kind === "digest") return `/${DIGEST.slug}/${item.date}/`;
  if (item.kind === "news") return `/${item.gameSlug}/${item.date}-news/`;
  if (item.kind === "analysis") return `/${item.gameSlug}/${item.date}-analysis/`;
  if (item.kind === "recap") return `/${item.gameSlug}/${item.date}-recap/`;
  return `/${item.gameSlug}/${item.date}/`;
}

export function postKey(item) {
  return item.slug || urlPathOf(item);
}

/**
 * 큐에 넣을 최소 후보 객체 — 문구 생성(buildTweet)과 이미지 합성(ogInfo)이
 * 필요로 하는 필드만 담는다. 글 JSON 전체를 state에 넣으면 state가 폭발한다.
 * 로테이션 기준이 되는 gameId는 다이제스트에도 값이 있어야 해서 DIGEST.slug로 채운다.
 */
export function toCandidate(item) {
  return {
    kind: item.kind,
    // 이변 뉴스의 훅은 수치를 그대로 읽는다("{num}이 {gap}회째") — facts가 없으면
    // 훅이 {num} 같은 플레이스홀더를 그대로 트윗하게 되므로 큐에 함께 싣는다.
    newsType: item.newsType || null,
    facts: item.facts || null,
    slug: urlPathOf(item),
    gameId: item.gameId || DIGEST.slug,
    gameSlug: item.gameSlug || null,
    gameName: item.gameName || DIGEST.name,
    date: item.date,
    publishedDate: item.publishedDate || item.date,
    rank: rankOf(item),
  };
}

/** ISO 날짜 차이(일). 파싱 실패는 0일로 본다(폐기하지 않음). */
function daysBetween(fromIso, toIso) {
  // 월간 리캡의 date는 "2026-06" — 그 달 1일로 본다
  const norm = (s) => (String(s).length === 7 ? `${s}-01` : s);
  const a = Date.parse(`${norm(fromIso)}T00:00:00Z`);
  const b = Date.parse(`${norm(toIso)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * 새 글을 큐에 적립한다(중복·이미 트윗한 글 제외) + TTL/상한 정리.
 * @returns {{queue: object[], added: number}}
 */
export function enqueue(queue, newItems, { today, posted = new Set() }) {
  const out = [...queue];
  const seen = new Set(out.map((c) => c.slug));
  let added = 0;

  for (const item of newItems) {
    if (!item || !item.kind || !item.date) continue;
    const cand = toCandidate(item);
    if (seen.has(cand.slug) || posted.has(cand.slug)) continue;
    seen.add(cand.slug);
    out.push(cand);
    added++;
  }

  // TTL — 오래된 후보 폐기
  const fresh = out.filter((c) => daysBetween(c.publishedDate, today) <= QUEUE_TTL_DAYS);
  // 상한 — 넘치면 오래된 것(날짜 오름차순)부터 버린다
  fresh.sort((a, b) => (a.publishedDate < b.publishedDate ? -1 : a.publishedDate > b.publishedDate ? 1 : 0));
  const capped = fresh.slice(-QUEUE_MAX);
  return { queue: capped, added };
}

/**
 * 슬롯 선호 — 저녁은 다음 추첨을 앞둔 "결과 직결" 계열(개별 결과 글 + 그 회차에서
 * 나온 이변 뉴스), 아침은 그 외 계열(다이제스트·주간분석·월간리캡).
 */
function isPicksPost(c) {
  return c.kind === "post" || c.kind === "news";
}
function matchesSlot(c, slot) {
  if (slot === "evening") return isPicksPost(c);
  if (slot === "morning") return !isPicksPost(c);
  return true;
}

/**
 * 큐에서 발사할 후보 1건을 고른다.
 * 정렬 우선순위(작을수록 우선):
 *   1) 직전에 쏜 게임 회피 (+100) — 큐가 전부 그 게임뿐이면 자연히 무시된다.
 *   2) 슬롯 선호 불일치 (+10) — 해당 계열이 큐에 없으면 자연히 무시된다.
 *   3) rank (빅게임 결과 > 나머지 결과 > 주간분석 > 다이제스트·리캡)
 *   4) 최신순
 * @returns {object|null}
 */
export function selectFromQueue(queue, { slot, lastGameId = null, posted = new Set() }) {
  const pool = queue.filter((c) => !posted.has(c.slug));
  if (pool.length === 0) return null;

  // rank는 후보에 적립 시점 값이 박혀 state.json에 남는다 — 우선순위 규칙이 바뀌면
  // 큐에 남아 있던 옛 후보만 옛 기준으로 겨루게 된다(TTL 3일간). 저장값을 믿지 않고
  // 매번 다시 계산한다. c.rank는 디버깅용 참고값으로만 남긴다.
  const scored = pool.map((c) => ({
    c,
    score: (c.gameId === lastGameId ? 100 : 0) + (matchesSlot(c, slot) ? 0 : 10) + rankOf(c),
  }));
  scored.sort(
    (a, b) =>
      a.score - b.score ||
      (a.c.publishedDate < b.c.publishedDate ? 1 : a.c.publishedDate > b.c.publishedDate ? -1 : 0) ||
      (a.c.slug < b.c.slug ? -1 : 1)
  );
  return scored[0].c;
}

// ── 트윗 문구 ────────────────────────────────────────────────────────────────

// 훅 — 글 종류별. {g}=게임명, {date}=짧은 날짜, {month}=월 이름.
// 금칙어(win/odds/jackpot 등)를 쓰지 않는다 — runSocial이 발사 직전 한 번 더 검사한다.
const HOOKS = {
  post: [
    "Fresh {g} sets are up for the next drawing.",
    "New {g} lines for the next draw, built from the {date} numbers.",
    "{g} sets for the next drawing, drawn up after {date}.",
    "Five new {g} lines, straight off the {date} result.",
    "{g}, {date}: results logged, hot and cold tables redrawn.",
    "The {date} {g} draw is in — and the charts moved.",
  ],
  digest: [
    "Every New York daily draw from {date}, in one tidy digest.",
    "Take 5 twice and Millionaire for Life once — the whole {date} slate, one page.",
    "One page, every {date} New York daily draw: results and fresh sets.",
    "The {date} roundup for New York's fast games is up.",
  ],
  analysis: [
    "This week's {g} deep dive: number pools, slip patterns and trend curves.",
    "No ready-made picks — just {g} data to build your own line this week.",
    "{g} weekly analysis: pools, momentum and neighbor stats, all laid out.",
    "The DIY {g} breakdown for this week is up — bring your own strategy.",
  ],
  recap: [
    "A full month of {g} results, gathered in one place.",
    "{month} in {g}: every draw, every pattern, one page.",
    "Monthly wrap-up — a whole month of {g} numbers, sorted.",
    "Every {g} drawing from {month}, plus the month's hottest numbers.",
  ],
  // ── 이변 뉴스 — 훅이 수치를 그대로 읽는다 (vars는 item.facts에서 온다) ──
  "long-absence": [
    "Number {num} has gone quiet for {gap} {g} draws.",
    "{gap} {g} draws in a row without number {num}.",
    "Number {num} is sitting on a {gap}-draw absence streak in {g}.",
    "The longest gap in our {g} window right now: number {num}, {gap} draws.",
  ],
  "repeat-number": [
    "{count} numbers showed up twice in a row in {g}: {nums}.",
    "{g} repeated {count} numbers from the previous draw — {nums}.",
    "Back-to-back in {g}: {nums} landed in consecutive draws.",
  ],
  "parity-extreme": [
    "All {c} {g} numbers came in {parity} last draw.",
    "A rare all-{parity} line turned up in {g}.",
    "{g} drew {c} {parity} numbers and nothing else.",
  ],
  "sum-extreme": [
    "{g} just posted its {dir} line total of the window: {sum}, against an average of {avg}.",
    "That {g} line added up to {sum} — the {dir} we have logged recently (average {avg}).",
    "Line total watch: {g} hit {sum}, its {dir} in the current window.",
  ],
  "consecutive-pair": [
    "{count} consecutive pairs in a single {g} line: {pairs}.",
    "{g} produced back-to-back runs — {pairs} — in one draw.",
    "Two runs in one line: {g} drew {pairs}.",
  ],
};

/** 훅 풀 선택 — 이변 뉴스는 종류별 풀, 나머지는 kind별 풀. */
function hookPoolFor(item) {
  if (item.kind === "news") return HOOKS[item.newsType] || HOOKS.post;
  return HOOKS[item.kind] || HOOKS.post;
}

const GAME_TAGS = {
  powerball: "#Powerball",
  mega: "#MegaMillions",
  nylotto: "#NYLotto",
  take5_mid: "#Take5",
  take5_eve: "#Take5",
  millionaire: "#MillionaireForLife",
  [DIGEST.slug]: "#Take5",
};

const GENERIC_TAGS = ["#LotteryStats", "#LotteryNumbers", "#DrawResults", "#NumberWatch"];

/** 게임 태그 1개 + 일반 태그 1~2개 (시드로 회전) */
function hashtagsFor(item, pick) {
  const tags = [];
  tags.push(GAME_TAGS[item.gameId] || "#Lottery");
  tags.push(pick(GENERIC_TAGS));
  tags.push(pick(GENERIC_TAGS));
  return [...new Set(tags)].slice(0, 3);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-07-11" → "Jul 11" (트윗은 짧게) */
function shortDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** "2026-06" → "June 2026" (월간 리캡용) */
function monthName(ym) {
  const [y, m] = String(ym).split("-").map(Number);
  return m ? `${MONTHS[m - 1]} ${y}` : String(ym);
}

/**
 * Play 스토어 링크 + 설치 추적 referrer.
 * lib/html.js appLink()는 utm_source=ssgpost/utm_medium=web 이라 웹 유입과 섞인다.
 * 소셜 유입을 따로 세려고 여기서는 utm_source=x / utm_medium=social 을 쓴다.
 */
export function playUrl(kind) {
  const referrer = encodeURIComponent(
    `utm_source=x&utm_medium=social&utm_campaign=blog&utm_content=${kind}`
  );
  return `${SITE.appUrl}&referrer=${referrer}`;
}

/** X 기준 글자수 — URL은 실제 길이와 무관하게 t.co 23자로 계산된다 */
export function weightedLength(text) {
  return text.replace(/https?:\/\/\S+/g, "x".repeat(TCO_LEN)).length;
}

/** 훅을 단어 경계에서 자른다 — 잘린 티가 덜 나게. */
function trimHook(hook, budget) {
  if (hook.length <= budget) return hook;
  if (budget < 12) return "";
  const cut = hook.slice(0, budget - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > 12 ? cut.slice(0, sp) : cut).replace(/[,.;:—-]+$/, "") + "…";
}

/**
 * 트윗 문구 생성(단발 — news/digest/recap. post/analysis는 buildThread가 담당).
 * 포맷: 훅 / "Free Android app: <Play URL>" / "Full story: <글 URL>" / 해시태그
 *   — 앱 링크가 위, 블로그 링크가 아래(스레드의 링크 배치와 같은 방향).
 * 280자(t.co 가중)를 넘으면 훅부터 축약하고, 그래도 넘치면 일반 해시태그를 뺀다.
 * @returns {{text:string, url:string, playUrl:string, key:string, length:number}}
 */
export function buildTweet(item) {
  const slug = postKey(item);
  const pick = prosePicker(`social:${slug}`);
  const url = `${SITE.baseUrl.replace(/\/$/, "")}${slug}`;
  const play = playUrl(item.kind);

  // post 글은 date=예측 대상일(아직 추첨 전), publishedDate=근거가 된 결과일이다.
  // post 훅의 {date}는 "결과가 나온 날"을 뜻하므로 publishedDate를 써야 한다 —
  // item.date를 쓰면 아직 추첨되지 않은 회차의 결과가 나온 것처럼 읽힌다.
  // digest/recap의 {date}는 그 자체가 대상 기간이라 item.date가 맞다.
  const hookDate = item.kind === "post" ? item.publishedDate || item.date : item.date;

  const f = item.facts || {};
  const vars = {
    g: item.gameName || "the draws",
    date: item.kind === "recap" ? monthName(item.date) : shortDate(hookDate),
    month: monthName(item.date),
    // 이변 뉴스 훅용 수치 — 배열은 훅에 그대로 못 박으므로 사람이 읽는 형태로 편다
    ...f,
    nums: Array.isArray(f.nums) ? andList(f.nums) : f.nums,
    pairs: Array.isArray(f.pairs) ? andList(f.pairs) : f.pairs,
    // 윈도에 잘린 gap은 "50+" — 제목·본문과 같은 표기를 써야 한다.
    // (gapText가 없는 옛 큐 항목은 원래 값으로 폴백)
    gap: f.gapText || f.gap,
  };

  const hook = fillTemplate(pick(hookPoolFor(item)), vars);
  let tags = hashtagsFor(item, pick);

  const compose = (h, tagList) =>
    [h, `Free Android app: ${play}`, `Full story: ${url}`, tagList.join(" ")].filter(Boolean).join("\n");

  let text = compose(hook, tags);
  if (weightedLength(text) > MAX_TWEET) {
    // 1) 훅 축약 — 초과분만큼 훅 예산을 깎는다
    const budget = hook.length - (weightedLength(text) - MAX_TWEET);
    text = compose(trimHook(hook, budget), tags);
  }
  while (weightedLength(text) > MAX_TWEET && tags.length > 1) {
    // 2) 일반 해시태그 제거 (게임 태그는 마지막까지 유지)
    tags = tags.slice(0, -1);
    text = compose(trimHook(hook, hook.length), tags);
  }

  return { text, url, playUrl: play, key: slug, length: weightedLength(text) };
}

// ── 스레드(트윗 체인) 문구 — kind: "post" | "analysis" ──────────────────────
//
// 로또 글은 단발 대신 3~4트윗 체인으로 나간다. 블로그 글의 prose(intro/hot/cold/
// patterns/insight/predictionsLead/outro — analysis는 intro/pools/outro)를 재료로
// 각 트윗을 만들고, 트윗마다 다른 데이터 이미지를 붙인다.
//   1 리드   : 훅 + intro 요약 + 앱 링크            — 이미지: 당첨번호 카드(대표)
//   2 분석 A : hot/cold 응축 + 실제 번호            — 이미지: 핫/콜드 이중 차트
//   3 분석 B : insight/patterns + predictionsLead   — 이미지: 세트 카드 + 미출현 차트
//              (analysis는 pools 조리법             — 이미지: 미출현 차트)
//   4 마무리 : outro 요약 + 블로그 링크 + 앱 링크 + 태그 — 이미지 없음
// 링크 배치: 앱 링크는 1·4에 두 번, 블로그 링크는 4에만(리드에 넣지 않는다).
// 재료가 빈 트윗은 자연히 빠져 3트윗으로 축소된다. news/digest/recap은 단발 유지.

const THREAD_KINDS = new Set(["post", "analysis"]);
const MARKER_RESERVE = 6; // "[1/4] " — 번호 표기 예산

// prose.outro가 전부 금칙어 문장일 때의 폴백 마무리 문구(금칙어 없음 확인됨)
const THREAD_CLOSERS = [
  "Fresh charts and new sets land after every draw.",
  "The full tables, pattern stats and all five sets are on the blog.",
  "Everything here updates automatically as new results come in.",
];

/** 문장 분해 — 마침표/물음표/느낌표/콜론 뒤 공백에서 자른다. */
function sentencesOf(text) {
  return String(text || "")
    .split(/(?<=[.!?:])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 산문을 트윗 예산에 맞게 응축한다 — 문장 단위로 이어붙이고(중간에서 뚝 자르지
 * 않는다), 금칙어가 든 문장은 통째로 버린다. 한 문장도 예산에 안 들어가면
 * 단어 경계 트리밍(trimHook)으로 폴백. 재료가 없으면 "".
 */
export function condenseProse(text, budget) {
  if (budget < 12) return "";
  const sents = sentencesOf(text).filter((s) => !BANNED.test(s));
  if (!sents.length) return "";
  let out = "";
  for (const s of sents) {
    const next = out ? `${out} ${s}` : s;
    if (next.length <= budget) out = next;
    else break;
  }
  return out || trimHook(sents[0], budget);
}

/** 문장 끝의 ":"를 "."로 — 리스트 도입부였던 산문이 데이터 없이 끝날 때 어색함 방지 */
function sealTail(s) {
  return s.replace(/[\s:;,—-]+$/, "").replace(/([^.!?])$/, "$1.");
}

/** 문장 끝을 ":"로 — 바로 뒤에 번호 나열이 붙는 자리 */
function colonTail(s) {
  return s.replace(/[\s:;,.—-]+$/, "") + ":";
}

/**
 * 스레드 문구 생성 — kind: post/analysis. 글 JSON(prose·stats)을 직접 읽는다.
 * 글 파일이 없거나 재료가 리드뿐이면 null → 호출자가 단발(buildTweet)로 폴백.
 * @returns {{tweets:{text:string,length:number,images:string[]}[], url:string, playUrl:string, key:string}|null}
 */
export function buildThread(item) {
  const slug = postKey(item);
  const pick = prosePicker(`social:${slug}`);
  const url = `${SITE.baseUrl.replace(/\/$/, "")}${slug}`;
  const play = playUrl(item.kind);

  let j = null;
  try {
    const file = postDataFile(item.kind, item.gameSlug, item.date);
    if (file && fs.existsSync(file)) j = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    j = null;
  }
  if (!j) return null;

  const p = j.prose || {};
  const stats = j.stats || {};
  const win = stats.window;

  // buildTweet과 같은 규칙 — post의 {date}는 결과일(publishedDate)
  const hookDate = item.kind === "post" ? item.publishedDate || item.date : item.date;
  const vars = { g: item.gameName || "the draws", date: shortDate(hookDate), month: monthName(item.date) };
  const hook = fillTemplate(pick(hookPoolFor(item)), vars);
  let tags = hashtagsFor(item, pick);

  const hotNums = (Array.isArray(stats.hot) ? stats.hot : []).slice(0, 5).map((h) => h.num);
  const coldNums = (Array.isArray(stats.cold) ? stats.cold : []).slice(0, 5).map((c) => c.num);

  const bodies = [];

  // 1) 리드 — 훅 + intro 요약 + 앱 링크 (블로그 링크는 여기 넣지 않는다)
  {
    const appLine = `Free Android app: ${play}`;
    const budget = MAX_TWEET - MARKER_RESERVE - hook.length - 1 - weightedLength(appLine) - 1;
    const intro = condenseProse(p.intro, budget);
    bodies.push({ text: [hook, intro, appLine].filter(Boolean).join("\n"), images: ["lead"] });
  }

  // 2) 분석 A — hot/cold 산문 응축 + 실제 번호 (이미지: 핫/콜드 차트)
  if (hotNums.length >= 3 && coldNums.length >= 3) {
    const hotTail = ` ${andList(hotNums)}.`;
    const coldTail = ` ${andList(coldNums)}.`;
    const budget = MAX_TWEET - MARKER_RESERVE - hotTail.length - coldTail.length - 1;
    const hotLead =
      condenseProse(p.hot, Math.ceil(budget * 0.55)) ||
      `Most drawn in the last ${win || "recent"} draws`;
    const coldLead = condenseProse(p.cold, Math.floor(budget * 0.45)) || "Quietest numbers right now";
    bodies.push({
      // 산문 끝을 ":"로 바꿔 번호 나열로 자연스럽게 잇는다
      text: `${colonTail(hotLead)}${hotTail}\n${colonTail(coldLead)}${coldTail}`,
      images: ["hotcold"],
    });
  }

  // 3) 분석 B — post: insight/patterns + predictionsLead (이미지: 세트 카드 + 미출현)
  //             analysis: pools 조리법 (이미지: 미출현)
  if (item.kind === "post") {
    const budget = MAX_TWEET - MARKER_RESERVE - 1;
    const a = condenseProse(p.insight || p.patterns, Math.ceil(budget * 0.45));
    const b = condenseProse(p.predictionsLead, budget - (a ? a.length + 1 : 0));
    if (a || b) {
      // predictionsLead의 끝 ":"는 그대로 둔다 — 바로 아래 세트 카드 이미지가 그 리스트다
      bodies.push({ text: [a ? sealTail(a) : "", b].filter(Boolean).join("\n"), images: ["sets", "overdue"] });
    }
  } else {
    const pools = condenseProse(p.pools, MAX_TWEET - MARKER_RESERVE);
    if (pools) bodies.push({ text: sealTail(pools), images: ["overdue"] });
  }

  // 4) 마무리 — outro 요약 + 블로그 링크 + 앱 링크 + 태그
  {
    const fixedFor = (tagList) =>
      `\nFull breakdown: ${url}\nFree Android app: ${play}\n${tagList.join(" ")}`;
    let fixed = fixedFor(tags);
    let outro = condenseProse(p.outro, MAX_TWEET - MARKER_RESERVE - weightedLength(fixed));
    if (!outro) outro = pick(THREAD_CLOSERS);
    let text = `${sealTail(outro)}${fixed}`;
    while (weightedLength(text) + MARKER_RESERVE > MAX_TWEET && tags.length > 1) {
      tags = tags.slice(0, -1); // 일반 태그부터 제거(게임 태그는 유지)
      fixed = fixedFor(tags);
      outro = condenseProse(p.outro, MAX_TWEET - MARKER_RESERVE - weightedLength(fixed)) || pick(THREAD_CLOSERS);
      text = `${sealTail(outro)}${fixed}`;
    }
    bodies.push({ text, images: [] });
  }

  // 금칙어 안전망 — 리드는 호출자(runSocial)가 기존 규칙대로 검사·스킵하고,
  // 후속 트윗은 여기서 조용히 빼서 스레드를 축소한다(재료는 이미 문장 단위로
  // 걸렀으므로 실제로는 거의 발동하지 않는다).
  const kept = bodies.filter((b, i) => {
    if (i === 0 || !BANNED.test(b.text)) return true;
    console.warn(`[social] thread tweet dropped (banned wording) for ${slug}: ${b.text.slice(0, 80)}`);
    return false;
  });
  if (kept.length < 2) return null; // 리드뿐이면 스레드의 의미가 없다 — 단발로 폴백

  const n = kept.length;
  const tweets = kept.map((b, i) => {
    const text = `[${i + 1}/${n}] ${b.text}`;
    return { text, length: weightedLength(text), images: b.images };
  });
  return { tweets, url, playUrl: play, key: slug };
}

// ── 미디어 업로드 ────────────────────────────────────────────────────────────
//
// v2 → 실패 시 v1.1 → 둘 다 실패하면 이미지 없이 텍스트 트윗.
// OAuth 1.0a 서명에서 multipart 본문은 서명 대상이 아니다(oauth_* 파라미터만 서명).

/** v2: POST /2/media/upload (multipart, media_category=tweet_image) */
async function uploadMediaV2(buf, creds) {
  const fd = new FormData();
  fd.append("media", new Blob([buf], { type: "image/jpeg" }), "og.jpg");
  fd.append("media_category", "tweet_image");

  const res = await fetch(MEDIA_V2_URL, {
    method: "POST",
    headers: { Authorization: authHeader("POST", MEDIA_V2_URL, creds) },
    body: fd,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`v2 ${res.status}: ${body.slice(0, 300)}`);
  const json = JSON.parse(body);
  // 응답 형태가 버전에 따라 갈린다: {data:{id}} | {data:{media_key}} | {media_id_string}
  const id = json?.data?.id || json?.id || json?.media_id_string || json?.data?.media_key;
  if (!id) throw new Error(`v2 no media id in response: ${body.slice(0, 200)}`);
  return String(id);
}

/** v1.1: POST upload.twitter.com/1.1/media/upload.json (multipart simple upload) */
async function uploadMediaV1(buf, creds) {
  const fd = new FormData();
  fd.append("media", new Blob([buf], { type: "image/jpeg" }), "og.jpg");

  const res = await fetch(MEDIA_V1_URL, {
    method: "POST",
    headers: { Authorization: authHeader("POST", MEDIA_V1_URL, creds) },
    body: fd,
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`v1.1 ${res.status}: ${body.slice(0, 300)}`);
  const json = JSON.parse(body);
  const id = json?.media_id_string || json?.media_id;
  if (!id) throw new Error(`v1.1 no media id in response: ${body.slice(0, 200)}`);
  return String(id);
}

/**
 * 이미지 업로드 — v2 먼저, 실패하면 v1.1. 둘 다 실패하면 null(호출자가 텍스트 폴백).
 * 절대 throw 하지 않는다.
 * @returns {Promise<{mediaId:string|null, via:string|null, errors:string[]}>}
 */
export async function uploadMedia(buf, creds) {
  const errors = [];
  for (const [via, fn] of [["v2", uploadMediaV2], ["v1.1", uploadMediaV1]]) {
    try {
      const mediaId = await fn(buf, creds);
      console.log(`[social] media uploaded via ${via} → ${mediaId}`);
      return { mediaId, via, errors };
    } catch (err) {
      errors.push(`${via}: ${err.message}`);
      console.warn(`[social] media upload ${via} failed: ${err.message}`);
    }
  }
  return { mediaId: null, via: null, errors };
}

const MEDIA_CAP = 4; // X 한 트윗당 이미지 최대 4장

/**
 * 여러 버퍼를 각각 개별 업로드해 media_id 배열을 얻는다(최대 cap장).
 * 각 장은 uploadMedia(v2→v1.1)로 시도하고, 실패한 장은 건너뛴다(성공분만 붙인다).
 * 전부 실패하면 빈 배열 → 호출자가 텍스트 트윗으로 폴백한다. 절대 throw 하지 않는다.
 * @returns {Promise<string[]>} 성공한 media_id들(입력 순서 = 표시 순서)
 */
export async function uploadMediaMany(bufs, creds, cap = MEDIA_CAP) {
  const ids = [];
  const list = (Array.isArray(bufs) ? bufs : []).slice(0, cap);
  for (let i = 0; i < list.length; i++) {
    const { mediaId } = await uploadMedia(list[i], creds);
    if (mediaId) ids.push(mediaId);
    else console.warn(`[social] media ${i + 1}/${list.length} upload failed — skipping this image`);
  }
  return ids;
}

/**
 * 발사 대상 글의 합성 썸네일을 임시 파일로 1장 만들고 버퍼로 읽는다.
 * lib/og.js의 합성 로직(sharp + 텍스트 오버레이)을 그대로 재사용 — 블로그
 * og:image와 같은 그림이 트윗에 붙는다. 실패하면 null(이미지 없이 진행).
 * @returns {Promise<{buf:Buffer, file:string, dir:string}|null>} 호출자가 dir을 정리해야 한다
 */
export async function makeTweetImage(item) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-og-"));
  const file = path.join(dir, "tweet.jpg");
  try {
    const ok = await composePostImage(item, file);
    if (!ok || !fs.existsSync(file)) {
      cleanupTemp(dir);
      return null;
    }
    return { buf: fs.readFileSync(file), file, dir };
  } catch (err) {
    console.warn(`[social] image compose failed for ${postKey(item)}: ${err.message}`);
    cleanupTemp(dir);
    return null;
  }
}

/**
 * 발사 대상 글의 합성 이미지 여러 장(1~4)을 임시 디렉터리에 만들고 버퍼 배열로 읽는다.
 * 0번은 블로그 og:image와 같은 대표 이미지, 이후는 보조 데이터 이미지(예측 세트·오버듀 등).
 * 데이터가 부족한 글은 자연히 1장만 만들어진다. 실패하면 null(이미지 없이 진행).
 * @returns {Promise<{bufs:Buffer[], files:string[], dir:string}|null>} 호출자가 dir을 정리해야 한다
 */
export async function makeTweetImages(item) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-og-"));
  try {
    const files = await composePostImages(item, dir, MEDIA_CAP);
    if (!files.length) {
      cleanupTemp(dir);
      return null;
    }
    return { bufs: files.map((f) => fs.readFileSync(f)), files, dir };
  } catch (err) {
    console.warn(`[social] images compose failed for ${postKey(item)}: ${err.message}`);
    cleanupTemp(dir);
    return null;
  }
}

function cleanupTemp(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* 임시 파일 정리 실패는 무시 */
  }
}

// ── 전송 ─────────────────────────────────────────────────────────────────────

const CRED_ENV = {
  apiKey: "X_API_KEY",
  apiSecret: "X_API_SECRET",
  accessToken: "X_ACCESS_TOKEN",
  accessSecret: "X_ACCESS_SECRET",
};

function readCreds() {
  const creds = {};
  const missing = [];
  for (const [field, envName] of Object.entries(CRED_ENV)) {
    creds[field] = process.env[envName];
    if (!creds[field]) missing.push(envName); // 로그에는 실제 env 이름을 남긴다
  }
  return { creds, missing };
}

/**
 * POST /2/tweets — JSON 본문은 서명 대상이 아니다(oauth_* 파라미터만 서명).
 * media는 단일 id(문자열) 또는 id 배열(최대 4장)을 받는다. 0개면 텍스트만.
 * replyToId를 주면 그 트윗의 답글로 발사된다(스레드 체인용).
 */
async function postTweet(text, creds, media, replyToId = null) {
  const payload = { text };
  const ids = (Array.isArray(media) ? media : media ? [media] : []).filter(Boolean).slice(0, MEDIA_CAP);
  if (ids.length) payload.media = { media_ids: ids };
  if (replyToId) payload.reply = { in_reply_to_tweet_id: String(replyToId) };

  const res = await fetch(TWEET_URL, {
    method: "POST",
    headers: {
      Authorization: authHeader("POST", TWEET_URL, creds),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`X API ${res.status}: ${body.slice(0, 300)}`);
  try {
    return JSON.parse(body).data;
  } catch {
    return null;
  }
}

// ── 미디어 업로드 단독 검증 (SOCIAL_MEDIA_TEST=1) ────────────────────────────

/**
 * 트윗하지 않고 이미지 업로드만 1회 시도해 결과를 로그로 남긴다.
 * 로컬에는 X 자격증명이 없으므로 이 경로는 GitHub Actions에서만 의미가 있다.
 * @returns {Promise<boolean>} 업로드 성공 여부
 */
export async function runMediaTest(dataDir) {
  console.log("[social][MEDIA TEST] tweet 없이 이미지 업로드만 시도합니다.");
  const { creds, missing } = readCreds();
  if (missing.length > 0) {
    console.error(`[social][MEDIA TEST] ${missing.join(", ")} not set — 중단`);
    return false;
  }

  const item = findAnyPost(dataDir);
  if (!item) {
    console.error(`[social][MEDIA TEST] ${dataDir} 에 글 JSON이 없습니다 — 중단`);
    return false;
  }
  console.log(`[social][MEDIA TEST] 대상 글: ${postKey(item)}`);

  const img = await makeTweetImage(item);
  if (!img) {
    console.error("[social][MEDIA TEST] 이미지 합성 실패 — 중단 (sharp/assets/og-images 풀 확인)");
    return false;
  }
  console.log(`[social][MEDIA TEST] 이미지 합성 OK — ${img.buf.length} bytes`);

  try {
    const { mediaId, via, errors } = await uploadMedia(img.buf, creds);
    if (mediaId) {
      console.log(`[social][MEDIA TEST] ✅ 성공 — ${via} 경로, media_id=${mediaId}`);
      console.log("[social][MEDIA TEST] → 이 경로로 이미지 트윗이 가능합니다.");
      return true;
    }
    console.error("[social][MEDIA TEST] ❌ 두 경로 모두 실패:");
    for (const e of errors) console.error(`  - ${e}`);
    console.error("[social][MEDIA TEST] → 실제 발사 시 이미지 없이 텍스트 트윗으로 폴백합니다.");
    return false;
  } finally {
    cleanupTemp(img.dir);
  }
}

/** data 디렉터리에서 가장 최신 개별 글 1건을 찾는다(미디어 테스트용) */
function findAnyPost(dataDir) {
  let best = null;
  for (const game of GAMES.filter((g) => g.mode === "post")) {
    const dir = path.join(dataDir, "posts", game.slug);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      try {
        const post = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
        if (!post.targetDate) continue;
        const item = {
          kind: "post", gameId: game.id, gameSlug: game.slug, gameName: game.name,
          date: post.targetDate, publishedDate: post.publishedDate,
        };
        if (!best || item.date > best.date) best = item;
      } catch {
        /* 깨진 JSON은 건너뛴다 */
      }
    }
  }
  return best;
}

// ── 메인 ─────────────────────────────────────────────────────────────────────

/**
 * 큐 적립 + 스케줄 발사. state._social 을 갱신하지만 파일 저장은 호출자(update.js)가 한다.
 * 실패는 전부 내부에서 격리 — 절대 throw 하지 않는다.
 *
 * @param {object[]} newItems 이번 실행에서 생성된 글 디스크립터들
 * @param {object} state data/state.json 내용 (mutate)
 * @param {object} [opts] 테스트용 주입 — {now, dryRun, creds}
 * @returns {Promise<boolean>} state가 변경됐는지
 */
export async function runSocial(newItems, state, opts = {}) {
  const now = opts.now || new Date();
  const dryRun = opts.dryRun ?? process.env.SOCIAL_DRY_RUN === "1";
  // 발사 시각(9/19 ET)을 기다리지 않고 지금 실제로 1건 쏜다 — 수동 검증용.
  // dryRun과 달리 진짜 트윗이 나가고, 하루 한도·재트윗 방지는 그대로 적용된다.
  const forceFire = opts.forceFire ?? process.env.SOCIAL_FORCE_FIRE === "1";
  // 요일·주차 게이트를 무시하고 앱 홍보 1건을 지금 발사(테스트용). forceFire와 같은
  // 방식으로 발사 창·슬롯 소진 게이트를 우회한다(DAILY_LIMIT은 그대로 존중).
  const promoForce = opts.promoForce ?? process.env.SOCIAL_PROMO_FORCE === "1";
  const today = etDate(now);
  const hour = etHour(now);

  const prev = state._social || {};
  // 날짜(ET 기준)가 바뀌면 카운트만 리셋. postedSlugs/queue는 롤링 —
  // 자정 경계에서 같은 글이 다시 트윗되는 일을 막는다.
  const social = {
    date: today,
    count: prev.date === today ? prev.count || 0 : 0,
    // 오늘 이미 쏜 슬롯 — 발사 창이 3시간이라 창 안에서 여러 번 실행돼도 슬롯당 1건만 나가게 한다
    firedSlots: prev.date === today && Array.isArray(prev.firedSlots) ? [...prev.firedSlots] : [],
    // 마지막으로 발사한 종류("post" | "promo") — 날짜가 바뀌어도 유지해야 교대가 이어진다
    lastKind: prev.lastKind || null,
    lastGameId: prev.lastGameId || null,
    postedSlugs: Array.isArray(prev.postedSlugs) ? [...prev.postedSlugs] : [],
    queue: Array.isArray(prev.queue) ? [...prev.queue] : [],
  };
  const posted = new Set(social.postedSlugs);

  // 1) 큐 적립 — 발사 여부와 무관하게 매 실행마다 한다
  const { queue, added } = enqueue(social.queue, newItems || [], { today, posted });
  const queueChanged = added > 0 || queue.length !== social.queue.length;
  social.queue = queue;
  if (added > 0) console.log(`[social] queued ${added} new post(s) — queue: ${queue.length}`);

  // 2) 발사 게이트
  const slot = slotOf(hour);
  // forceFire(통계 강제) / promoForce(앱 홍보 강제) 둘 다 발사 창·슬롯 게이트를 우회한다.
  const bypassGate = forceFire || promoForce;
  if (!dryRun) {
    if (!shouldFire(hour) && !bypassGate) {
      console.log(`[social] ${hour}:00 ET — 발사 창(9~12 / 19~22 ET) 밖, queue: ${queue.length}`);
      return commit(state, social, queueChanged);
    }
    if (bypassGate && !shouldFire(hour)) {
      console.log(`[social] FORCE FIRE — ${hour}:00 ET는 발사 창 밖이지만 강제 발사합니다.`);
    }
    if (slot && social.firedSlots.includes(slot) && !bypassGate) {
      console.log(`[social] ${slot} 슬롯은 오늘 이미 발사됨 — skip (${hour}:00 ET)`);
      return commit(state, social, queueChanged);
    }
    if (social.count >= DAILY_LIMIT) {
      console.log(`[social] daily limit reached (${social.count}/${DAILY_LIMIT}) — skip`);
      return commit(state, social, queueChanged);
    }
  }

  // 3) 선별
  const effectiveSlot = slot || (hour < 14 ? "morning" : "evening"); // dry run은 게이트를 무시한다

  // 3a) 오늘은 앱 홍보 차례인가 — 하루 1건이므로 "요일 고정"이 아니라 **직전 발사와
  // 번갈아** 간다(로또 글 → 앱 홍보 → 로또 글 …). state._social.lastKind 로 판단.
  //
  // 요일 게이트(화/금)를 쓰지 않는 이유: 하루 1건 체제에선 그날 슬롯이 곧 그날의
  // 유일한 트윗이라, 요일로 못 박으면 크론 지연으로 그 요일을 놓쳤을 때 홍보가
  // 통째로 밀린다. "직전과 다른 종류"는 언제 발사되든 교대가 유지된다.
  const week = isoWeekKey(today);
  const promoState = normalizePromoState(state._promo, week);
  // 직전이 홍보였으면 오늘은 로또 글, 아니면(=로또 글이었거나 첫 발사) 오늘은 홍보.
  const promoTurn = social.lastKind !== "promo";
  const promoDec = { fire: promoForce || promoTurn };
  if (promoDec.fire) {
    const app = selectPromoApp(promoState, { seed: `promo-app:${promoState.week}:${promoState.weekCount}` });
    if (app) {
      return await firePromo(state, social, promoState, {
        app, week, dryRun, hour, effectiveSlot, slot, creds: opts.creds, queueChanged,
      });
    }
    // 아직 어떤 앱도 hooks가 채워지지 않았다 — 홍보를 건너뛰고 통계 큐로 폴백(회귀 없음).
    console.log(`[social][promo] no app with hooks configured yet — falling back to stats queue`);
  }

  const cand = selectFromQueue(social.queue, {
    slot: effectiveSlot,
    lastGameId: social.lastGameId,
    posted,
  });
  if (!cand) {
    console.log(`[social] queue empty — nothing to tweet`);
    return commit(state, social, queueChanged);
  }

  // post/analysis는 스레드(3~4트윗 체인)로, 나머지(news/digest/recap)는 단발로 나간다.
  // 스레드 재료(글 JSON)가 없으면 단발로 폴백 — 트윗 자체는 반드시 나간다.
  let thread = null;
  if (THREAD_KINDS.has(cand.kind)) {
    try {
      thread = buildThread(cand);
    } catch (err) {
      console.warn(`[social] thread compose failed for ${cand.slug} (${err.message}) — falling back to single tweet`);
      thread = null;
    }
  }

  let tweet = null;
  if (!thread) {
    try {
      tweet = buildTweet(cand);
    } catch (err) {
      console.error(`[social] compose FAILED for ${cand.slug}: ${err.message}`);
      return commit(state, social, queueChanged);
    }
  }
  const leadText = thread ? thread.tweets[0].text : tweet.text;
  const leadKey = thread ? thread.key : tweet.key;
  if (BANNED.test(leadText)) {
    // 안전장치 — 훅 템플릿에 금칙어가 섞이면 트윗하지 않는다
    console.error(`[social] banned wording, skipping ${leadKey}: ${leadText}`);
    return commit(state, social, queueChanged);
  }

  if (dryRun) {
    console.log(
      `[social][DRY RUN] ${hour}:00 ET (slot: ${effectiveSlot}${slot ? "" : " — forced, not a real firing hour"})\n` +
        `[social][DRY RUN] queue: ${social.queue.length}, today: ${social.count}/${DAILY_LIMIT}, lastGameId: ${social.lastGameId || "—"}\n` +
        `[social][DRY RUN] selected: ${leadKey} (rank ${cand.rank}, ${cand.kind}, game ${cand.gameId})`
    );
    if (thread) {
      const withLinks = thread.tweets.filter((t) => /https?:\/\//.test(t.text)).length;
      const cost = (withLinks * 0.2 + (thread.tweets.length - withLinks) * 0.015).toFixed(2);
      console.log(
        `[social][DRY RUN] thread: ${thread.tweets.length} tweets (${withLinks} with links) ≈ $${cost}`
      );
      thread.tweets.forEach((t, i) => {
        console.log(
          `----- thread ${i + 1}/${thread.tweets.length} — ${t.length}/${MAX_TWEET} chars (t.co 가중), ` +
            `images: ${t.images.length ? t.images.join(", ") : "none"} -----\n${t.text}`
        );
      });
      console.log(`-----------------`);
    } else {
      let imgCount = 1;
      try {
        imgCount = ogInfoSet(cand, 4).length;
      } catch {
        /* 이미지 장수 추정 실패는 로그에만 영향 */
      }
      console.log(
        `[social][DRY RUN] images: ${imgCount} (max 4)\n` +
          `[social][DRY RUN] length: ${tweet.length}/${MAX_TWEET} (t.co 가중)\n` +
          `[social][DRY RUN] play: ${tweet.playUrl}\n` +
          `----- tweet -----\n${tweet.text}\n-----------------`
      );
    }
    // 발사만 건너뛰고 큐 적립은 반드시 저장한다.
    // 여기서 return false 하면, 마침 이 실행에서 새 회차가 잡혔을 때
    // update.js는 글 생성으로 state[game.id]를 이미 커밋하는데(= 그 회차는 소비됨)
    // 큐 적립분만 버려져 그 글이 영영 트윗되지 않는다(로그에 경고도 없음).
    return commit(state, social, queueChanged);
  }

  // 4) 자격증명 확인
  const { creds, missing } = opts.creds ? { creds: opts.creds, missing: [] } : readCreds();
  if (missing.length > 0) {
    console.log(`[social] ${missing.join(", ")} not set — skipping tweet`);
    return commit(state, social, queueChanged);
  }

  // 4b) 스레드 발사 경로 — 단발과 상태 기록 규칙이 달라 별도 함수로 뺐다
  if (thread) {
    return await fireThread(state, social, {
      cand, thread, creds, slot, queueChanged,
      delayMs: opts.threadDelayMs ?? 1500,
    });
  }

  // 5) 이미지 합성 + 업로드 (실패해도 텍스트 트윗은 나간다). 데이터가 되는 만큼 1~4장.
  let mediaIds = [];
  let img = null;
  try {
    img = await makeTweetImages(cand);
    if (img) {
      mediaIds = await uploadMediaMany(img.bufs, creds);
      if (!mediaIds.length) console.warn("[social] media upload unavailable — tweeting text only");
      else if (mediaIds.length < img.bufs.length) {
        console.warn(`[social] ${mediaIds.length}/${img.bufs.length} images uploaded — attaching the successful ones`);
      }
    } else {
      console.warn("[social] no composed image — tweeting text only");
    }
  } catch (err) {
    console.warn(`[social] media step failed (${err.message}) — tweeting text only`);
  } finally {
    if (img) cleanupTemp(img.dir);
  }

  // 6) 발사
  try {
    const data = await postTweet(tweet.text, creds, mediaIds);
    console.log(
      `[social] tweeted ${tweet.key} → ${data?.id || "ok"} ` +
        `(${tweet.length} chars, ${mediaIds.length ? `${mediaIds.length} image(s)` : "text only"})`
    );
    social.count += 1;
    // 이 슬롯은 오늘 소진 — 발사 창이 3시간이라 같은 창의 다음 실행이 또 쏘면 안 된다
    if (slot && !social.firedSlots.includes(slot)) social.firedSlots.push(slot);
    social.lastGameId = cand.gameId;
    social.lastKind = "post"; // 다음 차례는 앱 홍보
    social.postedSlugs.push(tweet.key);
    social.queue = social.queue.filter((c) => c.slug !== tweet.key);
    return commit(state, social, true);
  } catch (err) {
    // 트윗 실패가 발행을 막지 않는다. 큐에 남겨두고 다음 슬롯에 재시도한다.
    console.error(`[social] tweet FAILED for ${tweet.key}: ${err.message}`);
    return commit(state, social, queueChanged);
  }
}

// ── 스레드 발사 ──────────────────────────────────────────────────────────────
//
// 리드 → 답글 → 답글 … 순차 발사. X API v2의 reply.in_reply_to_tweet_id 로 잇는다.
//
// 부분 실패 규칙(중요): **리드가 성공한 순간 그 글은 "발사됨"이다.**
// postedSlugs·count·firedSlots·lastKind를 리드 성공 직후에 기록해, 후속 트윗이
// 실패해도 다음 실행이 같은 글로 스레드를 다시 시작하지 않는다(같은 리드가 두 번
// 나가는 사고 방지). 실패한 후속 트윗은 ::warning 로그만 남긴다.
// 리드 자체가 실패하면 기존 단발과 동일 — 큐에 남겨 다음 슬롯에 재시도.
async function fireThread(state, social, ctx) {
  const { cand, thread, creds, slot, queueChanged, delayMs = 1500 } = ctx;
  const n = thread.tweets.length;

  // 이미지 — 역할별로 1회씩 합성해 버퍼 맵으로 보관(트윗 간 중복 합성 없음).
  // 합성 실패한 역할은 그 트윗만 텍스트로 나간다. 절대 throw 하지 않는다.
  const roles = [...new Set(thread.tweets.flatMap((t) => t.images))];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "social-og-"));
  const bufs = {};
  try {
    for (const role of roles) {
      try {
        const info = ogThreadInfo(cand, role);
        if (!info) continue;
        const outFile = path.join(dir, `${role}.jpg`);
        if (await composeInfoImage(info, outFile)) bufs[role] = fs.readFileSync(outFile);
      } catch (err) {
        console.warn(`[social] thread image "${role}" failed (${err.message}) — that tweet goes text-only`);
      }
    }

    let prevId = null;
    let sent = 0;
    for (let i = 0; i < n; i++) {
      const t = thread.tweets[i];

      // 트윗별 이미지 업로드 — 실패한 장은 건너뛴다(성공분만 첨부)
      let mediaIds = [];
      const tweetBufs = t.images.map((r) => bufs[r]).filter(Boolean);
      if (tweetBufs.length) {
        try {
          mediaIds = await uploadMediaMany(tweetBufs, creds);
        } catch (err) {
          console.warn(`[social] thread ${i + 1}/${n} media step failed (${err.message}) — text only`);
        }
        if (!mediaIds.length) console.warn(`[social] thread ${i + 1}/${n}: media unavailable — text only`);
      }

      try {
        const data = await postTweet(t.text, creds, mediaIds, prevId);
        sent++;
        console.log(
          `[social] thread ${i + 1}/${n} tweeted → ${data?.id || "ok"} ` +
            `(${t.length} chars, ${mediaIds.length ? `${mediaIds.length} image(s)` : "text only"})`
        );
        if (i === 0) {
          // 리드 성공 = 이 글은 소비됨 — 후속 실패와 무관하게 지금 기록한다
          social.count += 1;
          if (slot && !social.firedSlots.includes(slot)) social.firedSlots.push(slot);
          social.lastGameId = cand.gameId;
          social.lastKind = "post"; // 다음 차례는 앱 홍보 (스레드도 로또 글이다)
          social.postedSlugs.push(thread.key);
          social.queue = social.queue.filter((c) => c.slug !== thread.key);
        }
        if (!data?.id && i < n - 1) {
          // 응답에 id가 없으면 다음 트윗을 이을 수 없다 — 남은 트윗은 포기
          console.warn(`::warning::[social] thread ${thread.key}: no tweet id in response — stopping after ${sent}/${n}`);
          break;
        }
        prevId = data?.id || prevId;
      } catch (err) {
        if (i === 0) {
          // 리드 실패 — 기존 단발 실패와 동일하게 큐 잔존, 다음 슬롯에 재시도
          console.error(`[social] thread lead FAILED for ${thread.key}: ${err.message}`);
          return commit(state, social, queueChanged);
        }
        console.warn(
          `::warning::[social] thread ${i + 1}/${n} FAILED for ${thread.key}: ${err.message} — ` +
            `lead already posted, thread truncated at ${sent}/${n} (no retry)`
        );
        break;
      }

      // 트윗 사이 대기 — 순차 답글이 타임라인에 자연스럽게 붙도록
      if (i < n - 1 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }

    // 비용 로그 — 링크 포함 $0.20/건, 미포함 $0.015/건
    const sentTweets = thread.tweets.slice(0, sent);
    const withLinks = sentTweets.filter((t) => /https?:\/\//.test(t.text)).length;
    const cost = (withLinks * 0.2 + (sent - withLinks) * 0.015).toFixed(2);
    console.log(`[social] thread: ${sent} tweets (${withLinks} with links) ≈ $${cost}`);

    return commit(state, social, sent > 0 ? true : queueChanged);
  } finally {
    cleanupTemp(dir);
  }
}

// ── 앱 홍보 발사 ─────────────────────────────────────────────────────────────
//
// 통계 글 발사 경로(위)와 미디어 폴백·BANNED 검사·재시도 격리를 그대로 공유하되,
// 큐 대신 promo.js의 앱 정의에서 문구를 만들고 저장소에 넣어 둔 스크린샷 jpg를 붙인다.
// 발사 성공 시 state._promo(주차 카운트·로테이션 이력)를 갱신한다.
async function firePromo(state, social, promoState, ctx) {
  const { app, week, dryRun, hour, effectiveSlot, slot, creds: injectedCreds, queueChanged } = ctx;

  const tweet = buildPromoTweet(app, { seed: `${app.id}:${week}` });
  if (!tweet) {
    // 방어적 — selectPromoApp이 hooks 있는 앱만 고르지만, 만일 비면 통계로 넘기지 않고 종료.
    console.log(`[social][promo] ${app.id} has no hooks configured — skip`);
    return commit(state, social, queueChanged);
  }

  if (promoBanned(tweet.text)) {
    console.error(`[social][promo] banned wording, skipping ${app.id}: ${tweet.text}`);
    return commit(state, social, queueChanged);
  }

  if (dryRun) {
    const shots = readPromoShots(app);
    const shotList = shots.length ? shots.map((s) => path.basename(s.file)).join(", ") : "none (text only — set app.shots)";
    console.log(
      `[social][DRY RUN][PROMO] ${hour}:00 ET (slot: ${effectiveSlot})\n` +
        `[social][DRY RUN][PROMO] week: ${week}, weekCount: ${promoState.weekCount}, lastAppId: ${promoState.lastAppId || "—"}\n` +
        `[social][DRY RUN][PROMO] selected app: ${app.id} (${app.name})\n` +
        `[social][DRY RUN][PROMO] length: ${tweet.length}/${MAX_TWEET} (t.co 가중)\n` +
        `[social][DRY RUN][PROMO] images: ${shots.length} — ${shotList}\n` +
        `----- promo tweet -----\n${tweet.text}\n-----------------------`
    );
    // 발사·상태 갱신은 하지 않는다(dry run) — 큐 적립만 저장한다.
    return commit(state, social, queueChanged);
  }

  const { creds, missing } = injectedCreds ? { creds: injectedCreds, missing: [] } : readCreds();
  if (missing.length > 0) {
    console.log(`[social][promo] ${missing.join(", ")} not set — skipping tweet`);
    return commit(state, social, queueChanged);
  }

  // 이미지 — 저장소에 넣어 둔 앱 스크린샷 jpg들을 그대로 업로드(실패해도 텍스트 트윗은 나간다). 최대 4장.
  let mediaIds = [];
  try {
    const shots = readPromoShots(app);
    if (shots.length) {
      mediaIds = await uploadMediaMany(shots.map((s) => s.buf), creds);
      if (!mediaIds.length) console.warn("[social][promo] media upload unavailable — tweeting text only");
      else if (mediaIds.length < shots.length) {
        console.warn(`[social][promo] ${mediaIds.length}/${shots.length} images uploaded — attaching the successful ones`);
      }
    } else {
      console.warn(`[social][promo] no screenshot for ${app.id} (app.shots empty) — tweeting text only`);
    }
  } catch (err) {
    console.warn(`[social][promo] media step failed (${err.message}) — tweeting text only`);
  }

  try {
    const data = await postTweet(tweet.text, creds, mediaIds);
    console.log(
      `[social][promo] tweeted ${app.id} → ${data?.id || "ok"} ` +
        `(${tweet.length} chars, ${mediaIds.length ? `${mediaIds.length} image(s)` : "text only"})`
    );
    social.count += 1;
    if (slot && !social.firedSlots.includes(slot)) social.firedSlots.push(slot);
    social.lastKind = "promo"; // 다음 차례는 로또 글
    state._promo = recordPromo(promoState, app);
    return commit(state, social, true);
  } catch (err) {
    // 발사 실패가 발행을 막지 않는다. 주차 카운트를 올리지 않아 다음 실행에서 재시도한다.
    console.error(`[social][promo] tweet FAILED for ${app.id}: ${err.message}`);
    return commit(state, social, queueChanged);
  }
}

/** state._social 반영 — changed가 false면 저장할 이유가 없다 */
function commit(state, social, changed) {
  if (!changed) return false;
  social.postedSlugs = social.postedSlugs.slice(-POSTED_HISTORY);
  state._social = social;
  return true;
}

export const _internals = { DAILY_LIMIT, QUEUE_MAX, QUEUE_TTL_DAYS, FIRE_WINDOWS, MAX_TWEET, BANNED, HOOKS };
