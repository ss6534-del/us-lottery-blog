// 데이터 차트는 AI 이미지가 아니라 코드로 생성한 인라인 SVG를 쓴다 (정확성 보장).

/** 상위 10개 번호 빈도 세로 막대 차트 */
export function frequencyBarChart(hot10, maxFreq, color) {
  const W = 640;
  const H = 240;
  const pad = { top: 16, right: 8, bottom: 34, left: 8 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const bw = Math.floor(innerW / hot10.length) - 12;

  let bars = "";
  hot10.forEach((e, i) => {
    const h = Math.max(4, Math.round((e.count / maxFreq) * innerH));
    const x = pad.left + i * (innerW / hot10.length) + 6;
    const y = pad.top + innerH - h;
    bars += `
    <rect x="${x}" y="${y}" width="${bw}" height="${h}" rx="6" fill="${color}" opacity="0.88"/>
    <text x="${x + bw / 2}" y="${y - 5}" text-anchor="middle" class="cv">${e.count}</text>
    <text x="${x + bw / 2}" y="${H - 12}" text-anchor="middle" class="cn">${e.num}</text>`;
  });

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Top 10 most frequent numbers">
  <style>.cv{font:600 13px system-ui,sans-serif;fill:#556}.cn{font:700 14px system-ui,sans-serif;fill:#223}</style>
  <line x1="${pad.left}" y1="${pad.top + innerH}" x2="${W - pad.right}" y2="${pad.top + innerH}" stroke="#d8dce6" stroke-width="1.5"/>
  ${bars}
</svg>`;
}

/** 홀짝 / 고저 비율 가로 스택 바 */
export function splitBar(label, leftLabel, leftCount, rightLabel, rightCount, color) {
  const W = 640;
  const H = 56;
  const total = leftCount + rightCount;
  const lw = Math.round((leftCount / total) * W);
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${label}">
  <style>.sl{font:700 14px system-ui,sans-serif;fill:#fff}</style>
  <rect x="0" y="8" width="${lw}" height="36" rx="8" fill="${color}"/>
  <rect x="${lw + 4}" y="8" width="${W - lw - 4}" height="36" rx="8" fill="#9aa3b5"/>
  <text x="14" y="31" class="sl" dominant-baseline="middle">${leftLabel}: ${leftCount}</text>
  <text x="${W - 14}" y="31" class="sl" dominant-baseline="middle" text-anchor="end">${rightLabel}: ${rightCount}</text>
</svg>`;
}

/** 전 번호 히트맵 그리드 (HTML) — 빈도에 따라 색 농도 */
export function heatGrid(freq, maxFreq, color) {
  let cells = "";
  for (let n = 1; n <= freq.length; n++) {
    const c = freq[n - 1];
    const alpha = maxFreq === 0 ? 0 : 0.12 + (c / maxFreq) * 0.78;
    cells += `<div class="heat-cell" style="background:${hexA(color, alpha)}" title="#${n}: drawn ${c} times"><span>${n}</span><small>${c}</small></div>`;
  }
  return `<div class="heat-grid">${cells}</div>`;
}

function hexA(hex, alpha) {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}

/** 게임 히어로 배너 (SVG) — 그라데이션 + 볼 모티프 */
export function heroSvg(game, subtitle) {
  const W = 1200;
  const H = 360;
  const balls = [
    { x: 950, y: 90, r: 70, o: 0.22 },
    { x: 1080, y: 220, r: 100, o: 0.16 },
    { x: 860, y: 260, r: 46, o: 0.28 },
    { x: 1040, y: 60, r: 30, o: 0.3 },
  ]
    .map(
      (b) =>
        `<circle cx="${b.x}" cy="${b.y}" r="${b.r}" fill="#ffffff" opacity="${b.o}"/>`
    )
    .join("");
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${game.name}">
  <defs>
    <linearGradient id="hg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${game.colorDark}"/>
      <stop offset="1" stop-color="${game.color}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" rx="24" fill="url(#hg)"/>
  ${balls}
  <text x="60" y="170" font-family="system-ui,sans-serif" font-size="64" font-weight="800" fill="#ffffff">${escapeXml(game.name)}</text>
  <text x="62" y="228" font-family="system-ui,sans-serif" font-size="28" font-weight="500" fill="#ffffffcc">${escapeXml(subtitle)}</text>
</svg>`;
}

function escapeXml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
