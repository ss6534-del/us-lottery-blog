// 글별 대표 이미지(og:image / 리드 이미지 / 트윗 첨부) 합성.
//
// 설계 메모
// - 이미지 풀(assets/og-images/N.jpg)은 flux-dev로 만든 16:9 사진 10장. 글마다 시드로
//   1장을 골라 sharp로 텍스트 오버레이를 합성해 dist/og/<name>.jpg 를 만든다.
//   같은 글은 재빌드해도 같은 그림 — 시드가 글 URL 경로라 고정된다.
// - sharp는 이 저장소의 유일한 의존성이다. 로드 실패/합성 실패 시 풀 원본을 복사해
//   렌더는 반드시 계속된다(이미지 없는 사이트가 되느니 오버레이 없는 사진이 낫다).
// - 폰트 파일에 의존하지 않는다(DejaVu Sans / Arial / Helvetica) — Windows 로컬과
//   CI(ubuntu) 양쪽에서 렌더되어야 하므로.
// - 캐시: build.js가 dist/를 통째로 지우므로 합성본은 .og-cache/ 에 남겨두고
//   dist로 복사한다. 소스(풀 파일 + 오버레이 문구)가 그대로면 합성을 건너뛴다.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, DIGEST } from "../site.config.js";
import { prosePicker } from "./prose.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POOL_DIR = path.join(ROOT, "assets", "og-images");
const CACHE_DIR = path.join(ROOT, ".og-cache");
const CACHE_MANIFEST = path.join(CACHE_DIR, "manifest.json");

// 풀 이미지의 실제 픽셀 크기 — FLUX 16:9 1MP 출력
export const OG_W = 1344;
export const OG_H = 768;

export const OG_INDEX_FILE = "_index.jpg"; // 홈/인덱스용 — 풀 1번 고정

const ACCENT = "#FFD670"; // style.css --accent
const MONTHS = [
  "JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE",
  "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER",
];

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

/** "2026-07-15" → "JUL 15, 2026" (오버레이용 대문자) */
function ogDate(iso) {
  if (!iso) return "";
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m) return String(iso).toUpperCase();
  const mon = MONTHS[m - 1].slice(0, 3);
  return d ? `${mon} ${d}, ${y}` : `${mon} ${y}`;
}

/**
 * 글 1건의 이미지 정보 — 파일명·시드·오버레이 문구를 한곳에서 결정한다.
 * build.js(렌더)와 social.js(트윗)가 같은 함수를 써야 두 그림이 일치한다.
 *
 * @param {object} item
 * @param {"post"|"digest"|"analysis"|"recap"} item.kind
 * @param {string} [item.gameSlug] 게임 slug (post/analysis/recap)
 * @param {string} [item.gameName] 게임 표시명 (post)
 * @param {string} item.date  post=targetDate, digest=date, analysis=weekStart, recap=month
 * @returns {{file:string, seed:string, big:string, small:string}}
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

  const d = ogDate(date);
  return { file, seed, big: d ? `${head} · ${d}` : head, small: SITE.title.toUpperCase() };
}

/** XML 이스케이프 (SVG 텍스트용) */
function escXml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * 텍스트 오버레이 SVG — 하단 어두운 그라데이션 + accent 바 + 볼드 텍스트.
 * 폰트 파일에 의존하지 않는다(시스템 sans-serif 볼드만).
 */
function overlaySvg(big, small) {
  const W = OG_W, H = OG_H;
  const pad = 64;
  // 큰 텍스트가 폭을 넘으면 폰트 축소 (bold sans 평균 글자폭 ≈ 0.62em)
  let fs1 = 64;
  const maxW = W - pad * 2;
  if (big.length * fs1 * 0.62 > maxW) {
    fs1 = Math.max(34, Math.floor(maxW / (big.length * 0.62)));
  }
  const smallText = small
    ? `<text x="${pad}" y="${H - 46}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="26" font-weight="600" letter-spacing="3" fill="rgba(255,255,255,0.82)">${escXml(small)}</text>`
    : "";
  return Buffer.from(`<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#000000" stop-opacity="0"/>
      <stop offset="0.55" stop-color="#000000" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#000000" stop-opacity="0.88"/>
    </linearGradient>
  </defs>
  <rect x="0" y="${Math.round(H * 0.5)}" width="${W}" height="${Math.round(H * 0.5)}" fill="url(#g)"/>
  <rect x="${pad}" y="${H - 176}" width="92" height="10" rx="3" fill="${ACCENT}"/>
  <text x="${pad}" y="${H - 104}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif" font-size="${fs1}" font-weight="800" fill="#ffffff">${escXml(big)}</text>
  ${smallText}
</svg>`);
}

// ── 캐시 ─────────────────────────────────────────────────────────────────────
// build.js가 dist/를 새로 만들므로 합성본을 .og-cache/ 에 보관하고 복사해 쓴다.
// 키 = 풀 파일 내용 해시 + 오버레이 문구. 소스가 그대로면 sharp를 다시 돌리지 않는다.

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

function cacheKey(poolFile, big, small) {
  const src = fs.statSync(path.join(POOL_DIR, poolFile));
  return crypto
    .createHash("sha1")
    .update(`${poolFile}|${src.size}|${src.mtimeMs}|${big}|${small}|${ACCENT}|${OG_W}x${OG_H}`)
    .digest("hex");
}

// ── 합성 ─────────────────────────────────────────────────────────────────────

/**
 * 풀 원본 + 오버레이 → outFile. sharp가 없거나 합성이 실패하면 원본을 복사한다.
 * @returns {Promise<"composed"|"cached"|"fallback">}
 */
async function composeTo(poolFile, outFile, big, small, { useCache = true } = {}) {
  const src = path.join(POOL_DIR, poolFile);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  // 1) 캐시 히트 — 소스·문구가 그대로면 복사만
  if (useCache) {
    const key = cacheKey(poolFile, big, small);
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
        await sharp(src)
          .resize(OG_W, OG_H, { fit: "cover" })
          .composite([{ input: overlaySvg(big, small), top: 0, left: 0 }])
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
      await sharp(src)
        .resize(OG_W, OG_H, { fit: "cover" })
        .composite([{ input: overlaySvg(big, small), top: 0, left: 0 }])
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
  const { file, seed, big, small } = ogInfo(item);
  const poolFile = pickPoolFile(pool, seed);
  const status = await composeTo(poolFile, path.join(outDir, file), big, small);
  return { file, status };
}

/** 홈/인덱스용 — 풀 1번 고정, 사이트명만 크게 */
export async function renderIndexImage(outDir, pool = loadOgPool()) {
  if (pool.length === 0) return null;
  const status = await composeTo(pool[0], path.join(outDir, OG_INDEX_FILE), SITE.title.toUpperCase(), SITE.tagline.toUpperCase());
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
  const { seed, big, small } = ogInfo(item);
  const poolFile = pickPoolFile(pool, seed);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  await composeTo(poolFile, outFile, big, small, { useCache: false });
  return fs.existsSync(outFile);
}
