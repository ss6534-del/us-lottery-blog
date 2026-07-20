// US WorkPay 홍보 트윗용 추가 이미지(실제 앱 화면) 생성 — 1회성.
// 결과물: assets/app-shots/workpay_home.jpg / _stats.jpg / _ledger.jpg
//
// 원본은 project/USworktracer/store_assets 의 세로 스토어 스크린샷(3240x5760, 비율 0.563)이다.
// X는 트윗 이미지 비율을 0.8~1.91 로 제한하므로, 세로 스크린샷을 그대로 올리면 크롭된다.
// → 좌상단 배경색을 뽑아 좌우로 패딩해 비율을 0.82 로 맞춘다(위아래는 원본 그대로).
//
// 첫 장(workpay.jpg = 기능 소개 카드)은 make-workpay-card.mjs가 이미 만든다 — 여기선 손대지 않는다.
// 실행: node scripts/make-workpay-shots.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.resolve(ROOT, "..", "USworktracer", "store_assets");
const OUT_DIR = path.join(ROOT, "assets", "app-shots");

// 원본 파일 → 출력 파일명 (영문 스크린샷만 — 트윗은 영어권 대상)
const SHOTS = [
  ["screenshot_1_home_en.png", "workpay_home.jpg"],
  ["screenshot_2_stats_en.png", "workpay_stats.jpg"],
  ["screenshot_3_ledger_en.png", "workpay_ledger.jpg"],
];

const TARGET_H = 1600; // 세로 다운스케일 목표(파일 크기 관리)
const TARGET_RATIO = 0.82; // 0.8~1.91 안쪽에서 세로 화면답게(안전 마진)

/** 이미지 좌상단 픽셀색 추출 → 패딩 배경으로 쓴다. */
async function cornerColor(src) {
  const px = await sharp(src)
    .extract({ left: 0, top: 0, width: 8, height: 8 })
    .resize(1, 1)
    .raw()
    .toBuffer();
  return { r: px[0], g: px[1], b: px[2] };
}

async function makeShot(srcFile, outFile) {
  const src = path.join(SRC_DIR, srcFile);
  if (!fs.existsSync(src)) {
    console.warn(`[workpay-shots] skip (원본 없음): ${src}`);
    return false;
  }
  const bg = await cornerColor(src);

  // 세로 기준 다운스케일 → 폭 계산
  const resized = await sharp(src).resize({ height: TARGET_H }).toBuffer();
  const m = await sharp(resized).metadata();
  const w = m.width;
  const canvasW = Math.max(w, Math.round(TARGET_H * TARGET_RATIO));
  const padL = Math.round((canvasW - w) / 2);
  const padR = canvasW - w - padL;

  await sharp(resized)
    .extend({ top: 0, bottom: 0, left: padL, right: padR, background: bg })
    .jpeg({ quality: 86, mozjpeg: true })
    .toFile(outFile);

  const meta = await sharp(outFile).metadata();
  const { size } = fs.statSync(outFile);
  console.log(
    `[workpay-shots] ${path.basename(outFile)} — ${meta.width}x${meta.height} ` +
      `ratio ${(meta.width / meta.height).toFixed(3)} (bg rgb(${bg.r},${bg.g},${bg.b}), ${size} bytes)`
  );
  return true;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const [srcFile, outName] of SHOTS) {
    await makeShot(srcFile, path.join(OUT_DIR, outName));
  }
}

main().catch((e) => {
  console.error("[workpay-shots] 실패:", e.message);
  process.exit(1);
});
