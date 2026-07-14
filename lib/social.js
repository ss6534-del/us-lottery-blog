// 자동 트윗(X) — 큐 적립 + 하루 2회 스케줄 발사 모델.
//
// 설계 메모
// - 의존성 0: OAuth 1.0a(HMAC-SHA1) 서명을 node:crypto로 직접 구현, 전송은 내장 fetch.
//   이미지 합성만 lib/og.js(sharp)를 재사용한다 — 트윗 그림 = 글 og:image.
// - 큐 모델: update.js가 매시간 돌면서 새 글을 state._social.queue 에 적립만 하고,
//   실제 발사는 미 동부 기준 오전 9시대 / 오후 7시대에 1건씩(하루 최대 2건).
//   "새 글이 생긴 시각"과 "미국 독자가 깨어 있는 시각"이 다르기 때문.
// - DST: UTC 오프셋을 하드코딩하지 않고 Intl(America/New_York)로 현재 ET 시각을 구한다.
//   3월/11월 전환에도 9AM ET가 정확히 9AM ET다.
// - 단일 사이트라 promo-site의 "사이트 순환" 대신 "같은 게임 연속 회피"를 쓴다.
// - 미디어: v2 → v1.1 순으로 업로드를 시도하고, 둘 다 실패하면 로그만 남기고
//   "이미지 없는 텍스트 트윗"으로 폴백한다 — 트윗 자체는 반드시 나간다.
// - 실패 격리: 자격증명이 없거나 API가 실패해도 로그만 남기고 글 발행에는 영향 0.
// - 멱등: postedSlugs(롤링 100건)에 있는 글은 절대 재트윗하지 않는다.
//
// 검증용 env
//   SOCIAL_DRY_RUN=1    발사 시간 게이트를 무시하고 "지금 쏜다면" 선택될 글·문구만 출력
//                       (실제 POST·업로드 없음, state 미변경)
//   SOCIAL_MEDIA_TEST=1 트윗하지 않고 이미지 업로드만 1회 시도해 성공/실패·응답을 로그로 출력

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SITE, GAMES, DIGEST } from "../site.config.js";
import { prosePicker } from "./prose.js";
import { composePostImage } from "./og.js";

const TWEET_URL = "https://api.x.com/2/tweets";
const MEDIA_V2_URL = "https://api.x.com/2/media/upload";
const MEDIA_V1_URL = "https://upload.twitter.com/1.1/media/upload.json";

const MAX_TWEET = 280;
const TCO_LEN = 23; // X는 URL 길이와 무관하게 t.co 23자로 계산한다
const DAILY_LIMIT = 2; // 하루 최대 발사 건수
const FIRE_HOURS = new Set([9, 19]); // 발사 시각(ET) — 워크플로가 매시 :20에 도니 9:20 / 19:20
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

/** 발사 시각인가 — ET 9시대 / 19시대에만 true */
export function shouldFire(hour) {
  return FIRE_HOURS.has(hour);
}

/** 발사 슬롯 이름 — 아침/저녁에 따라 선호 글 계열이 다르다 */
export function slotOf(hour) {
  if (hour === 9) return "morning";
  if (hour === 19) return "evening";
  return null;
}

// ── 큐 ───────────────────────────────────────────────────────────────────────

const BIG_GAMES = new Set(["powerball", "mega"]);

/** 낮을수록 우선. ①빅게임 결과 ②나머지 결과 ③주간 심층분석 ④다이제스트·리캡 */
export function rankOf(item) {
  if (item.kind === "post") return BIG_GAMES.has(item.gameId) ? 0 : 1;
  if (item.kind === "analysis") return 2;
  return 3; // digest, recap
}

/**
 * 글의 URL 경로 — build.js의 URL 규칙과 반드시 일치해야 한다.
 * 큐의 키이자 og.js 시드이기도 하다(같은 글 = 같은 그림).
 */
export function urlPathOf(item) {
  if (item.kind === "digest") return `/${DIGEST.slug}/${item.date}/`;
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
 * 슬롯 선호 — 저녁은 다음 추첨용 picks(개별 결과 글), 아침은 그 외 계열
 * (다이제스트·주간분석·월간리캡).
 */
function isPicksPost(c) {
  return c.kind === "post";
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

  const scored = pool.map((c) => ({
    c,
    score: (c.gameId === lastGameId ? 100 : 0) + (matchesSlot(c, slot) ? 0 : 10) + (c.rank ?? 3),
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
};

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
 * 트윗 문구 생성. 시드(글 URL 경로)로 훅·태그를 골라 문장이 반복되지 않게 한다.
 * 포맷: 훅 / 글 URL / "Free Android app: <Play URL>" / 해시태그
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

  const vars = {
    g: item.gameName || "the draws",
    date: item.kind === "recap" ? monthName(item.date) : shortDate(hookDate),
    month: monthName(item.date),
  };

  const hook = fillTemplate(pick(HOOKS[item.kind] || HOOKS.post), vars);
  let tags = hashtagsFor(item, pick);

  const compose = (h, tagList) =>
    [h, url, `Free Android app: ${play}`, tagList.join(" ")].filter(Boolean).join("\n");

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

/** POST /2/tweets — JSON 본문은 서명 대상이 아니다(oauth_* 파라미터만 서명). */
async function postTweet(text, creds, mediaId) {
  const payload = { text };
  if (mediaId) payload.media = { media_ids: [mediaId] };

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
  const today = etDate(now);
  const hour = etHour(now);

  const prev = state._social || {};
  // 날짜(ET 기준)가 바뀌면 카운트만 리셋. postedSlugs/queue는 롤링 —
  // 자정 경계에서 같은 글이 다시 트윗되는 일을 막는다.
  const social = {
    date: today,
    count: prev.date === today ? prev.count || 0 : 0,
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
  if (!dryRun) {
    if (!shouldFire(hour) && !forceFire) {
      console.log(`[social] ${hour}:00 ET — not a firing hour (9 / 19), queue: ${queue.length}`);
      return commit(state, social, queueChanged);
    }
    if (forceFire && !shouldFire(hour)) {
      console.log(`[social] FORCE FIRE — ${hour}:00 ET는 발사 시각이 아니지만 강제 발사합니다.`);
    }
    if (social.count >= DAILY_LIMIT) {
      console.log(`[social] daily limit reached (${social.count}/${DAILY_LIMIT}) — skip`);
      return commit(state, social, queueChanged);
    }
  }

  // 3) 선별
  const effectiveSlot = slot || (hour < 14 ? "morning" : "evening"); // dry run은 게이트를 무시한다
  const cand = selectFromQueue(social.queue, {
    slot: effectiveSlot,
    lastGameId: social.lastGameId,
    posted,
  });
  if (!cand) {
    console.log(`[social] queue empty — nothing to tweet`);
    return commit(state, social, queueChanged);
  }

  let tweet;
  try {
    tweet = buildTweet(cand);
  } catch (err) {
    console.error(`[social] compose FAILED for ${cand.slug}: ${err.message}`);
    return commit(state, social, queueChanged);
  }
  if (BANNED.test(tweet.text)) {
    // 안전장치 — 훅 템플릿에 금칙어가 섞이면 트윗하지 않는다
    console.error(`[social] banned wording, skipping ${tweet.key}: ${tweet.text}`);
    return commit(state, social, queueChanged);
  }

  if (dryRun) {
    console.log(
      `[social][DRY RUN] ${hour}:00 ET (slot: ${effectiveSlot}${slot ? "" : " — forced, not a real firing hour"})\n` +
        `[social][DRY RUN] queue: ${social.queue.length}, today: ${social.count}/${DAILY_LIMIT}, lastGameId: ${social.lastGameId || "—"}\n` +
        `[social][DRY RUN] selected: ${tweet.key} (rank ${cand.rank}, ${cand.kind}, game ${cand.gameId})\n` +
        `[social][DRY RUN] length: ${tweet.length}/${MAX_TWEET} (t.co 가중)\n` +
        `[social][DRY RUN] play: ${tweet.playUrl}\n` +
        `----- tweet -----\n${tweet.text}\n-----------------`
    );
    return false; // dry run은 state를 건드리지 않는다
  }

  // 4) 자격증명 확인
  const { creds, missing } = opts.creds ? { creds: opts.creds, missing: [] } : readCreds();
  if (missing.length > 0) {
    console.log(`[social] ${missing.join(", ")} not set — skipping tweet`);
    return commit(state, social, queueChanged);
  }

  // 5) 이미지 합성 + 업로드 (실패해도 텍스트 트윗은 나간다)
  let mediaId = null;
  let img = null;
  try {
    img = await makeTweetImage(cand);
    if (img) {
      const r = await uploadMedia(img.buf, creds);
      mediaId = r.mediaId;
      if (!mediaId) console.warn("[social] media upload unavailable — tweeting text only");
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
    const data = await postTweet(tweet.text, creds, mediaId);
    console.log(
      `[social] tweeted ${tweet.key} → ${data?.id || "ok"} ` +
        `(${tweet.length} chars, ${mediaId ? "with image" : "text only"})`
    );
    social.count += 1;
    social.lastGameId = cand.gameId;
    social.postedSlugs.push(tweet.key);
    social.queue = social.queue.filter((c) => c.slug !== tweet.key);
    return commit(state, social, true);
  } catch (err) {
    // 트윗 실패가 발행을 막지 않는다. 큐에 남겨두고 다음 슬롯에 재시도한다.
    console.error(`[social] tweet FAILED for ${tweet.key}: ${err.message}`);
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

export const _internals = { DAILY_LIMIT, QUEUE_MAX, QUEUE_TTL_DAYS, FIRE_HOURS, MAX_TWEET, BANNED, HOOKS };
