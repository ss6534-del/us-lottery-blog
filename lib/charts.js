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

// ── 고급 분석 렌더 조각 (회귀·밴드·백테스트·미출 격자) ─────────────────────────

/** "does it beat random?" 리프트 표. rows: [{band|label, avgSize|poolSize, act, exp, lift}] */
export function liftTable(rows, labelFor, note = "") {
  if (!rows || !rows.length) return "";
  const th = 'style="padding:5px 9px;text-align:right;color:var(--muted);font-weight:700"';
  const td = 'style="padding:5px 9px;text-align:right"';
  const body = rows
    .map((r) => {
      const col = r.lift >= 1.12 ? "#0f7b3a" : r.lift <= 0.88 ? "#c0322b" : "var(--muted)";
      return `<tr>
      <td style="padding:5px 9px;font-weight:700">${labelFor(r)}</td>
      <td ${td}><span style="color:var(--muted)">${r.avgSize != null ? r.avgSize : r.poolSize != null ? r.poolSize : "—"}</span></td>
      <td ${td}><b>${r.act}</b></td>
      <td ${td}><span style="color:var(--muted)">${r.exp}</span></td>
      <td style="padding:5px 9px;text-align:right;font-weight:800;color:${col}">×${r.lift.toFixed(2)}</td>
    </tr>`;
    })
    .join("");
  return `<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:var(--t-sm)">
    <thead><tr><th style="padding:5px 9px;text-align:left;color:var(--muted);font-weight:700">Band</th>
    <th ${th}>Pool</th><th ${th}>Actual</th><th ${th}>Random</th><th ${th}>Lift</th></tr></thead>
    <tbody>${body}</tbody></table></div>${note ? `<p class="score-foot">${note}</p>` : ""}`;
}

/** 밴드 → 번호 칩 리스트 (사카이·미출). bands: [{label, nums:[n]|[{num,gap}]}] */
export function bandChips(bands, showGap = false) {
  return bands
    .map((b) => {
      const chips = b.nums
        .map((x) => {
          const num = typeof x === "number" ? x : x.num;
          const gap = typeof x === "object" ? x.gap : null;
          return `<span class="ball s">${num}${showGap && gap != null && gap >= 10 ? `<sub style="font-size:9px;opacity:.7">${gap}</sub>` : ""}</span>`;
        })
        .join("");
      return `<div style="display:flex;gap:10px;align-items:flex-start;padding:6px 0;border-top:1.5px dashed var(--ink-hairline)">
      <b class="num" style="min-width:96px;flex:0 0 auto">${b.label}</b>
      <div class="ball-row" style="flex-wrap:wrap;gap:4px">${chips}</div></div>`;
    })
    .join("");
}

const RANGE_TINT = ["#FFE08A", "#9CD0F5", "#FF9E9E", "#C9CDD6", "#A7E29A"];
function rangeColor(n) {
  return RANGE_TINT[Math.min(4, Math.floor((n - 1) / 10))];
}

/** 미출 격자 — whiteCount 칸(크기 순서), 재출현 번호는 빈칸. grid: [{ago,has,cells[]}] */
export function lastSeenGrid(grid, whiteCount) {
  const ORD = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"];
  const cell = "border:1px solid var(--ink-hairline);height:26px;text-align:center;font-weight:700;padding:0 2px";
  let head = `<th style="${cell};background:var(--wash-life);padding:0 8px">Draws ago</th>`;
  for (let i = 0; i < whiteCount; i++) head += `<th style="${cell};background:var(--wash-life);width:38px">${ORD[i]}</th>`;
  const rows = grid
    .map((r) => {
      const cells = r.cells
        .map((c) =>
          c == null
            ? `<td style="${cell};background:#fff"></td>`
            : `<td style="${cell};background:${rangeColor(c)}">${c}</td>`
        )
        .join("");
      const ago = r.has
        ? `<td style="${cell};background:#FFF6DA;color:#8a6d00;white-space:nowrap;padding:0 8px">${r.ago} ago</td>`
        : `<td style="${cell};background:#fafafa"></td>`;
      return `<tr>${ago}${cells}</tr>`;
    })
    .join("");
  return `<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:var(--t-sm)"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}
