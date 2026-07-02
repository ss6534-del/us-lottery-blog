// HTML 렌더링 — 레이아웃/포스트/허브/홈/정적 페이지 템플릿.
import { SITE, GAMES, DIGEST, gameById } from "../site.config.js";
import { longDate, longDateWithDay } from "./soda.js";
import { frequencyBarChart, splitBar, heatGrid, heroSvg } from "./charts.js";

/**
 * 내부 링크 — "@@/..." 마커를 심고, layout()이 현재 페이지 깊이에 맞는
 * 상대 경로로 치환한다. 덕분에 file:// 로컬 미리보기·GitHub Pages 하위 경로·
 * 커스텀 도메인 어디서든 링크가 깨지지 않는다.
 */
export function u(path) {
  return `@@${path.startsWith("/") ? path : "/" + path}`;
}

/** 페이지 경로("/powerball/2026-07-01/") → 루트로 올라가는 상대 접두사 */
function relPrefix(pagePath) {
  const dirs = pagePath.replace(/[^/]*\.html$/, "").split("/").filter(Boolean).length;
  return dirs === 0 ? "./" : "../".repeat(dirs);
}
function abs(path) {
  return `${SITE.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : "/" + path}`;
}

export function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ── 공통 조각 ────────────────────────────────────────────────────────────────

export function ballRow(white, special, game, { small = false } = {}) {
  const cls = small ? "ball ball-sm" : "ball";
  let html = white
    .map((n) => `<span class="${cls}">${n}</span>`)
    .join("");
  if (special !== null && special !== undefined) {
    html += `<span class="${cls} ball-special" style="--bc:${game.color}" title="${esc(game.specialName || "Special")}">${special}</span>`;
  }
  return `<div class="ball-row">${html}</div>`;
}

export function appCta(leadSentence) {
  return `
<aside class="app-cta">
  <div class="app-cta-text">
    <h3>📱 Get the ${esc(SITE.appName)} App — Free</h3>
    <p>${esc(leadSentence)}</p>
    <ul>
      <li>✅ Live results &amp; instant draw alerts for all 6 NY games</li>
      <li>✅ AI number generator with hot / cold / balanced strategies</li>
      <li>✅ Automatic winning-ticket check — get notified when you win</li>
    </ul>
  </div>
  <a class="play-badge" href="${esc(SITE.appUrl)}" rel="noopener" target="_blank" aria-label="Get it on Google Play">
    <img src="${esc(SITE.playBadge)}" alt="Get it on Google Play" width="200" loading="lazy">
  </a>
</aside>`;
}

export function disclaimerBox() {
  return `
<aside class="disclaimer">
  <strong>Disclaimer:</strong> This analysis is for entertainment and informational purposes only.
  Lottery draws are random; no statistical method or AI model can predict or guarantee winning numbers.
  Never spend more than you can afford to lose. Must be 18+ (21+ in some jurisdictions) to play.
  If gambling is a problem for you, call or text the National Problem Gambling Helpline at <strong>1-800-GAMBLER</strong>.
  This site is not affiliated with or endorsed by any state lottery, MUSL, or the New York Lottery.
</aside>`;
}

// ── 레이아웃 ────────────────────────────────────────────────────────────────

export function layout({ title, description, path, content, jsonLd = null, ogType = "website" }) {
  const navGames = GAMES.filter((g) => g.mode === "post");
  const canonical = abs(path);
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${ogType}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(SITE.title)}">
<meta name="twitter:card" content="summary">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE.title)}" href="${esc(abs("/feed.xml"))}">
<link rel="icon" href="${u("/assets/favicon.svg")}" type="image/svg+xml">
<link rel="stylesheet" href="${u("/assets/style.css")}">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}
</head>
<body>
<header class="site-header">
  <div class="wrap header-inner">
    <a class="logo" href="${u("/")}">🎱 ${esc(SITE.title)}</a>
    <nav class="site-nav">
      ${navGames.map((g) => `<a href="${u(`/${g.slug}/`)}">${esc(g.name)}</a>`).join("")}
      <a href="${u(`/${DIGEST.slug}/`)}">Daily Digest</a>
      <a href="${u("/methodology/")}">Methodology</a>
    </nav>
  </div>
</header>
<main class="wrap">
${content}
</main>
<footer class="site-footer">
  <div class="wrap">
    ${disclaimerBox()}
    <nav class="footer-nav">
      <a href="${u("/about/")}">About</a>
      <a href="${u("/methodology/")}">Methodology</a>
      <a href="${u("/privacy/")}">Privacy Policy</a>
      <a href="${u("/disclaimer/")}">Full Disclaimer</a>
      <a href="${esc(SITE.appUrl)}" rel="noopener" target="_blank">Android App</a>
    </nav>
    <p class="copyright">© ${new Date().getUTCFullYear()} ${esc(SITE.title)}. Results data via NY Open Data.</p>
  </div>
</footer>
</body>
</html>`;
  return html.replaceAll("@@/", relPrefix(path));
}

// ── 포스트 본문 (빅3 개별 글) ────────────────────────────────────────────────

export function renderPostBody(post) {
  const game = gameById(post.gameId);
  const s = post.stats;
  const oddLabel = `${s.oddSplit.best} odd / ${game.whiteCount - s.oddSplit.best} even`;
  const lowLabel = `${s.lowSplit.best} low / ${game.whiteCount - s.lowSplit.best} high`;

  return `
<article class="post">
  <div class="hero">${heroSvg(game, `Predictions for ${longDate(post.targetDate)}`)}</div>
  <h1>${esc(post.title)}</h1>
  <p class="post-meta">Published ${esc(longDateWithDay(post.publishedDate))} · Auto-generated after the official draw · ${s.window}-draw analysis window</p>

  <p>${esc(post.prose.intro)}</p>

  <h2>🎯 Latest ${esc(game.name)} Results — ${esc(longDateWithDay(post.resultDate))}</h2>
  <p>${esc(post.prose.recap)}</p>
  ${ballRow(s.latest.white, s.latest.special, game)}
  ${game.specialName ? `<p class="ball-caption">The colored ball is the ${esc(game.specialName)}.</p>` : ""}

  <h2>🔥 Hot Numbers (Last ${s.window} Draws)</h2>
  <p>${esc(post.prose.hot)}</p>
  <div class="chart">${frequencyBarChart(post.hot10, s.maxFreq, game.color)}</div>
  <p><strong>Hottest right now:</strong> ${s.hot.map((h) => `<span class="chip">${h.num} <small>×${h.count}</small></span>`).join(" ")}</p>

  <h2>🧊 Cold &amp; Overdue Numbers</h2>
  <p>${esc(post.prose.cold)}</p>
  <table class="stat-table">
    <thead><tr><th>Number</th><th>Draws since last hit</th></tr></thead>
    <tbody>
      ${s.overdue.map((o) => `<tr><td><span class="chip chip-cold">${o.num}</span></td><td>${o.gap >= s.window ? `${s.window}+ (not seen in window)` : o.gap}</td></tr>`).join("")}
    </tbody>
  </table>

  <h2>📊 Pattern Analysis</h2>
  <p>${esc(post.prose.patterns)}</p>
  <div class="chart">${splitBar("Odd vs even", "Most common: " + oddLabel, s.oddSplit.pct, "other splits", 100 - s.oddSplit.pct, game.color)}</div>
  <ul class="pattern-list">
    <li><strong>Odd / even:</strong> the most common split is <strong>${oddLabel}</strong> (${s.oddSplit.pct}% of recent draws; average ${s.oddSplit.avgOdd} odd numbers per draw).</li>
    <li><strong>Low / high:</strong> numbers 1–${s.lowSplit.lowMax} vs ${s.lowSplit.lowMax + 1}–${game.whiteMax} most often land at <strong>${lowLabel}</strong> (${s.lowSplit.pct}%).</li>
    <li><strong>Sum range:</strong> recent winning lines sum between <strong>${s.sum.min} and ${s.sum.max}</strong>, with half of all draws inside <strong>${s.sum.p25}–${s.sum.p75}</strong> (average ${s.sum.avg}).</li>
    <li><strong>Consecutive pairs:</strong> at least one back-to-back pair (e.g. 23–24) appeared in <strong>${s.consecutivePct}%</strong> of recent draws.</li>
    <li><strong>Repeats:</strong> <strong>${s.repeatPct}%</strong> of draws repeated at least one number from the previous drawing.</li>
  </ul>

  <h2>🌡️ Full Number Heatmap</h2>
  <p>Every number in the ${esc(game.name)} pool, shaded by how often it hit in the last ${s.window} draws:</p>
  ${heatGrid(s.freq, s.maxFreq, game.color)}

  <h2>🤖 AI Predicted Sets for ${esc(longDate(post.targetDate))}</h2>
  <p>${esc(post.prose.predictionsLead)}</p>
  <div class="pred-grid">
    ${post.sets
      .map(
        (set, i) => `
    <div class="pred-card">
      <div class="pred-head"><span class="pred-num">Set ${i + 1}</span><span class="pred-label">${esc(set.label)}</span></div>
      ${ballRow(set.white, set.special, game)}
      <p class="pred-desc">${esc(set.description)}</p>
    </div>`
      )
      .join("")}
  </div>
  ${s.specialHot.length ? `<p><strong>${esc(game.specialName)} watch:</strong> most frequent recently — ${s.specialHot.map((x) => `<span class="chip">${x.num} <small>×${x.count}</small></span>`).join(" ")}</p>` : ""}

  <p>${esc(post.prose.outro)}</p>
  ${appCta(`The same AI engine behind these picks — in your pocket, updated the second the ${game.name} results drop.`)}

  <p class="next-draw">📅 Next ${esc(game.name)} drawing: <strong>${esc(longDateWithDay(post.targetDate))}</strong> at ${esc(game.drawTimeEt)}. Good luck!</p>
</article>`;
}

// ── 다이제스트 본문 ──────────────────────────────────────────────────────────

export function renderDigestBody(digest) {
  const sections = DIGEST.gameIds
    .filter((id) => digest.sections[id])
    .map((id) => {
      const sec = digest.sections[id];
      const game = gameById(id);
      const s = sec.stats;
      return `
  <section class="digest-section">
    <h2 style="border-color:${game.color}">${esc(game.name)} — ${esc(game.drawTimeEt)}</h2>
    <h3>Result (${esc(longDate(sec.resultDate))})</h3>
    ${ballRow(s.latest.white, s.latest.special, game)}
    <p>
      <strong>Hot:</strong> ${s.hot.slice(0, 5).map((h) => `<span class="chip">${h.num}</span>`).join(" ")}
      &nbsp;·&nbsp; <strong>Overdue:</strong> ${s.overdue.slice(0, 5).map((o) => `<span class="chip chip-cold">${o.num}</span>`).join(" ")}
    </p>
    <h3>AI picks for ${esc(longDate(sec.targetDate))}</h3>
    <div class="pred-grid pred-grid-compact">
      ${sec.sets
        .map(
          (set, i) => `
      <div class="pred-card">
        <div class="pred-head"><span class="pred-num">Set ${i + 1}</span><span class="pred-label">${esc(set.label)}</span></div>
        ${ballRow(set.white, set.special, game, { small: true })}
      </div>`
        )
        .join("")}
    </div>
  </section>`;
    })
    .join("");

  return `
<article class="post">
  <div class="hero">${heroSvg({ name: "NY Daily Digest", color: DIGEST.color, colorDark: DIGEST.colorDark }, `Take 5 & Millionaire for Life — ${longDate(digest.date)}`)}</div>
  <h1>${esc(digest.title)}</h1>
  <p class="post-meta">Published ${esc(longDateWithDay(digest.date))} · Auto-updated as each drawing comes in</p>
  <p>${esc(digest.intro)}</p>
  ${sections}
  ${appCta("Daily games move fast — twice-a-day Take 5 plus a nightly Millionaire for Life draw. Let the app track them all for you.")}
</article>`;
}

// ── 목록 카드 ────────────────────────────────────────────────────────────────

export function postCard(item) {
  const color = item.color;
  return `
<a class="card" href="${u(item.path)}">
  <span class="card-tag" style="background:${color}">${esc(item.gameName)}</span>
  <h3>${esc(item.title)}</h3>
  <p>${esc(item.excerpt)}</p>
  <span class="card-date">${esc(longDate(item.sortDate))}</span>
</a>`;
}
