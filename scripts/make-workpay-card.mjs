// US WorkPay 홍보 트윗용 이미지 카드 생성 (1회성 — 결과물은 assets/app-shots/workpay.jpg).
//
// 스토어 스크린샷이 프로젝트에 없어서(앱 아이콘만 존재) 아이콘 + 기능 문구로
// 카드를 합성한다. 브랜드 그린 #0E9F6E 은 앱 테마(app_themes.dart brandPrimary)와 동일.
//
// 실행: node scripts/make-workpay-card.mjs [--icon <경로>] [--out <경로>]
// 스크린샷이 생기면 그걸 assets/app-shots/workpay.jpg 로 바꾸면 된다(코드 수정 불필요).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const argOf = (flag, dflt) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const ICON = argOf("--icon", path.resolve(ROOT, "..", "USworktracer", "assets", "icon", "appicon.png"));
const OUT = argOf("--out", path.join(ROOT, "assets", "app-shots", "workpay.jpg"));

const W = 1344;
const H = 768;
const BRAND = "#0E9F6E";
const BRAND_DEEP = "#0A7A54";

// 앱의 실제 기능만 적는다(과장 금지) — 급여방식 4종, 마일리지, 내보내기.
const BULLETS = [
  "Hourly · Day rate · Per job · Per mile",
  "Mileage with the IRS standard rate",
  "Monthly totals, meals &amp; fuel included",
  "Export CSV / PDF",
];

const esc = (s) => String(s).replace(/&(?!amp;)/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function cardSvg() {
  const bullets = BULLETS.map(
    (b, i) => `
    <circle cx="96" cy="${412 + i * 62}" r="7" fill="${BRAND}"/>
    <text x="124" y="${420 + i * 62}" font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
          font-size="34" fill="#E8F5EF">${esc(b)}</text>`
  ).join("");

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0B2A20"/>
      <stop offset="55%" stop-color="#0D3A2C"/>
      <stop offset="100%" stop-color="${BRAND_DEEP}"/>
    </linearGradient>
    <linearGradient id="glow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${BRAND}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${BRAND}" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <circle cx="1090" cy="250" r="330" fill="url(#glow)"/>

  <rect x="88" y="96" width="86" height="8" rx="4" fill="${BRAND}"/>
  <text x="88" y="196" font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
        font-size="82" font-weight="bold" fill="#FFFFFF">US WorkPay</text>
  <text x="90" y="268" font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
        font-size="40" fill="#9FD9C3">Wage &amp; attendance tracker</text>
  <text x="90" y="326" font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
        font-size="34" fill="#7FC7AC">for hourly, day-rate, per-job and per-mile work</text>

  ${bullets}

  <text x="90" y="712" font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
        font-size="30" font-weight="bold" fill="#CFEDE0">Free on Google Play</text>
</svg>`;
}

async function main() {
  if (!fs.existsSync(ICON)) {
    console.error(`[workpay-card] 앱 아이콘을 찾을 수 없습니다: ${ICON}`);
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  // 아이콘 — 우측에 크게, 둥근 모서리로
  const ICON_SIZE = 300;
  const rounded = Buffer.from(
    `<svg width="${ICON_SIZE}" height="${ICON_SIZE}"><rect width="${ICON_SIZE}" height="${ICON_SIZE}" rx="64" ry="64"/></svg>`
  );
  const icon = await sharp(ICON)
    .resize(ICON_SIZE, ICON_SIZE, { fit: "cover" })
    .composite([{ input: rounded, blend: "dest-in" }])
    .png()
    .toBuffer();

  await sharp(Buffer.from(cardSvg()))
    .composite([{ input: icon, left: 940, top: 300 }])
    .jpeg({ quality: 90 })
    .toFile(OUT);

  const { size } = fs.statSync(OUT);
  console.log(`[workpay-card] 생성: ${OUT} (${size} bytes, ${W}x${H})`);
}

main().catch((e) => {
  console.error("[workpay-card] 실패:", e.message);
  process.exit(1);
});
