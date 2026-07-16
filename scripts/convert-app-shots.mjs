// promo-site의 Play 스토어 스크린샷(webp)을 앱 홍보 트윗용 jpg로 변환해
// assets/app-shots/<appId>.jpg 로 이 저장소에 넣는다.
//
// 왜 저장소에 넣나: CI(GitHub Actions)는 promo-site를 체크아웃하지 않으므로,
// 트윗에 붙일 이미지는 이 저장소 안에 파일로 존재해야 한다. lib/promo.js의
// APPS[].shot 에 여기서 만든 파일명(예: "app1.jpg")을 넣으면 트윗에 첨부된다.
//
// 사용:
//   node scripts/convert-app-shots.mjs [--src <promo-site/public/shots>] [--idx 01]
// 앱별로 다른 스크린샷을 쓰려면 SHOT_INDEX 매핑을 편집한다(사용자가 확정).

import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "assets", "app-shots");

// 기본 소스: 로컬 promo-site 체크아웃. --src 로 재정의.
const args = process.argv.slice(2);
const srcArg = args.includes("--src") ? args[args.indexOf("--src") + 1] : null;
const defaultIdx = args.includes("--idx") ? args[args.indexOf("--idx") + 1] : "01";
const SRC = srcArg || "C:/Users/appfactory/Desktop/ai_study/promo-site/public/shots";

// 앱별로 어떤 스크린샷을 쓸지 (사용자가 확정해 편집). 값은 파일명(확장자 제외).
// 지정 없으면 defaultIdx(=01) 사용.
const SHOT_INDEX = {
  // app1: "02",
};

const IDS = ["app1", "app2", "app3", "app4", "app5", "app7", "app8", "app9", "app10"];
const MAX_W = 1000; // 원본 폭(≈400px)의 2배 상한 — X 타임라인 선명도 확보

fs.mkdirSync(OUT, { recursive: true });
let done = 0;
for (const id of IDS) {
  const idx = SHOT_INDEX[id] || defaultIdx;
  const src = path.join(SRC, id, `${idx}.webp`);
  if (!fs.existsSync(src)) {
    console.log(`SKIP ${id}: not found ${src}`);
    continue;
  }
  const out = path.join(OUT, `${id}.jpg`);
  const meta = await sharp(src).metadata();
  await sharp(src)
    .resize({ width: Math.min(MAX_W, (meta.width || 400) * 2), withoutEnlargement: false })
    .flatten({ background: "#ffffff" }) // 알파 대비 흰 배경
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out);
  const st = fs.statSync(out);
  console.log(`OK ${id}: ${idx}.webp ${meta.width}x${meta.height} -> ${id}.jpg ${(st.size / 1024) | 0}KB`);
  done++;
}
console.log(`\n${done}/${IDS.length} converted → ${OUT}`);
console.log("다음: lib/promo.js APPS[].shot 에 파일명(예: \"app1.jpg\")을 넣으세요.");
