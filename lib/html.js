// Lucky Sketch 디자인 시스템 기반 HTML 렌더링.
// 디자인 핸드오프(lucky-sketch-design-system)의 토큰·컴포넌트를 그대로 이식.
import { SITE, GAMES, DIGEST, gameById } from "../site.config.js";
import { longDate, longDateWithDay } from "./soda.js";
import {
  wobbleDefs, doodle, logoStar, ballSpark, clockDoodle, phoneDoodle,
  crayonBars, heatGrid, sparkline,
  liftTable, bandChips, lastSeenGrid,
} from "./charts.js";
import { GAP_BAND_LABEL } from "./stats.js";
import { OG_W, OG_H } from "./og.js";

/**
 * 글 상단 리드 이미지 — LCP 후보라 lazy 없이 fetchpriority=high.
 * width/height를 명시해 이미지 로드 전에도 자리가 잡히게 한다(CLS 방지).
 * 장식용이라 alt는 빈 문자열(스크린리더가 건너뛴다).
 */
export function leadImage(ogImageFile) {
  if (!ogImageFile) return "";
  return `<figure class="lead-img"><img src="${u(`/og/${ogImageFile}`)}" alt="" width="${OG_W}" height="${OG_H}" fetchpriority="high" decoding="async"></figure>`;
}

// ── 게임 id → 디자인 시스템 게임 키 매핑 ──────────────────────────────────
const CSS_GAME = {
  powerball: "powerball",
  mega: "mega",
  nylotto: "nylotto",
  take5_mid: "take5",
  take5_eve: "take5",
  millionaire: "life",
};
const PASTEL_HEX = {
  powerball: "#FF8FA3", mega: "#8EB8FF", nylotto: "#8FDDB2",
  take5: "#C5A8F2", life: "#8FD8D2",
};
export function gameKey(gameId) {
  return CSS_GAME[gameId] || "powerball";
}
/** 게임 컬러 CSS 변수 묶음 (인라인 style용) */
function gv(key) {
  return `--gc:var(--game-${key});--gw:var(--wash-${key});--gon:var(--on-${key})`;
}

export function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// ── 드로어 메뉴 카운트 (build.js가 렌더링 전에 주입) ─────────────────────────
let NAV_COUNTS = { games: {}, digests: 0, recaps: 0, analysis: 0 };
export function setNavCounts(counts) {
  NAV_COUNTS = counts;
}

const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
/** "2026-07-03" → "Jul 3" */
export function shortDate(dateStr) {
  const [, m, d] = dateStr.split("-").map(Number);
  return `${MONTHS_SHORT[m - 1]} ${d}`;
}

/** 내부 링크 — "@@/..." 마커를 layout()이 페이지 깊이에 맞는 상대 경로로 치환 */
export function u(path) {
  return `@@${path.startsWith("/") ? path : "/" + path}`;
}
function relPrefix(pagePath) {
  const dirs = pagePath.replace(/[^/]*\.html$/, "").split("/").filter(Boolean).length;
  return dirs === 0 ? "./" : "../".repeat(dirs);
}
function abs(path) {
  return `${SITE.baseUrl.replace(/\/$/, "")}${path.startsWith("/") ? path : "/" + path}`;
}

/** Play 스토어 링크 + 설치 추적 파라미터 (Play Console 캠페인 리포트용) */
export function appLink(utmContent = "cta") {
  const referrer = encodeURIComponent(
    `utm_source=ssgpost&utm_medium=web&utm_campaign=blog&utm_content=${utmContent}`
  );
  return `${SITE.appUrl}&referrer=${referrer}`;
}

// ── 공통 조각 ────────────────────────────────────────────────────────────────

export function ballRow(white, special, key, size = "m") {
  const cls = size === "m" ? "ball" : `ball ${size}`;
  let html = white.map((n) => `<span class="${cls}">${n}</span>`).join("");
  if (special !== null && special !== undefined) {
    html += `<span class="${cls} special" style="${gv(key)}">${special}${ballSpark()}</span>`;
  }
  return `<div class="ball-row">${html}</div>`;
}

export function ctaButton(text, size = "", utm = "cta") {
  const cls = `btn-cta${size ? " " + size : ""}`;
  return `<a class="${cls}" href="${esc(appLink(utm))}" rel="noopener" target="_blank">${esc(text)}</a>`;
}

export function playBadge(utm = "badge") {
  return `<a class="play-badge" href="${esc(appLink(utm))}" rel="noopener" target="_blank" aria-label="Get it on Google Play">
    <img src="${esc(SITE.playBadge)}" alt="Get it on Google Play" width="165" loading="lazy"></a>`;
}

export function sticker(text, rot = -4) {
  return `<span class="sticker" style="--rot:${rot}deg">${text}</span>`;
}

export function gameTag(key, label) {
  return `<span class="game-tag" style="${gv(key)}">${esc(label)}</span>`;
}

export function sectionHead(title, note = "") {
  return `<div class="sec-head">${doodle("star", 24)}<h2>${esc(title)}</h2>${note ? `<span class="mut">${esc(note)}</span>` : ""}</div>`;
}

/** 포스트잇 인라인 CTA */
export function stickyNote(
  title = "Want tonight's AI picks first?",
  body = "Get instant predictions the moment each drawing closes.",
  cta = "Install the app"
) {
  return `
<div class="note-wrap">
  <div class="tape"></div>
  <div class="note"><div class="note-inner">
    <div class="nt">
      <div class="nt-head">${doodle("star", 20)}<h3>${esc(title)}</h3></div>
      <p>${esc(body)}</p>
    </div>
    ${ctaButton(cta, "", "note")}
  </div></div>
</div>`;
}

/** 하단 대형 설치 패널 */
export function installPanel(
  title = "Never miss a lucky number.",
  body = `${SITE.appName} posts fresh predictions seconds after every New York drawing. Carry them in your pocket.`
) {
  return `
<div class="install-panel">
  <span class="doodle-tr">${doodle("sparkle", 44)}</span>
  <div class="install-inner">
    ${phoneDoodle()}
    <div class="it">
      <h2>${esc(title)}</h2>
      <p>${esc(body)}</p>
      <div class="install-actions">
        ${ctaButton("Get the free app", "lg", "panel")}
        ${playBadge("panel-badge")}
      </div>
    </div>
  </div>
</div>`;
}

/** 카운트다운 타일 — data-draw 스케줄로 클라이언트 JS가 실시간 계산 */
export function countdownTile(game, label = "until next draw") {
  const key = gameKey(game.id);
  const sched = JSON.stringify({ d: game.drawWeekdays, h: game.drawHour, m: game.drawMinute });
  return `
<div class="cd-tile" style="${gv(key)}" data-draw='${sched}'>
  <div class="cd-g">${clockDoodle(`var(--game-${key})`)}<span>${esc(game.name)}</span></div>
  <div class="cd-cells num">
    <span class="cd-cell cd-h">--</span><span class="cd-colon">:</span>
    <span class="cd-cell cd-m">--</span><span class="cd-colon">:</span>
    <span class="cd-cell cd-s">--</span>
  </div>
  <span class="cd-label">${esc(label)}</span>
</div>`;
}

/** Quick Pick 생성기 위젯 — 웹은 순수 랜덤만, 전략은 앱 잠금 (전환 퍼널) */
export function generatorWidget(gameOrNull = null) {
  const opts = gameOrNull
    ? [gameOrNull]
    : ["powerball", "mega", "nylotto", "take5_eve", "millionaire"].map(gameById);
  const rules = (g) =>
    esc(JSON.stringify({ c: g.whiteCount, max: g.whiteMax, smax: g.specialMax, sname: g.specialName }));
  const chipLabel = (g) => (g.id === "take5_eve" ? "Take 5" : g.name);
  const first = opts[0];
  const key0 = gameKey(first.id);
  const chips = gameOrNull
    ? ""
    : `<div class="gen-games">${opts
        .map(
          (g, i) =>
            `<button type="button" class="game-chip${i === 0 ? " on" : ""}" data-key="${gameKey(g.id)}" data-rules="${rules(g)}">${esc(chipLabel(g))}</button>`
        )
        .join("")}</div>`;
  return `
<div class="sketch-card gen-card" data-gen data-rules="${rules(first)}" style="${gv(key0)}">
  <div class="ph">${doodle("sparkle", 22)}<h3>Try a quick pick${gameOrNull ? ` — ${esc(first.name)}` : ""}</h3></div>
  <p class="gen-sub">Pure random, right in your browser. No sign-up.</p>
  ${chips}
  <button type="button" class="btn-ink gen-go">${doodle("star", 18, "#fff")} Generate my lucky numbers</button>
  <div class="gen-result" aria-live="polite"></div>
  <button type="button" class="btn-ghost gen-copy" style="display:none">Copy numbers</button>
  <div class="lock-list">
    <strong>Quick Pick is just the start.</strong> The app adds four AI strategies:
    <ul><li>🔒 Hot Streak</li><li>🔒 Balanced Mix</li><li>🔒 Overdue Watch</li><li>🔒 Pattern Play</li></ul>
  </div>
  ${ctaButton("Unlock strategy picks — free", "", "generator")}
</div>`;
}

/** 티켓 체커 — 최신 회차와 대조 (클라이언트 JS) */
export function ticketChecker(game, latest, heading = "Did your ticket win?") {
  const key = gameKey(game.id);
  const cfg = esc(
    JSON.stringify({
      white: latest.white,
      special: latest.special,
      sname: game.specialName,
      max: game.whiteMax,
      smax: game.specialMax,
    })
  );
  const inputs =
    latest.white
      .map((_, i) => `<input inputmode="numeric" maxlength="2" aria-label="Number ${i + 1}">`)
      .join("") +
    (game.specialMax > 0
      ? `<input class="sp" inputmode="numeric" maxlength="2" aria-label="${esc(game.specialName)}">`
      : "");
  return `
${sectionHead(heading)}
<div class="sketch-card" data-check="${cfg}" style="${gv(key)}">
  <p style="margin:0">Enter your ${esc(game.name)} numbers and check them against the ${esc(longDate(latest.date))} drawing:</p>
  <div class="chk-inputs">${inputs}</div>
  <button type="button" class="btn-ink chk-go">Check my ticket</button>
  <div class="chk-result" aria-live="polite"></div>
  <p class="chk-note">The app checks your saved tickets automatically after every draw — and pings you when you win.</p>
  ${ctaButton("Get auto win alerts — free", "sm", "checker")}
</div>`;
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

/** 글 카드 (스케치북 썸네일: 게임 워시 + 실제 당첨번호 공 + 스티커) */
export function postCard(item) {
  const key = item.gameKey;
  return `
<a class="a-card" href="${u(item.path)}">
  <div class="a-thumb" style="${gv(key)}">
    <span class="doodle-tr">${doodle("sparkle", 28, `var(--on-${key})`)}</span>
    <span class="hand-tag" style="${gv(key)}">${esc(item.dateLabel)}</span>
    ${ballRow(item.numbers, item.special, key, "s")}
    <span class="sticker">${esc(item.stickerText || "★ AI Picks Inside")}</span>
  </div>
  <div class="a-body">
    <div class="a-meta" style="${gv(key)}">
      <span class="gdot"></span>
      <span class="gname">${esc(item.gameName)}</span>
      <span class="mut">· ${esc(item.metaText)}</span>
    </div>
    <h3>${esc(item.title)}</h3>
  </div>
</a>`;
}

/** 사이드 드로어 메뉴 — 블로그 전체 카테고리 지도 */
function drawer() {
  const navGames = GAMES.filter((g) => g.mode === "post");
  const cnt = (n) => (n ? `<span class="cnt num">${n}</span>` : "");
  const gameLinks = navGames
    .map(
      (g) =>
        `<a href="${u(`/${g.slug}/`)}" style="${`--gc:var(--game-${gameKey(g.id)});--gw:var(--wash-${gameKey(g.id)})`}"><span class="gdot"></span>${esc(g.name)}${cnt(NAV_COUNTS.games[g.slug])}</a>`
    )
    .join("");
  return `
<div class="drawer-overlay" id="drawer-overlay"></div>
<aside class="drawer" id="drawer" aria-hidden="true" aria-label="Site menu">
  <div class="drawer-head">${logoStar(24)} Menu <button class="dw-x" aria-label="Close menu">✕</button></div>
  <nav>
    <a href="${u("/")}">${doodle("star", 16)} Home</a>
    <div class="d-sec">Games</div>
    ${gameLinks}
    <a href="${u(`/${DIGEST.slug}/`)}" style="--gc:var(--game-take5);--gw:var(--wash-take5)"><span class="gdot"></span>Daily Digest — Take 5 · Millionaire${cnt(NAV_COUNTS.digests)}</a>
    <div class="d-sec">Archives</div>
    <a href="${u("/recaps/")}">${doodle("sparkle", 16)} Monthly recaps${cnt(NAV_COUNTS.recaps)}</a>
    <a href="${u("/analysis/")}">${doodle("arrow", 18)} Weekly deep analysis${cnt(NAV_COUNTS.analysis)}</a>
    <div class="d-sec">Free tools</div>
    <a href="${u("/generator/")}">${doodle("clover", 16)} Lucky number generator</a>
    <a href="${u("/checker/")}">${doodle("squiggle", 16)} Ticket checker — did I win?</a>
    <div class="d-sec">About</div>
    <a href="${u("/about/")}">About this site</a>
    <a href="${u("/methodology/")}">How the AI works</a>
    <a href="${u("/privacy/")}">Privacy policy</a>
    <a href="${u("/disclaimer/")}">Full disclaimer</a>
  </nav>
  <div class="drawer-cta">
    ${ctaButton("Get the free app", "sm", "drawer")}
    <p>AI picks · win alerts · auto ticket check</p>
  </div>
</aside>`;
}

// ── 레이아웃 ────────────────────────────────────────────────────────────────

export function layout({ title, description, path, content, jsonLd = null, ogType = "website", ogImageFile = null, ads = true }) {
  const navGames = GAMES.filter((g) => g.mode === "post");
  const canonical = abs(path);
  // AdSense 스니펫. async라 렌더를 막지 않는다 — 광고가 안 떠도 본문은 그대로 나온다.
  // ads:false 인 페이지(404 등 게시자 콘텐츠가 없는 화면)에는 넣지 않는다.
  const adsenseTag =
    ads && SITE.adsenseClient
      ? `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(SITE.adsenseClient)}" crossorigin="anonymous"></script>`
      : "";
  // og:image는 절대 URL이어야 한다(스크래퍼는 상대 경로를 못 푼다).
  const ogImageTags = ogImageFile
    ? `<meta property="og:image" content="${esc(abs(`/og/${ogImageFile}`))}">
<meta property="og:image:width" content="${OG_W}">
<meta property="og:image:height" content="${OG_H}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${esc(abs(`/og/${ogImageFile}`))}">`
    : `<meta name="twitter:card" content="summary">`;
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${SITE.googleSiteVerification ? `<meta name="google-site-verification" content="${esc(SITE.googleSiteVerification)}">` : ""}
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="${ogType}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(SITE.title)}">
${ogImageTags}
<link rel="alternate" type="application/rss+xml" title="${esc(SITE.title)}" href="${esc(abs("/feed.xml"))}">
<link rel="icon" href="${u("/assets/favicon.svg")}" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@400;500;600;700&family=Caveat:wght@500;600;700&family=Nunito:ital,wght@0,400;0,600;0,700;0,800;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${u("/assets/style.css")}">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>` : ""}
${adsenseTag}
</head>
<body>
${wobbleDefs()}
${drawer()}
<header class="site-header">
  <div class="header-inner">
    <button class="menu-btn" id="menu-btn" aria-label="Open menu" aria-controls="drawer" aria-expanded="false"><i></i><i></i><i></i></button>
    <a class="logo" href="${u("/")}">${logoStar(30)} ${esc(SITE.title)}</a>
    <nav class="site-nav">
      ${navGames.map((g) => `<a href="${u(`/${g.slug}/`)}">${esc(g.name)}</a>`).join("")}
      <a href="${u(`/${DIGEST.slug}/`)}">Daily Digest</a>
      <a href="${u("/methodology/")}">How it works</a>
    </nav>
    <div class="header-cta">${ctaButton("Get the app", "sm", "header")}</div>
  </div>
</header>
<main>
${content}
</main>
<footer class="site-footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <div class="fb-name">${logoStar(22)} ${esc(SITE.title)}</div>
      <p>AI-drawn lottery analysis for New York players. For entertainment only — play responsibly. 21+.</p>
    </div>
    ${playBadge("footer")}
    <nav class="footer-nav">
      <a href="${u("/about/")}">About</a>
      <a href="${u("/methodology/")}">Methodology</a>
      <a href="${u("/privacy/")}">Privacy Policy</a>
      <a href="${u("/disclaimer/")}">Full Disclaimer</a>
      <a href="${esc(appLink("footer-link"))}" rel="noopener" target="_blank">Android App</a>
    </nav>
    ${disclaimerBox()}
    <p class="copyright">© ${new Date().getUTCFullYear()} ${esc(SITE.title)}. Results data via NY Open Data.</p>
  </div>
</footer>
<div class="sticky-bar" id="sticky-bar">
  <div class="sb-icon">${doodle("clover", 26)}</div>
  <div class="sb-tx"><b>${esc(SITE.appName)}</b><small>Free · AI picks after every draw</small></div>
  ${ctaButton("Install", "sm", "stickybar")}
  <button class="sb-x" aria-label="Dismiss">✕</button>
</div>
<script>
(function(){
  var SPARK = '<svg class="spk" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5c.5 3 1.8 4.6 4.8 5.2-2.9.8-4.3 2.4-4.8 5.3-.5-2.9-1.8-4.5-4.8-5.3 2.9-.6 4.3-2.2 4.8-5.2Z" fill="var(--accent)" stroke="var(--ink)" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  function toast(msg){
    var t = document.getElementById("ls-toast");
    if (!t) { t = document.createElement("div"); t.id = "ls-toast"; t.className = "toast"; document.body.appendChild(t); }
    t.textContent = msg; t.classList.add("show");
    clearTimeout(t._h); t._h = setTimeout(function(){ t.classList.remove("show"); }, 2800);
  }

  // ── 카운트다운 (ET 기준 다음 추첨 시각) ──
  var tiles = document.querySelectorAll("[data-draw]");
  if (tiles.length) {
    var nyNow = function(){ return new Date(new Date().toLocaleString("en-US", {timeZone: "America/New_York"})); };
    var nextDraw = function(sc){
      var now = nyNow();
      for (var i = 0; i < 8; i++) {
        var c = new Date(now); c.setDate(now.getDate() + i); c.setHours(sc.h, sc.m, 0, 0);
        var wd = ((c.getDay() + 6) % 7) + 1;
        if (sc.d.indexOf(wd) >= 0 && c > now) return c;
      }
      return now;
    };
    var pad = function(n){ return String(n).padStart(2, "0"); };
    var tick = function(){
      var now = nyNow();
      tiles.forEach(function(t){
        var sc = JSON.parse(t.getAttribute("data-draw"));
        var s = Math.max(0, Math.floor((nextDraw(sc) - now) / 1000));
        t.querySelector(".cd-h").textContent = pad(Math.floor(s / 3600));
        t.querySelector(".cd-m").textContent = pad(Math.floor(s % 3600 / 60));
        t.querySelector(".cd-s").textContent = pad(s % 60);
      });
    };
    tick(); setInterval(tick, 1000);
  }

  // ── Quick Pick 생성기 ──
  document.querySelectorAll("[data-gen]").forEach(function(w){
    var btn = w.querySelector(".gen-go"), out = w.querySelector(".gen-result"),
        copy = w.querySelector(".gen-copy"), last = null;
    w.querySelectorAll(".game-chip").forEach(function(ch){
      ch.addEventListener("click", function(){
        w.querySelectorAll(".game-chip").forEach(function(c){ c.classList.remove("on"); });
        ch.classList.add("on");
        w.setAttribute("data-rules", ch.getAttribute("data-rules"));
        var k = ch.getAttribute("data-key");
        w.style.setProperty("--gc", "var(--game-" + k + ")");
        w.style.setProperty("--gw", "var(--wash-" + k + ")");
        w.style.setProperty("--gon", "var(--on-" + k + ")");
        out.innerHTML = ""; copy.style.display = "none"; last = null;
      });
    });
    btn.addEventListener("click", function(){
      var r = JSON.parse(w.getAttribute("data-rules"));
      var set = {}; var nums = [];
      while (nums.length < r.c) {
        var n = 1 + Math.floor(Math.random() * r.max);
        if (!set[n]) { set[n] = 1; nums.push(n); }
      }
      nums.sort(function(a, b){ return a - b; });
      var sp = r.smax > 0 ? 1 + Math.floor(Math.random() * r.smax) : null;
      last = { nums: nums, sp: sp, sname: r.sname };
      var html = nums.map(function(n, i){
        return '<span class="ball pop" style="animation-delay:' + (i * 90) + 'ms">' + n + '</span>';
      }).join("");
      if (sp != null) {
        html += '<span class="ball special pop" style="animation-delay:' + (nums.length * 90) + 'ms">' + sp + SPARK + '</span>';
      }
      out.innerHTML = '<span class="qp-label">Quick Pick · pure random</span><div class="ball-row">' + html + '</div>';
      copy.style.display = "";
    });
    copy.addEventListener("click", function(){
      if (!last) return;
      var txt = last.nums.join(" ") + (last.sp != null ? " + " + (last.sname || "Special") + " " + last.sp : "");
      try { navigator.clipboard.writeText(txt); } catch (e) {}
      toast("Copied! Tip: the app checks your saved numbers automatically after every draw.");
    });
  });

  // ── 티켓 체커 ──
  document.querySelectorAll("[data-check]").forEach(function(w){
    var cfg = JSON.parse(w.getAttribute("data-check"));
    var btn = w.querySelector(".chk-go"), out = w.querySelector(".chk-result");
    btn.addEventListener("click", function(){
      var whites = [], sp = null, bad = false;
      w.querySelectorAll(".chk-inputs input").forEach(function(inp){
        var v = parseInt(inp.value, 10);
        if (inp.classList.contains("sp")) {
          sp = v; if (!(v >= 1 && v <= cfg.smax)) bad = true;
        } else {
          whites.push(v); if (!(v >= 1 && v <= cfg.max)) bad = true;
        }
      });
      var uniq = {}; whites.forEach(function(n){ uniq[n] = 1; });
      if (bad || whites.some(isNaN) || Object.keys(uniq).length !== whites.length) {
        out.innerHTML = '<p style="color:var(--muted);margin:0">Please enter ' + cfg.white.length +
          ' different numbers from 1–' + cfg.max +
          (cfg.smax ? ' (special: 1–' + cfg.smax + ')' : '') + '.</p>';
        return;
      }
      var drawn = {}; cfg.white.forEach(function(n){ drawn[n] = 1; });
      var m = whites.filter(function(n){ return drawn[n]; }).length;
      var sHit = cfg.smax > 0 && sp === cfg.special;
      var balls = whites.sort(function(a,b){ return a - b; }).map(function(n){
        return '<span class="ball ' + (drawn[n] ? 'hit' : 'miss') + '">' + n + '</span>';
      }).join("");
      if (cfg.smax > 0 && sp != null) {
        balls += '<span class="ball special' + (sHit ? '' : ' miss') + '">' + sp + SPARK + '</span>';
      }
      var msg = 'You matched <strong>' + m + ' of ' + cfg.white.length + '</strong> numbers' +
        (sHit ? ' — plus the ' + cfg.sname + '!' : '.');
      out.innerHTML = '<div class="ball-row">' + balls + '</div>' +
        '<p style="margin:10px 0 0">' + msg +
        ' <span style="color:var(--muted)">Always verify with the official lottery before acting.</span></p>';
    });
  });

  // ── Line Lab (라인 백테스트 + 패턴 채점) ──
  document.querySelectorAll("[data-linelab]").forEach(function(w){
    var cfg = JSON.parse(w.getAttribute("data-linelab"));
    var go = w.querySelector(".ll-go"), rand = w.querySelector(".ll-rand"), out = w.querySelector(".ll-result");
    var inputs = w.querySelectorAll(".chk-inputs input");
    function readLine(){
      var nums = [], bad = false, seen = {};
      inputs.forEach(function(inp){
        var v = parseInt(inp.value, 10);
        nums.push(v);
        if (!(v >= 1 && v <= cfg.max) || seen[v]) bad = true;
        seen[v] = 1;
      });
      return (bad || nums.some(isNaN)) ? null : nums;
    }
    function render(line){
      line = line.slice().sort(function(a, b){ return a - b; });
      var set = {}; line.forEach(function(n){ set[n] = 1; });
      var best = 0, three = 0, four = 0;
      (cfg.draws || []).forEach(function(d){
        var m = 0; for (var i = 0; i < d.length; i++) if (set[d[i]]) m++;
        if (m > best) best = m; if (m >= 3) three++; if (m >= 4) four++;
      });
      var sum = line.reduce(function(a, b){ return a + b; }, 0);
      var odd = line.filter(function(n){ return n % 2; }).length;
      var low = line.filter(function(n){ return n <= cfg.lowMax; }).length;
      var cal = line.filter(function(n){ return n <= cfg.cal; }).length;
      var checks = [];
      checks.push((sum >= cfg.p25 && sum <= cfg.p75 ? "✓" : "•") + " Sum " + sum + " (typical band " + cfg.p25 + "–" + cfg.p75 + ")");
      checks.push((odd === cfg.odd ? "✓" : "•") + " " + odd + " odd / " + (cfg.c - odd) + " even (most common: " + cfg.odd + " odd)");
      checks.push("• " + low + " low / " + (cfg.c - low) + " high");
      if (cal === cfg.c) checks.push("⚠ All " + cfg.c + " numbers are ≤ " + cfg.cal + " (calendar range) — more likely to share a jackpot");
      var balls = line.map(function(n){ return '<span class="ball s">' + n + '</span>'; }).join("");
      out.innerHTML = '<div class="ball-row" style="margin:8px 0">' + balls + '</div>' +
        '<p style="margin:6px 0"><strong>Backtest (' + cfg.win + ' draws):</strong> best match <strong>' + best + ' of ' + cfg.c + '</strong>' +
        (three ? ' · ' + three + ' draw' + (three !== 1 ? 's' : '') + ' with 3+' : '') + (four ? ' · ' + four + ' with 4+' : '') + '.</p>' +
        '<ul class="pattern-list" style="margin:6px 0">' + checks.map(function(c){ return '<li>' + c + '</li>'; }).join("") + '</ul>';
    }
    go.addEventListener("click", function(){
      var line = readLine();
      if (!line) { out.innerHTML = '<p style="color:var(--muted);margin:0">Enter ' + cfg.c + ' different numbers from 1–' + cfg.max + '.</p>'; return; }
      render(line);
    });
    rand.addEventListener("click", function(){
      var s = {}, nums = [];
      while (nums.length < cfg.c) { var n = 1 + Math.floor(Math.random() * cfg.max); if (!s[n]) { s[n] = 1; nums.push(n); } }
      nums.sort(function(a, b){ return a - b; });
      inputs.forEach(function(inp, i){ inp.value = nums[i]; });
      render(nums);
    });
  });

  // ── 사이드 드로어 메뉴 ──
  var drawerEl = document.getElementById("drawer"),
      overlay = document.getElementById("drawer-overlay"),
      menuBtn = document.getElementById("menu-btn");
  if (drawerEl && menuBtn) {
    var setDrawer = function(open){
      drawerEl.classList.toggle("open", open);
      overlay.classList.toggle("show", open);
      document.body.classList.toggle("drawer-open", open);
      drawerEl.setAttribute("aria-hidden", open ? "false" : "true");
      menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    };
    menuBtn.addEventListener("click", function(){ setDrawer(true); });
    drawerEl.querySelector(".dw-x").addEventListener("click", function(){ setDrawer(false); });
    overlay.addEventListener("click", function(){ setDrawer(false); });
    document.addEventListener("keydown", function(e){
      if (e.key === "Escape") setDrawer(false);
    });
  }

  // ── 모바일 고정 설치 바 (닫으면 기억) ──
  var bar = document.getElementById("sticky-bar");
  if (bar) {
    var dismissed = false;
    try { dismissed = localStorage.getItem("sb-dismissed") === "1"; } catch (e) {}
    if (!dismissed) {
      bar.classList.add("open");
      document.body.classList.add("has-sticky-bar");
      bar.querySelector(".sb-x").addEventListener("click", function(){
        bar.classList.remove("open");
        document.body.classList.remove("has-sticky-bar");
        try { localStorage.setItem("sb-dismissed", "1"); } catch (e) {}
      });
    }
  }
})();
</script>
</body>
</html>`;
  return html.replaceAll("@@/", relPrefix(path));
}

// ── 성적표 조각 ──────────────────────────────────────────────────────────────

function scoreRows(scorecard, whiteCount, specialName, key) {
  return scorecard.sets
    .map(
      (r, i) => `
    <div class="score-row" style="${gv(key)}">
      <span class="stamp-sm">Set ${String(i + 1).padStart(2, "0")}</span>
      <span class="sl">${esc(r.label)}</span>
      <span class="hit-badge${r.matches === 0 && !r.specialHit ? " zero" : ""} num">${r.matches} of ${whiteCount}${r.specialHit ? ` + ${esc(specialName || "Special")}` : ""}</span>
    </div>`
    )
    .join("");
}

// ── 포스트 본문 (빅3 개별 글) ────────────────────────────────────────────────

export function renderPostBody(post, ogImageFile = null) {
  const game = gameById(post.gameId);
  const key = gameKey(post.gameId);
  const s = post.stats;
  const oddLabel = `${s.oddSplit.best} odd / ${game.whiteCount - s.oddSplit.best} even`;
  const lowLabel = `${s.lowSplit.best} low / ${game.whiteCount - s.lowSplit.best} high`;

  const tickets = post.sets
    .map((set, i) => {
      const oc = post.outcome ? post.outcome.sets[i] : null;
      return `
    <div class="ticket">
      <div class="cutline">✂<i></i></div>
      <div class="tk-body" style="${gv(key)}">
        <span class="spine"></span>
        <div class="tk-head">
          <div>
            <div class="glabel">${esc(game.name)}</div>
            <div class="strategy">${esc(set.label)}</div>
          </div>
          <span class="set-stamp">Set ${String(i + 1).padStart(2, "0")}</span>
        </div>
        ${ballRow(set.white, set.special, key, "m")}
        ${oc ? `<p class="tk-note"><span class="hit-badge${oc.matches === 0 && !oc.specialHit ? " zero" : ""} num">${oc.matches} of ${game.whiteCount} hit${oc.specialHit ? ` + ${esc(game.specialName)}` : ""}</span></p>` : `<p class="tk-note">${esc(set.description)}</p>`}
      </div>
    </div>`;
    })
    .join("");

  const overdueRows = s.overdue
    .map(
      (o) =>
        `<div class="od-row" style="${gv(key)}"><b class="num">${o.num}</b><span>${o.gap >= s.window ? `${s.window}+ draws ago` : `${o.gap} draws ago`}</span></div>`
    )
    .join("");

  const scorecard = post.scorecard
    ? `
  ${sectionHead("How our last picks did", `vs the ${longDate(post.scorecard.forDate)} draw`)}
  <div class="sketch-card">
    ${scoreRows(post.scorecard, game.whiteCount, game.specialName, key)}
    <p class="score-foot">Graded automatically against the official ${esc(longDate(post.scorecard.forDate))} result. Randomness always wins — treat this as entertainment.</p>
  </div>`
    : "";

  const outcomeBanner = post.outcome
    ? `<p><strong>Results are in:</strong> this drawing landed <strong class="num">${post.outcome.white.join(", ")}</strong>${post.outcome.special != null ? ` + ${esc(game.specialName)} <strong class="num">${post.outcome.special}</strong>` : ""} — each ticket below shows how it scored.</p>`
    : `<p>${esc(post.prose.predictionsLead)}</p>`;

  return `
<article class="post">
  <div class="post-meta-row">
    ${gameTag(key, game.name)}
    <span class="mut">Published ${esc(longDate(post.publishedDate))} · auto-generated after the official draw · ${s.window}-draw window</span>
  </div>
  <h1>${esc(post.title)}</h1>
  ${leadImage(ogImageFile)}

  <div class="wash-block" style="${gv(key)}">
    <div class="lab">Last winning numbers · ${esc(longDateWithDay(post.resultDate))}</div>
    ${ballRow(s.latest.white, s.latest.special, key, "l")}
    ${game.specialName ? `<p class="ball-caption">The colored ball is the ${esc(game.specialName)}.</p>` : ""}
  </div>

  ${post.prose.insight ? `<p class="lead">${esc(post.prose.insight)}</p>` : ""}

  ${scorecard}

  <p class="lead">${esc(post.prose.intro)}</p>

  ${sectionHead(`AI-picked sets for ${longDate(post.targetDate)}`)}
  ${outcomeBanner}
  <div class="ticket-grid">${tickets}</div>
  ${s.specialHot.length ? `<p><strong>${esc(game.specialName)} watch:</strong> most frequent recently — ${s.specialHot.map((x) => `<b class="num">${x.num}</b> <span class="mut">(×${x.count})</span>`).join(", ")}</p>` : ""}

  ${generatorWidget(game)}

  ${sectionHead("What's running hot")}
  <p>${esc(post.prose.hot)}</p>
  <div class="panel-cols">
    <div class="stat-panel" style="${gv(key)}">
      <div class="ph"><span class="gdot"></span><h3>Most-drawn numbers · last ${s.window} draws</h3></div>
      ${crayonBars(post.hot10.slice(0, 8).map((h) => ({ label: h.num, value: h.count })))}
    </div>
    <div class="sketch-card" style="${gv(key)}">
      <div class="ph" style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><span style="width:14px;height:14px;border-radius:50%;background:var(--gc);border:2px solid var(--ink)"></span><h3 style="margin:0;font-size:var(--t-h3)">Longest overdue</h3></div>
      ${overdueRows}
    </div>
  </div>
  <p>${esc(post.prose.cold)}</p>

  ${sectionHead("Draw patterns")}
  <p>${esc(post.prose.patterns)}</p>
  <div class="sketch-card">
    <ul class="pattern-list">
      <li><strong>Odd / even:</strong> the most common split is <strong>${oddLabel}</strong> (${s.oddSplit.pct}% of recent draws; average ${s.oddSplit.avgOdd} odd numbers per draw).</li>
      <li><strong>Low / high:</strong> numbers 1–${s.lowSplit.lowMax} vs ${s.lowSplit.lowMax + 1}–${game.whiteMax} most often land at <strong>${lowLabel}</strong> (${s.lowSplit.pct}%).</li>
      <li><strong>Sum range:</strong> recent winning lines sum between <strong>${s.sum.min} and ${s.sum.max}</strong>, with half of all draws inside <strong>${s.sum.p25}–${s.sum.p75}</strong> (average ${s.sum.avg}).</li>
      <li><strong>Consecutive pairs:</strong> at least one back-to-back pair appeared in <strong>${s.consecutivePct}%</strong> of recent draws.</li>
      <li><strong>Repeats:</strong> <strong>${s.repeatPct}%</strong> of draws repeated at least one number from the previous drawing.</li>
    </ul>
  </div>

  ${sectionHead("Full number heatmap")}
  <p>Every number in the ${esc(game.name)} pool, shaded by how often it hit in the last ${s.window} draws:</p>
  ${heatGrid(s.freq, s.maxFreq, PASTEL_HEX[key])}

  ${ticketChecker(game, s.latest)}

  <p>${esc(post.prose.outro)}</p>

  <div class="next-draw-note">
    ${countdownTile(game, `until the ${game.name} drawing`)}
    <p style="flex:1 1 240px;margin:0">Next ${esc(game.name)} drawing: <strong>${esc(longDateWithDay(post.targetDate))}</strong> at ${esc(game.drawTimeEt)}. Good luck!</p>
  </div>

  ${installPanel("Carry your lucky numbers everywhere.")}
</article>`;
}

// ── 다이제스트 본문 ──────────────────────────────────────────────────────────

export function renderDigestBody(digest, ogImageFile = null) {
  const sections = DIGEST.gameIds
    .filter((id) => digest.sections[id])
    .map((id) => {
      const sec = digest.sections[id];
      const game = gameById(id);
      const key = gameKey(id);
      const s = sec.stats;
      const tickets = sec.sets
        .map((set, i) => {
          const oc = sec.outcome ? sec.outcome.sets[i] : null;
          return `
        <div class="ticket">
          <div class="cutline">✂<i></i></div>
          <div class="tk-body" style="${gv(key)}">
            <span class="spine"></span>
            <div class="tk-head">
              <div>
                <div class="glabel">${esc(game.name)}</div>
                <div class="strategy">${esc(set.label)}</div>
              </div>
              <span class="set-stamp">Set ${String(i + 1).padStart(2, "0")}</span>
            </div>
            ${ballRow(set.white, set.special, key, "m")}
            ${oc ? `<p class="tk-note"><span class="hit-badge${oc.matches === 0 && !oc.specialHit ? " zero" : ""} num">${oc.matches} of ${game.whiteCount} hit${oc.specialHit ? ` + ${esc(game.specialName)}` : ""}</span></p>` : ""}
          </div>
        </div>`;
        })
        .join("");
      const best = sec.scorecard
        ? sec.scorecard.sets.reduce((a, b) => (b.matches > a.matches ? b : a))
        : null;
      return `
  <section class="digest-section" style="${gv(key)}">
    <h2><span class="gdot"></span>${esc(game.name)} <span class="mut" style="font-family:var(--font-hand);font-size:var(--t-hand);color:var(--muted)">${esc(game.drawTimeEt)}</span></h2>
    <div class="wash-block" style="${gv(key)}">
      <div class="lab">Result · ${esc(longDate(sec.resultDate))}</div>
      ${ballRow(s.latest.white, s.latest.special, key, "m")}
    </div>
    ${best ? `<p><strong>Yesterday's picks:</strong> best set hit <strong class="num">${best.matches} of ${game.whiteCount}</strong> (${esc(best.label)}).</p>` : ""}
    <p>
      <strong>Hot:</strong> ${s.hot.slice(0, 5).map((h) => `<b class="num">${h.num}</b>`).join(" · ")}
      &nbsp;&nbsp;<strong>Overdue:</strong> ${s.overdue.slice(0, 5).map((o) => `<b class="num">${o.num}</b>`).join(" · ")}
    </p>
    <h3>AI picks for ${esc(longDate(sec.targetDate))}</h3>
    <div class="ticket-grid">${tickets}</div>
  </section>`;
    })
    .join("");

  return `
<article class="post">
  <div class="post-meta-row">
    ${gameTag("take5", "NY Daily Digest")}
    <span class="mut">Published ${esc(longDateWithDay(digest.date))} · auto-updated as each drawing comes in</span>
  </div>
  <h1>${esc(digest.title)}</h1>
  ${leadImage(ogImageFile)}
  <p class="lead">${esc(digest.intro)}</p>
  ${sections}
  ${stickyNote("Daily games move fast", "Twice-a-day Take 5 plus a nightly Millionaire draw — let the app track them all for you.", "Get the free app")}
  ${installPanel("Your daily numbers, one tap away.")}
</article>`;
}

// ── 월간 리캡 본문 ───────────────────────────────────────────────────────────

export function renderRecapBody(recap, ogImageFile = null) {
  const game = gameById(recap.gameId);
  const key = gameKey(recap.gameId);
  const s = recap.stats;
  const oddLabel = `${s.oddSplit.best} odd / ${game.whiteCount - s.oddSplit.best} even`;
  const drawsAsc = [...recap.draws].reverse();
  const rows = drawsAsc
    .map(
      (d) => `
    <div class="recap-row">
      <span class="rd">${esc(longDate(d.date))}</span>
      ${ballRow(d.white, d.special, key, "s")}
    </div>`
    )
    .join("");

  const ai = recap.ai && recap.ai.postsGraded > 0
    ? `
  ${sectionHead("AI scorecard for the month")}
  <div class="sketch-card">
    <p style="margin:0 0 8px">We graded <strong>${recap.ai.postsGraded}</strong> prediction posts against official ${esc(game.name)} results in ${esc(recap.monthName)}.</p>
    <p style="margin:0">Best set of the month: <strong>${esc(recap.ai.best.label)}</strong> hit <strong class="num">${recap.ai.best.matches} of ${game.whiteCount}</strong>${recap.ai.best.specialHit ? ` plus the ${esc(game.specialName)}` : ""} on ${esc(longDate(recap.ai.best.date))}.${recap.ai.threePlus > 0 ? ` Sets matched 3 or more numbers in <strong>${recap.ai.threePlus}</strong> drawings.` : ""}</p>
    <p class="score-foot">For entertainment only — past matches don't change future odds.</p>
  </div>`
    : "";

  return `
<article class="post">
  <div class="post-meta-row">
    ${gameTag(key, game.name)}
    ${sticker("Monthly recap", -3)}
  </div>
  <h1>${esc(recap.title)}</h1>
  ${leadImage(ogImageFile)}
  <p class="lead">Every ${esc(game.name)} drawing from ${esc(recap.monthName)} in one place — ${recap.draws.length} draws, the month's hottest numbers, and how the patterns shook out.</p>

  ${sectionHead(`Hottest numbers of ${recap.monthName}`)}
  <div class="stat-panel" style="${gv(key)}">
    <div class="ph"><span class="gdot"></span><h3>Most-drawn numbers · ${esc(recap.monthName)}</h3></div>
    ${crayonBars(recap.hot.slice(0, 8).map((h) => ({ label: h.num, value: h.count })))}
  </div>

  ${sectionHead("Every drawing this month")}
  <div class="sketch-card">${rows}</div>

  ${sectionHead("Month in patterns")}
  <div class="sketch-card">
    <ul class="pattern-list">
      <li><strong>Odd / even:</strong> the most common split was <strong>${oddLabel}</strong> (${s.oddSplit.pct}% of draws).</li>
      <li><strong>Sum range:</strong> winning lines summed between <strong>${s.sum.min} and ${s.sum.max}</strong> (average ${s.sum.avg}).</li>
      <li><strong>Consecutive pairs:</strong> appeared in <strong>${s.consecutivePct}%</strong> of the month's draws.</li>
      <li><strong>Repeats from the previous draw:</strong> <strong>${s.repeatPct}%</strong> of draws.</li>
    </ul>
  </div>

  ${ai}

  <p>Fresh per-draw analysis continues as always — see the <a href="${u(`/${game.slug}/`)}">latest ${esc(game.name)} predictions</a>.</p>

  ${installPanel(`Every ${game.name} draw, tracked for you.`)}
</article>`;
}

// ── 주간 심층 분석 본문 ──────────────────────────────────────────────────────

/** 분석 글 상단 앱 홍보 배너: "Skip the homework?" + 실측 성적 소셜프루프 */
function analysisPromo(game, proof) {
  const proofLine = proof
    ? ` Last draw its best set — ${esc(proof.label)} — hit ${proof.matches} of ${proof.whiteCount} numbers.`
    : "";
  return `
<div class="note-wrap" style="transform:none">
  <div class="tape"></div>
  <div class="note"><div class="note-inner">
    <div class="nt">
      <div class="nt-head">${doodle("sparkle", 20)}<h3>Skip the homework?</h3></div>
      <p>The free app turns this exact analysis into five ready-made ${esc(game.name)} lines seconds after every draw.${proofLine}</p>
    </div>
    ${ctaButton("Get AI picks — free", "", "analysis-hero")}
  </div></div>
</div>`;
}

/** 인터랙티브 "Line Lab" — 사용자 라인을 최근 N회 백테스트 + 패턴 적합도 채점 (혼합 데모) */
export function lineLab(game, analysis) {
  const key = gameKey(game.id);
  const s = analysis.stats;
  const cfg = esc(
    JSON.stringify({
      draws: analysis.winDraws || [],
      c: game.whiteCount,
      max: game.whiteMax,
      p25: s.sum.p25,
      p75: s.sum.p75,
      odd: s.oddSplit.best,
      lowMax: s.lowSplit.lowMax,
      cal: analysis.popularity ? analysis.popularity.calendarMax : 31,
      win: s.window,
    })
  );
  const inputs = Array.from(
    { length: game.whiteCount },
    (_, i) => `<input inputmode="numeric" maxlength="2" aria-label="Number ${i + 1}">`
  ).join("");
  return `
  ${sectionHead("Line Lab — stress-test your own numbers")}
  <p>Type a ${esc(game.name)} line (or roll a random one) and we grade it two ways: how it would have scored across the last ${s.window} draws, and how well it fits the patterns above. All in your browser.</p>
  <div class="sketch-card" data-linelab="${cfg}" style="${gv(key)}">
    <div class="chk-inputs">${inputs}</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin:4px 0 2px">
      <button type="button" class="btn-ink ll-go">Test my line</button>
      <button type="button" class="btn-ghost ll-rand">🎲 Random line</button>
    </div>
    <div class="ll-result" aria-live="polite"></div>
    <p class="chk-note">Backtest is for entertainment only. Every combination has identical odds — matching past draws never changes that.</p>
  </div>`;
}

/** 고급 분석 섹션 묶음 (회귀·미출 격자·사카이·백테스트·비인기). 데이터 없으면 빈 문자열. */
function renderAdvancedSections(analysis, game, key) {
  const s = analysis.stats;
  const out = [];

  const rec = analysis.recurrence;
  if (rec && rec.hot) {
    const rows =
      rec.hot
        .slice(0, 8)
        .map(
          (r) =>
            `<div class="od-row" style="${gv(key)}"><b class="num">${r.s} back</b><span>resting ${r.current} draw${r.current !== 1 ? "s" : ""} in a row${r.max ? ` (record ${r.max})` : ""}${r.diff >= 0 ? " · record-long" : ""}</span></div>`
        )
        .join("") || `<p style="margin:0;color:var(--muted)">No recurrence is at a record rest this week.</p>`;
    const cand = rec.candidates.length
      ? ballRow(rec.candidates.slice(0, 10).map((c) => c.num), null, key, "s")
      : `<p style="margin:0;color:var(--muted)">Nothing overdue to flag.</p>`;
    out.push(`
  ${sectionHead("Recurrence watch — rest streaks")}
  <p>A "recurrence" asks whether numbers from <em>N draws ago</em> come back. When that link goes quiet for a record-long stretch, folk-analysis calls it "due." The steps currently at or past their longest-ever rest:</p>
  <div class="panel-cols">
    <div class="sketch-card" style="${gv(key)}">${rows}</div>
    <div class="sketch-card" style="${gv(key)}">
      <h3 style="margin:0 0 10px;font-size:var(--t-h3)">Numbers those steps point to</h3>
      ${cand}
      <p style="margin:10px 0 0;color:var(--muted);font-size:var(--t-sm)">Shared across the most overdue recurrences (the "duplicate" count).</p>
    </div>
  </div>`);
  }

  const bd = analysis.bands;
  if (bd) {
    out.push(`
  ${sectionHead("Missing-interval map")}
  <p>Every number placed on the draw where it last appeared, by size position. Top rows are the longest-absent numbers; a blank means that slot's number already came back more recently.</p>
  <div class="sketch-card" style="${gv(key)}">${lastSeenGrid(bd.grid, bd.whiteCount)}</div>
  <div class="panel-cols">
    <div class="sketch-card" style="${gv(key)}">
      <h3 style="margin:0 0 8px;font-size:var(--t-h3)">By gap band</h3>
      ${bandChips(bd.missing, true)}
    </div>
    <div class="sketch-card" style="${gv(key)}">
      <h3 style="margin:0 0 8px;font-size:var(--t-h3)">Does the gap band matter?</h3>
      ${liftTable(bd.gapLift, (r) => GAP_BAND_LABEL[r.band], `Rolling check over ${bd.gapLift[0] ? bd.gapLift[0].rounds : 0} past draws. ×1.00 = no edge over random.`)}
    </div>
  </div>

  ${sectionHead("Sakai frequency bands")}
  <p>Numbers grouped by how many times they hit in the last ${s.window} draws (6+ merged). The lift table asks whether "hot band" numbers really repeat more than chance.</p>
  <div class="panel-cols">
    <div class="sketch-card" style="${gv(key)}">
      <h3 style="margin:0 0 8px;font-size:var(--t-h3)">Bands now</h3>
      ${bandChips(bd.sakai)}
    </div>
    <div class="sketch-card" style="${gv(key)}">
      <h3 style="margin:0 0 8px;font-size:var(--t-h3)">Lift by band</h3>
      ${liftTable(bd.sakaiLift, (r) => (r.band >= 6 ? "6+ hits" : `${r.band} hit${r.band !== 1 ? "s" : ""}`), "Numbers that hit N times, checked against the next draw.")}
    </div>
  </div>`);
  }

  const bt = analysis.backtest;
  if (bt && bt.hot) {
    const liftRows = [
      ["Hot pool", bt.hot],
      ["Overdue pool", bt.overdue],
      ["Cold pool", bt.cold],
    ]
      .filter(([, v]) => v)
      .map(([label, v]) => ({ label, poolSize: v.poolSize, act: v.act, exp: v.exp, lift: v.lift }));
    out.push(`
  ${sectionHead("Reality check — does any signal beat random?")}
  <p>We took each strategy's number pool and, for every one of the last ${bt.hot.rounds} draws, counted how many actually hit — versus what pure chance predicts. The honest result:</p>
  <div class="sketch-card">${liftTable(
      liftRows,
      (r) => r.label,
      "Actual hits per draw vs random expectation. Everything hovers near ×1.00 — no signal reliably beats chance. We publish the check instead of hiding it."
    )}</div>`);
  }

  const pop = analysis.popularity;
  if (pop) {
    out.push(`
  ${sectionHead("Payout strategy — dodge the crowd")}
  <p>This is the one edge that's mathematically real — not on your <em>odds</em>, but on your <em>payout</em>. A ${esc(game.name)} jackpot is <strong>split</strong> among all winners, and most players pack their lines with calendar dates (birthdays, 1–${pop.calendarMax}). Only <strong>${pop.calendarSharePct}%</strong> of the ${pop.poolMax}-number pool sits at or below ${pop.calendarMax}; the ${pop.aboveCount} numbers above it get chosen far less often.</p>
  <div class="sketch-card" style="${gv(key)}">
    <h3 style="margin:0 0 8px;font-size:var(--t-h3)">Less-crowded pool · ${pop.calendarMax + 1}–${pop.poolMax}</h3>
    ${ballRow(pop.unpopularPool, null, key, "s")}
    <p style="margin:10px 0 0;color:var(--muted);font-size:var(--t-sm)">Leaning a couple of picks into this range doesn't change your chance of winning — but if you do win, you're less likely to share the prize. Never spend more chasing it.</p>
  </div>`);
  }

  return out.join("\n");
}

export function renderAnalysisBody(analysis, ogImageFile = null) {
  const game = gameById(analysis.gameId);
  const key = gameKey(analysis.gameId);
  const s = analysis.stats;
  const d = analysis.deep;
  const oddLabel = `${s.oddSplit.best} odd / ${game.whiteCount - s.oddSplit.best} even`;

  const poolCard = (title, note, entries, cold = false) => `
    <div class="sketch-card" style="${gv(key)}">
      <div class="ph" style="display:flex;align-items:center;gap:8px;margin-bottom:10px"><span style="width:14px;height:14px;border-radius:50%;background:var(--gc);border:2px solid var(--ink)"></span><h3 style="margin:0;font-size:var(--t-h3)">${esc(title)}</h3></div>
      ${ballRow(entries.map((e) => e.num), null, key, "s")}
      <p style="margin:10px 0 0;color:var(--muted);font-size:var(--t-sm)">${esc(note)}</p>
    </div>`;

  return `
<article class="post">
  <div class="post-meta-row">
    ${gameTag(key, game.name)}
    ${sticker("Deep Analysis · DIY", -3)}
    <span class="mut">Week of ${esc(longDate(analysis.weekStart))} · ${s.window}-draw window</span>
  </div>
  <h1>${esc(analysis.title)}</h1>
  ${leadImage(ogImageFile)}

  ${analysisPromo(game, analysis.proof)}

  <p class="lead">${esc(analysis.prose.intro)}</p>

  ${sectionHead("Number pools — your raw materials")}
  <p>${esc(analysis.prose.pools)}</p>
  <div style="display:grid;gap:16px">
    ${poolCard("Hot pool — ride the streaks", `The 8 most frequent numbers of the last ${s.window} draws. Pick 2.`, d.pools.hot)}
    ${poolCard("Middle pool — the quiet workhorses", "8 mid-frequency numbers — neither hot nor cold. Pick 2.", d.pools.mid)}
    ${poolCard("Overdue pool — the swing picks", `Longest absences right now (up to ${d.pools.overdue[0].gap >= s.window ? s.window + "+" : d.pools.overdue[0].gap} draws). Pick 1.`, d.pools.overdue)}
  </div>

  ${sectionHead("Play-slip pattern")}
  <p>Where winning numbers actually sit on the slip — by row (tens) and by ending digit. Lines that ignore whole regions of the slip fight the data.</p>
  <div class="panel-cols">
    <div class="stat-panel" style="${gv(key)}">
      <div class="ph"><span class="gdot"></span><h3>Hits by slip row</h3></div>
      ${crayonBars(d.decades.map((v, i) => ({ label: d.decadeLabels[i], value: v })), "")}
    </div>
    <div class="stat-panel" style="${gv(key)}">
      <div class="ph"><span class="gdot"></span><h3>Hits by ending digit</h3></div>
      ${crayonBars(d.digits.map((v, i) => ({ label: i, value: v })), "")}
    </div>
  </div>

  ${sectionHead("Sum trend — regression check")}
  <p>The total of each winning line, tracked over the last ${d.sumTrend.series.length} draws. The trend is <strong>${d.sumTrend.direction}</strong> (slope ${d.sumTrend.slope > 0 ? "+" : ""}${d.sumTrend.slope} per draw, average ${d.sumTrend.avg}). Aim your own line's total near the recent band of <strong>${s.sum.p25}–${s.sum.p75}</strong>.</p>
  <div class="sketch-card" style="${gv(key)}">${sparkline(d.sumTrend.series, `var(--game-${key})`)}</div>

  ${sectionHead("Momentum — risers & fallers")}
  <div class="panel-cols">
    <div class="sketch-card" style="${gv(key)}">
      <h3 style="margin:0 0 10px;font-size:var(--t-h3)">↑ Heating up</h3>
      ${d.risers.map((r) => `<div class="od-row" style="${gv(key)}"><b class="num">${r.num}</b><span>${r.c10}× in last 10 draws</span></div>`).join("")}
    </div>
    <div class="sketch-card" style="${gv(key)}">
      <h3 style="margin:0 0 10px;font-size:var(--t-h3)">↓ Cooling off</h3>
      ${d.fallers.length ? d.fallers.map((r) => `<div class="od-row" style="${gv(key)}"><b class="num">${r.num}</b><span>${r.cAll}× overall, 0 in last 10</span></div>`).join("") : `<p style="margin:0;color:var(--muted)">No hot number has gone quiet this week.</p>`}
    </div>
  </div>

  ${sectionHead("Neighbor effect (adjacent numbers)")}
  <p>In <strong>${d.neighborRate}%</strong> of the last ${s.window} draws, at least one number landed right next to (±1) a number from the draw before it. The current neighbor candidates, built from the latest result:</p>
  <div class="sketch-card" style="${gv(key)}">
    ${ballRow(d.neighborPool, null, key, "s")}
    <p style="margin:10px 0 0;color:var(--muted);font-size:var(--t-sm)">Numbers one step away from the ${esc(longDate(analysis.publishedDate))} winning line.</p>
  </div>

  ${renderAdvancedSections(analysis, game, key)}

  ${analysis.winDraws ? lineLab(game, analysis) : ""}

  ${sectionHead("Final checklist before you play your line")}
  <div class="sketch-card">
    <ul class="pattern-list">
      <li><strong>Balance:</strong> shape your line toward <strong>${oddLabel}</strong> — the most common split (${s.oddSplit.pct}% of recent draws).</li>
      <li><strong>Spread:</strong> cover at least 3 different slip rows; ${s.lowSplit.pct}% of draws lean <strong>${s.lowSplit.best} low / ${game.whiteCount - s.lowSplit.best} high</strong>.</li>
      <li><strong>Total:</strong> keep the sum inside <strong>${s.sum.p25}–${s.sum.p75}</strong>.</li>
      <li><strong>Consecutive pairs:</strong> one pair is fine (${s.consecutivePct}% of draws have one); avoid three-in-a-row.</li>
      <li><strong>Carry-over:</strong> ${s.repeatPct}% of draws repeat a number from the previous drawing — including one is a data-backed choice.</li>
    </ul>
    <p class="score-foot">Reminder: every combination has identical odds. These rules match the shape of typical winning lines — they can't beat randomness.</p>
  </div>

  <p>${esc(analysis.prose.outro)}</p>

  <div class="next-draw-note">
    ${countdownTile(game, `until the ${game.name} drawing`)}
    <p style="flex:1 1 240px;margin:0">Next ${esc(game.name)} drawing: <strong>${esc(longDateWithDay(analysis.targetDate))}</strong> at ${esc(game.drawTimeEt)}. Build well!</p>
  </div>

  ${installPanel("Rather have it assembled for you?")}
</article>`;
}
