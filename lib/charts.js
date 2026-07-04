// Lucky Sketch 그래픽 조각들 — 손그림 SVG(도들·웨블 필터)와 크레용 차트 HTML.
// 데이터 차트는 AI 이미지가 아니라 코드 생성 (정확성 보장).

/** 손그림 웨블 필터 정의 — 페이지당 1회 <body> 최상단에 삽입 */
export function wobbleDefs() {
  return `<svg width="0" height="0" aria-hidden="true" style="position:absolute">
  <defs>
    <filter id="ls-wobble" x="-5%" y="-5%" width="110%" height="110%">
      <feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="7" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="2.4"/>
    </filter>
    <filter id="ls-wobble-lg" x="-6%" y="-6%" width="112%" height="112%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="4" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3.4"/>
    </filter>
  </defs>
</svg>`;
}

/** 손그림 도들: star / sparkle / squiggle / clover / arrow */
export function doodle(kind = "star", size = 22, color = "var(--ink)", attrs = "") {
  const s = `stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const open = (vb = "0 0 24 24") =>
    `<svg width="${size}" height="${size}" viewBox="${vb}" fill="none" aria-hidden="true" ${attrs}>`;
  if (kind === "star") {
    return `${open()}<path d="M12 3.2c.5 3.4 2 5.3 5.4 5.9-3.3.9-4.8 2.7-5.4 6-.6-3.3-2-5.1-5.4-6 3.3-.7 4.9-2.5 5.4-5.9Z" ${s}/></svg>`;
  }
  if (kind === "sparkle") {
    return `${open()}<path d="M9 3.5c.3 2.1 1.2 3.2 3.3 3.6-2 .5-3 1.6-3.3 3.7-.3-2-1.2-3.2-3.3-3.7 2-.4 3-1.5 3.3-3.6Z" ${s}/><path d="M17 12c.2 1.4.8 2.1 2.2 2.4-1.4.4-2 1.1-2.2 2.5-.2-1.4-.8-2.1-2.2-2.5 1.4-.3 2-1 2.2-2.4Z" ${s}/></svg>`;
  }
  if (kind === "squiggle") {
    return `${open("0 0 40 12")}<path d="M1 7c3-5 6 5 9 0s6 5 9 0 6 5 9 0 6-4 9-2" ${s}/></svg>`;
  }
  if (kind === "clover") {
    return `${open()}<path d="M12 12c-1.6-2.6-5.8-2-5.6 1 .1 1.8 2 2.6 3.7 2.2M12 12c1.6-2.6 5.8-2 5.6 1-.1 1.8-2 2.6-3.7 2.2M12 12c-2.6 1.6-2 5.8 1 5.6M12 12c2.6 1.6 2 5.8-1 5.6M12 15.5V21" ${s}/></svg>`;
  }
  return `${open("0 0 40 24")}<path d="M2 14c8 4 22 4 33-6M27 2c4 1 7 3 8 6-3 1-6 1-9-1" ${s}/></svg>`;
}

/** 노란 로고 별 (채워진 star) */
export function logoStar(size = 30) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" style="filter:url(#ls-wobble)"><path d="M12 3.2c.5 3.4 2 5.3 5.4 5.9-3.3.9-4.8 2.7-5.4 6-.6-3.3-2-5.1-5.4-6 3.3-.7 4.9-2.5 5.4-5.9Z" fill="var(--accent)" stroke="var(--ink)" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

/** 스페셜 볼 위 노란 별 장식 */
export function ballSpark() {
  return `<svg class="spk" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c.5 3 1.8 4.6 4.8 5.2-2.9.8-4.3 2.4-4.8 5.3-.5-2.9-1.8-4.5-4.8-5.3 2.9-.6 4.3-2.2 4.8-5.2Z" fill="var(--accent)" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

/** 도들 시계 (카운트다운 타일) */
export function clockDoodle(colorVar) {
  return `<svg width="30" height="30" viewBox="0 0 24 24" aria-hidden="true" style="filter:url(#ls-wobble)">
  <circle cx="12" cy="13" r="8.4" fill="none" stroke="var(--ink)" stroke-width="2"/>
  <circle cx="12" cy="13" r="8.4" fill="${colorVar}" opacity="0.5"/>
  <path d="M12 8.5V13l3 2" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M9 3.5c1-.9 5-.9 6 0" fill="none" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>
</svg>`;
}

/** 손그림 폰 일러스트 (설치 패널) */
export function phoneDoodle() {
  return `<svg width="150" height="230" viewBox="0 0 150 230" aria-hidden="true" style="filter:url(#ls-wobble-lg);flex:0 0 auto">
  <rect x="18" y="8" width="114" height="214" rx="22" fill="#fff" stroke="var(--ink)" stroke-width="3"/>
  <rect x="28" y="20" width="94" height="190" rx="12" fill="var(--wash-mega)" stroke="var(--ink)" stroke-width="1.5"/>
  <line x1="60" y1="15" x2="90" y2="15" stroke="var(--ink)" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="47" cy="70" r="13" fill="var(--game-powerball)" stroke="var(--ink)" stroke-width="2"/>
  <circle cx="75" cy="70" r="13" fill="var(--game-nylotto)" stroke="var(--ink)" stroke-width="2"/>
  <circle cx="103" cy="70" r="13" fill="var(--game-take5)" stroke="var(--ink)" stroke-width="2"/>
  <rect x="40" y="100" width="70" height="12" rx="6" fill="#fff" stroke="var(--ink)" stroke-width="1.5"/>
  <rect x="40" y="122" width="55" height="10" rx="5" fill="#fff" stroke="var(--ink)" stroke-width="1.5"/>
  <rect x="40" y="165" width="70" height="26" rx="13" fill="var(--accent)" stroke="var(--ink)" stroke-width="2.5"/>
</svg>`;
}

/**
 * 크레용 질감 막대 차트 (게임 컬러).
 * entries: [{label, value}] — 최댓값 기준 비율 높이.
 */
export function crayonBars(entries, unit = "×") {
  const max = Math.max(...entries.map((d) => d.value), 1);
  const cols = entries
    .map(
      (d) => `
    <div class="col">
      <span class="val">${d.value}${unit}</span>
      <span class="cbar" style="height:${Math.max(6, Math.round((d.value / max) * 100))}%"></span>
      <span class="lbl">${d.label}</span>
    </div>`
    )
    .join("");
  return `<div class="crayon-bars">${cols}</div>`;
}

/** 전 번호 히트맵 — 파스텔 게임 컬러 농도 */
export function heatGrid(freq, maxFreq, pastelHex) {
  let cells = "";
  for (let n = 1; n <= freq.length; n++) {
    const c = freq[n - 1];
    const alpha = maxFreq === 0 ? 0.08 : 0.1 + (c / maxFreq) * 0.85;
    cells += `<div class="heat-cell" style="background:${hexA(pastelHex, alpha)}" title="#${n}: drawn ${c} times"><span>${n}</span><small>${c}</small></div>`;
  }
  return `<div class="heat-grid">${cells}</div>`;
}

/** 손그림 스파크라인 — 합계 트렌드 등 시계열 (values: 과거→최근) */
export function sparkline(values, colorVar) {
  if (values.length < 2) return "";
  const W = 560, H = 130, p = 14;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const px = (i) => p + (i * (W - 2 * p)) / (values.length - 1);
  const py = (v) => H - p - ((v - min) * (H - 2 * p)) / span;
  const pts = values.map((v, i) => `${px(i)},${py(v)}`).join(" ");
  const lastX = px(values.length - 1), lastY = py(values[values.length - 1]);
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Trend line" style="width:100%;height:auto;display:block">
  <line x1="${p}" y1="${H - p}" x2="${W - p}" y2="${H - p}" stroke="var(--ink-hairline)" stroke-width="2" stroke-dasharray="6 6"/>
  <polyline points="${pts}" fill="none" stroke="${colorVar}" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" style="filter:url(#ls-wobble)"/>
  <circle cx="${lastX}" cy="${lastY}" r="7" fill="${colorVar}" stroke="var(--ink)" stroke-width="2"/>
</svg>`;
}

function hexA(hex, alpha) {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${hex}${a}`;
}
