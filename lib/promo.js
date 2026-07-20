// 앱 홍보 트윗(X) — app1~10을 각자 성격에 맞게 소개한다.
//
// 통계 글 트윗(social.js의 buildTweet/큐)과는 별개의 콘텐츠다. social.js가
// "화/금 저녁 슬롯"을 앱 홍보로 대체할 때 이 모듈의 데이터·문구·이미지를 쓴다.
//
// ⚠️ 문구(hooks)와 이미지(shot)는 비워 뒀다 — 사용자가 실제 앱을 확인하고 채운다.
//   아래 APPS 배열 한 곳에만 채우면 된다. hooks가 비어 있는 앱은 홍보 발사가
//   조용히 건너뛰어지므로(안전), 채우기 전에는 그 앱이 트윗되지 않는다.
//
// 설계 메모
// - 앱 이름·slug·packageName = promo-site(src/data/apps.ts)의 실제 값.
// - 훅(hooks): 앱마다 컨셉이 완전히 달라(원탭 생성기 / 네온 랩 / 손그림 저널 …)
//   이름만으로 넘겨짚으면 부정확하다 → 사용자가 확정한 문구로 채운다. 여러 개면
//   시드로 회전한다. 금칙어(win/odds/guaranteed/jackpot 등)는 절대 넣지 않는다.
// - 이미지(shot): assets/app-shots/ 아래 jpg 파일명. promo-site의 Play 스토어
//   스크린샷(webp)을 scripts/convert-app-shots.mjs로 jpg 변환해 이 저장소에 넣어
//   둔다(CI는 promo-site를 체크아웃하지 않으므로 파일이 저장소 안에 있어야 한다).
//   어떤 스크린샷을 쓸지는 사용자가 확정하고 이 shot 필드에 파일명만 넣으면 된다.
// - social.js와의 순환 import를 피하려고 weightedLength/trimHook/BANNED를
//   이 모듈이 독립적으로 갖는다(소량 중복).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prosePicker } from "./prose.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS_DIR = path.join(ROOT, "assets", "app-shots");

const MAX_TWEET = 280;
const TCO_LEN = 23; // X는 URL을 t.co 23자로 계산한다

// social.js의 BANNED와 동일 규칙 — 당첨/확률 암시 어휘 금지(단어 경계로만 검사).
const BANNED = /\b(win|wins|winning|won|winner|winners|odds|guaranteed|guarantee|jackpot|jackpots)\b/i;

// ── 앱 정의 (← 사용자가 hooks / shot 을 여기서 채운다) ─────────────────────────
//
// 필드
//   id          : "appN" (홍보 사이트 번호·UTM content 로도 쓰인다)
//   name        : Play 스토어 표시명 (apps.ts 실제 값)
//   slug        : URL 슬러그 (apps.ts 실제 값 — 참고용)
//   packageName : appfactory.us.appN
//   promoUrl    : 홍보 사이트 베이스 URL (UTM은 promoLink()가 붙인다)
//   hooks       : [] ← TODO(사용자): 성격에 맞는 홍보 문구 2~3개. 금칙어 금지, ≤280자.
//   shot        : "" ← TODO(사용자): assets/app-shots/ 아래 jpg 파일명 (예: "app1.jpg"). 비우면 텍스트 트윗.
//   tags        : (선택) 앱별 추가 해시태그. 없으면 GENERIC_TAGS에서 회전.
// 홍보 대상은 US WorkPay 하나다(사용자 결정 2026-07-18). app1~10 로또 앱들은
// 홍보하지 않는다 — 아래 LOTTO_APPS에 보관만 해 두고 APPS에서 제외했다.
//
// 훅은 실제 소스(project/USworktracer)의 기능·UI 문구 기준으로 작성:
//   pubspec description "wage & attendance tracker for hourly, day-rate, per-job
//   and per-mile workers", 달력 근무 입력, 수당(식대·유류비) 가산, IRS 마일 단가
//   빠른채움($0.70/mi 대), 월 예상수입·통계, 고용주 모드(직원 출퇴근),
//   Export CSV/PDF, 트럭커 다건 입력.
// ⚠️ 로또 콘텐츠가 아니므로 로또 해시태그·문구를 섞지 않는다(tags를 앱에 직접 지정).
export const APPS = [
  {
    id: "workpay",
    name: "US WorkPay",
    slug: "us-workpay",
    packageName: "appfactory.US.worktracer",
    // 홍보 사이트가 아직 없어 Play 스토어로 직접 보낸다(사용자 지시: 블로그 링크 생략).
    promoUrl: "https://play.google.com/store/apps/details?id=appfactory.US.worktracer",
    shot: "workpay.jpg", // 하위호환(단일). 다중 첨부는 shots를 우선 사용한다.
    // 피처 그래픽 1장만 쓴다(사용자 결정 2026-07-18). 실제 앱 스크린샷(home/stats/ledger)은
    // 스토어 캡처가 $0.00 빈 상태라 "빈 앱"처럼 보여 홍보에 역효과 → 제외.
    // 데모 데이터가 채워진 화면으로 재캡처하면 아래 배열에 다시 추가할 수 있다.
    // (재캡처 후: node scripts/make-workpay-shots.mjs 로 workpay_*.jpg 갱신)
    shots: ["workpay.jpg"],
    tags: ["#TimeTracking", "#Trucking", "#Paycheck"],
    hooks: [
      "Hourly, day rate, per job, per mile — log the work, and the app does the math on what you earned.",
      "Track your hours and your pay in one place. Add meals and fuel, and see the month add up as you go.",
      "Drivers: log miles with the IRS standard rate built in, and keep every run in one tidy calendar.",
      "Know what your paycheck should say before it lands. Log each shift, check the total, export CSV or PDF.",
      "Free work log for hourly and day-rate crews — calendar entry, monthly totals, and clean exports.",
    ],
  },
];

// 로또 앱들 — 현재 홍보 대상이 아니다. 다시 홍보하려면 이 배열의 항목을 APPS로 옮긴다.
const LOTTO_APPS = [
  { id: "app1", name: "AI lotto generator", slug: "ai-lotto-generator", packageName: "appfactory.us.app1", promoUrl: "https://appfactory1.ssgpost.org/", shot: "app1.jpg", tags: [],
    hooks: [
      "One tap, a fresh set of numbers — plus a clean read on Powerball & Mega Millions results.",
      "A distraction-free number generator with a tidy results dashboard. Free on Android.",
      "Generate a set, track the latest draws, keep your history in one calm little app.",
    ] },
  { id: "app2", name: "ai lottery pick", slug: "ai-lottery-pick", packageName: "appfactory.us.app2", promoUrl: "https://appfactory2.ssgpost.org/", shot: "app2.jpg", tags: [],
    hooks: [
      "Save your numbers and let the Match Center check them against every new draw for you.",
      "Latest results up front, a hot & cold frequency table, and auto-matching for your saved sets.",
      "Never re-check a ticket by hand again — the Match Center does it the moment results land.",
    ] },
  { id: "app3", name: "Lottery Maker Lab", slug: "lottery-maker-lab", packageName: "appfactory.us.app3", promoUrl: "https://appfactory3.ssgpost.org/", shot: "app3.jpg", tags: [],
    hooks: [
      "Collect your numbers by playing mini-games, then check them against frequency graphs & heatmaps.",
      "A neon number lab: build sets through arcade games, analyze patterns, save your favorites.",
      "Catch Number, Lucky Vault, Pattern Rush — turn picking numbers into a game. Free on Android.",
    ] },
  { id: "app4", name: "Lotto AI Insight", slug: "lotto-ai-insight", packageName: "appfactory.us.app4", promoUrl: "https://appfactory4.ssgpost.org/", shot: "app4.jpg", tags: [],
    hooks: [
      "Check your saved lines against the latest draw, watch the countdown to the next one, and read hot & cold at a glance.",
      "A friendly daily lottery companion: match checker, draw countdown, and a hot/cold analysis lab.",
      "See how your lines did, then get ready for the next draw — with a clover mascot to keep it light.",
    ] },
  { id: "app5", name: "Lottery Ticket Studio", slug: "lottery-ticket-studio", packageName: "appfactory.us.app5", promoUrl: "https://appfactory5.ssgpost.org/", shot: "app5.jpg", tags: [],
    hooks: [
      "Keep your tickets tidy, study frequency analytics, and run an after-tax estimate — just to see the number.",
      "The only one of our apps with a tax calculator: register tickets, read the stats, estimate the take-home.",
      "History, AI Studio, Tax Calc, Analytics — a proper little studio for organizing your play.",
    ] },
  { id: "app7", name: "Sketch Lotto generator", slug: "sketch-lotto-generator", packageName: "appfactory.us.app7", promoUrl: "https://appfactory7.ssgpost.org/", shot: "app7.jpg", tags: [],
    hooks: [
      "Jot your lucky combos in a hand-drawn journal — Cosmic Cluster, Lunar Line, Starry Six.",
      "A cozy sketchbook for lottery numbers: name your combos, doodle your picks, skim the trends.",
      "Lottery numbers with a bullet-journal feel — save named sets and browse frequency, all in pencil.",
    ] },
  { id: "app8", name: "Lotto Forge", slug: "lotto-forge", packageName: "appfactory.us.app8", promoUrl: "https://appfactory8.ssgpost.org/", shot: "app8.jpg", tags: [],
    hooks: [
      "Generate sets from presets — Balanced, Low-bias, Hot mix — then compare them side by side.",
      "A number workshop: forge sets with synthesis presets, line them up in Compare, keep a history.",
      "Every set has identical chances in a fair draw — Compare is about preference, not probability.",
    ] },
  { id: "app9", name: "Lotto generator Tool", slug: "lotto-generator-tool", packageName: "appfactory.us.app9", promoUrl: "https://appfactory9.ssgpost.org/", shot: "app9.jpg", tags: [],
    hooks: [
      "A dark-console number tool with deep stats: range balance, pair synergy, momentum, overdue watch.",
      "Generate in a terminal-style UI, then dig into the numbers — this is the stats-nerd pick.",
      "Range balance, pairs that show up together, rising vs cooling — the analytics console for your picks.",
    ] },
  { id: "app10", name: "US lotto AI Lab", slug: "us-lotto-ai-lab", packageName: "appfactory.us.app10", promoUrl: "https://appfactory10.ssgpost.org/", shot: "app10.jpg", tags: [],
    hooks: [
      "One tap makes three sets at once, auto-saved — plus the latest US draws in bright, tidy cards.",
      "A cheerful pastel lab: generate multiple sets instantly and browse every recent US lottery result.",
      "Three sets, zero typing, all saved — the fast & friendly way to line up your numbers.",
    ] },
];

// 기본 해시태그 + (앱 tags가 비어 있을 때) 회전용 일반 태그 풀.
// ⚠️ 홍보 대상이 로또 앱이 아니므로 로또 태그를 기본값에 두지 않는다 —
//    앱별 tags(예: WorkPay의 #TimeTracking)로 주제를 맞춘다.
const BASE_TAGS = ["#Android", "#AndroidApp"];
const GENERIC_TAGS = ["#App", "#FreeApp"];

export function appById(id) {
  return APPS.find((a) => a.id === id) || null;
}

// ── URL ───────────────────────────────────────────────────────────────────────

/** 홍보 사이트 링크 + UTM. app.promoUrl(베이스) 에 소셜 추적 파라미터를 붙인다. */
export function promoLink(app) {
  const raw = String(app.promoUrl || "").trim();
  if (!raw) return "";
  const utm = `utm_source=x&utm_medium=social&utm_campaign=app-promo&utm_content=${app.id}`;

  // Play 스토어 링크는 ?id=... 쿼리가 이미 있고 경로 끝에 "/"를 붙이면 안 된다
  // (붙이면 .../details?id=pkg/?utm... 이 되어 링크가 깨진다).
  // 설치 출처 추적도 Play는 utm_* 를 referrer 파라미터 안에 담는 규약을 쓴다.
  if (/play\.google\.com\/store\/apps\/details/.test(raw)) {
    const sep = raw.includes("?") ? "&" : "?";
    return `${raw}${sep}referrer=${encodeURIComponent(utm)}`;
  }

  // 일반 홍보 사이트: 끝에 "/" 를 보장하고 쿼리로 UTM을 붙인다.
  const base = raw.replace(/\/+$/, "") + "/";
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${utm}`;
}

// ── 문구 ──────────────────────────────────────────────────────────────────────

/** X 기준 글자수 — URL은 실제 길이와 무관하게 t.co 23자 */
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

/** 해시태그 — 기본 2개 + 앱별(or 일반) 1개, 시드로 회전. 최대 3개. */
function hashtagsFor(app, pick) {
  const extraPool = app.tags && app.tags.length ? app.tags : GENERIC_TAGS;
  const extra = extraPool.length ? pick(extraPool) : null;
  return [...new Set([...BASE_TAGS, extra].filter(Boolean))].slice(0, 3);
}

/**
 * 앱 홍보 트윗 문구 생성.
 * 포맷: 훅 / 홍보사이트 URL(+UTM) / 해시태그
 * 280자(t.co 가중)를 넘으면 훅을 축약하고, 그래도 넘치면 해시태그를 뺀다.
 * hooks가 비어 있으면 null 을 반환한다 — 호출자(firePromo)가 조용히 건너뛴다.
 * @param {object} app APPS 항목
 * @param {object} [opts] {seed} — 훅/태그 회전 시드(주차별로 다른 훅이 나오게)
 * @returns {{text:string, url:string, appId:string, length:number}|null}
 */
export function buildPromoTweet(app, opts = {}) {
  if (!app || !Array.isArray(app.hooks) || app.hooks.length === 0) return null;

  const pick = prosePicker(opts.seed || `promo:${app.id}`);
  const url = promoLink(app);
  const hook = pick(app.hooks);
  let tags = hashtagsFor(app, pick);

  const compose = (h, tagList) => [h, url, tagList.join(" ")].filter(Boolean).join("\n");

  let text = compose(hook, tags);
  if (weightedLength(text) > MAX_TWEET) {
    const budget = hook.length - (weightedLength(text) - MAX_TWEET);
    text = compose(trimHook(hook, budget), tags);
  }
  while (weightedLength(text) > MAX_TWEET && tags.length > 1) {
    tags = tags.slice(0, -1);
    text = compose(trimHook(hook, hook.length), tags);
  }

  return { text, url, appId: app.id, length: weightedLength(text) };
}

/** 발사 직전 안전 검사용 — 금칙어 포함 여부 */
export function promoBanned(text) {
  return BANNED.test(text);
}

// ── 이미지 ────────────────────────────────────────────────────────────────────

/**
 * 앱 스크린샷 jpg 버퍼 — assets/app-shots/<app.shot>. app.shot 이 비었거나 파일이
 * 없으면 null(텍스트 트윗). 파일은 미리 변환해 저장소에 넣어 둔다. 런타임 변환 없음.
 * @param {object} app APPS 항목 (app.shot = 파일명)
 * @returns {{buf:Buffer, file:string}|null}
 */
export function readPromoShot(app) {
  if (!app || !app.shot) return null;
  const file = path.join(SHOTS_DIR, app.shot);
  try {
    if (!fs.existsSync(file)) return null;
    return { buf: fs.readFileSync(file), file };
  } catch {
    return null;
  }
}

/**
 * 앱 스크린샷 여러 장(최대 cap장) — app.shots(배열) 우선, 없으면 app.shot(단일)로 폴백.
 * 없는 파일은 건너뛴다(장수 자동 축소). 하나도 없으면 빈 배열(텍스트 트윗).
 * @param {object} app APPS 항목 (app.shots = 파일명 배열)
 * @returns {{buf:Buffer, file:string}[]}
 */
export function readPromoShots(app, cap = 4) {
  if (!app) return [];
  const names = Array.isArray(app.shots) && app.shots.length ? app.shots : app.shot ? [app.shot] : [];
  const out = [];
  for (const name of names.slice(0, cap)) {
    const file = path.join(SHOTS_DIR, name);
    try {
      if (fs.existsSync(file)) out.push({ buf: fs.readFileSync(file), file });
    } catch {
      /* 읽기 실패한 장은 건너뛴다 */
    }
  }
  return out;
}

// ── 스케줄 (ET 요일·ISO 주차 기반) ───────────────────────────────────────────
//
// 주 2회. 화요일(=요일 2) 첫 회, 금요일(=요일 5) 둘째 회를 "저녁 슬롯"에 발사한다.
// GitHub Actions 크론이 밀리거나 빠질 수 있으므로 "그 요일 정각"이 아니라
// "그 요일 이후 + 저녁 슬롯"의 누적 목표치(target)로 판정한다 — 화요일 저녁이
// 드롭되면 수요일 저녁에 채우되, 주 2회는 넘지 않게 한다.

/** "YYYY-MM-DD"(ET 달력일) → 요일 Mon=1 … Sun=7 */
export function etWeekday(etDateStr) {
  const [y, m, d] = String(etDateStr).split("-").map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun … 6=Sat
  return wd === 0 ? 7 : wd;
}

/** "YYYY-MM-DD"(ET 달력일) → ISO 주차 키 "YYYY-Www"(월요일 시작) */
export function isoWeekKey(etDateStr) {
  const [y, m, d] = String(etDateStr).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = dt.getUTCDay() || 7; // Mon=1 … Sun=7
  dt.setUTCDate(dt.getUTCDate() + 4 - day); // 그 주의 목요일
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((dt - yearStart) / 86400000 + 1) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** 그 요일까지 "저녁 슬롯에서 발사돼 있어야 하는" 앱 홍보 누적 건수(0/1/2) */
export function promoTargetByWeekday(weekday) {
  let t = 0;
  if (weekday >= 2) t = 1; // 화요일 이후 1회차
  if (weekday >= 5) t = 2; // 금요일 이후 2회차
  return t;
}

/** state._promo 정규화 — 주차가 바뀌면 weekCount만 리셋(로테이션 이력은 유지) */
export function normalizePromoState(prev, week) {
  const p = prev && typeof prev === "object" ? prev : {};
  const sameWeek = p.week === week;
  return {
    week,
    weekCount: sameWeek ? p.weekCount || 0 : 0,
    postedAppIds: Array.isArray(p.postedAppIds) ? [...p.postedAppIds] : [],
    lastAppId: p.lastAppId || null,
  };
}

/**
 * 이번 실행에서 앱 홍보를 발사해야 하는가.
 * @param {object} promoState normalizePromoState 결과
 * @param {object} ctx {slot, weekday, promoForce}
 * @returns {{fire:boolean, reason:string}}
 */
export function decidePromo(promoState, { slot, weekday, promoForce }) {
  if (promoForce) return { fire: true, reason: "force" };
  if (slot !== "evening") return { fire: false, reason: "not-evening-slot" };
  const target = promoTargetByWeekday(weekday);
  if (promoState.weekCount >= target) {
    return { fire: false, reason: `week quota (${promoState.weekCount}/${target})` };
  }
  return { fire: true, reason: `due (${promoState.weekCount} < ${target})` };
}

/**
 * 발사할 앱 1개 선택. postedAppIds(로테이션 이력)에 없는 앱 우선, lastAppId 회피.
 * hooks가 채워진 앱만 후보로 삼는다(문구 없는 앱은 트윗할 수 없다).
 * 한 바퀴 다 돌면 이력이 리셋된 상태로 다시 고른다. 후보가 없으면 null.
 * @param {object} promoState
 * @param {object} [opts] {seed}
 * @returns {object|null} APPS 항목
 */
export function selectPromoApp(promoState, opts = {}) {
  const ready = APPS.filter((a) => Array.isArray(a.hooks) && a.hooks.length > 0);
  if (ready.length === 0) return null; // 아직 아무 앱도 문구가 없다 → 발사 불가

  const posted = promoState.postedAppIds || [];
  let pool = ready.filter((a) => !posted.includes(a.id));
  if (pool.length === 0) pool = ready.slice(); // 한 바퀴 완료 → 리셋
  const avoid = pool.filter((a) => a.id !== promoState.lastAppId);
  const finalPool = avoid.length ? avoid : pool;
  const pick = prosePicker(opts.seed || "promo-app");
  return pick(finalPool);
}

/**
 * 발사 성공 후 promoState 갱신 — weekCount++, 로테이션 이력에 추가(전부 돌면 리셋),
 * lastAppId 기록. 사이클 크기는 "문구가 채워진 앱 수" 기준이다.
 */
export function recordPromo(promoState, app) {
  const readyCount = APPS.filter((a) => Array.isArray(a.hooks) && a.hooks.length > 0).length;
  let posted = [...(promoState.postedAppIds || [])];
  if (posted.includes(app.id)) posted = []; // 안전: 이미 있으면 새 사이클로
  posted.push(app.id);
  if (posted.length >= Math.max(1, readyCount)) posted = []; // 한 바퀴 완료 → 이력 리셋
  return {
    week: promoState.week,
    weekCount: (promoState.weekCount || 0) + 1,
    postedAppIds: posted,
    lastAppId: app.id,
  };
}

export const _internals = { MAX_TWEET, BANNED, BASE_TAGS, GENERIC_TAGS };
