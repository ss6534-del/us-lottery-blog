// data/의 게시글 JSON → dist/ 정적 사이트 렌더링 (Lucky Sketch 디자인).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, GAMES, DIGEST, gameById } from "../site.config.js";
import { longDate } from "../lib/soda.js";
import {
  layout, renderPostBody, renderDigestBody, renderRecapBody, renderAnalysisBody, postCard, u, esc,
  gameKey, shortDate, sticker, stickyNote, installPanel, countdownTile,
  sectionHead, ctaButton, playBadge, generatorWidget, ticketChecker, setNavCounts,
} from "../lib/html.js";
import { STATIC_PAGES } from "../content/pages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const DIST = path.join(ROOT, "dist");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function listJson(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}
function writePage(relPath, html) {
  const file = path.join(DIST, relPath, "index.html");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, html, "utf8");
}

function articleJsonLd(title, description, urlPath, datePublished) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    datePublished,
    mainEntityOfPage: `${SITE.baseUrl.replace(/\/$/, "")}${urlPath}`,
    author: { "@type": "Organization", name: SITE.title, url: SITE.baseUrl },
    publisher: { "@type": "Organization", name: SITE.title },
  };
}

function countJson(dir) {
  return fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).length
    : 0;
}

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // 드로어 메뉴의 카테고리별 글 수 (렌더링 전에 주입)
  const navCounts = { games: {}, digests: countJson(path.join(DATA, "digests")), recaps: 0, analysis: 0 };
  for (const g of GAMES.filter((g) => g.mode === "post")) {
    const recs = countJson(path.join(DATA, "recaps", g.slug));
    const anas = countJson(path.join(DATA, "analysis", g.slug));
    navCounts.games[g.slug] = countJson(path.join(DATA, "posts", g.slug)) + recs + anas;
    navCounts.recaps += recs;
    navCounts.analysis += anas;
  }
  setNavCounts(navCounts);

  const urls = []; // sitemap용
  const cards = []; // 홈/피드용 카드 데이터

  // ── 빅3 개별 포스트 ──
  const hubPosts = {};
  for (const game of GAMES.filter((g) => g.mode === "post")) {
    const dir = path.join(DATA, "posts", game.slug);
    const posts = listJson(dir).map(readJson);
    posts.sort((a, b) => b.targetDate.localeCompare(a.targetDate));
    hubPosts[game.slug] = posts;

    for (const post of posts) {
      const urlPath = `/${game.slug}/${post.targetDate}/`;
      const description =
        `${game.name} analysis for the ${longDate(post.targetDate)} drawing: latest results, ` +
        `hot & cold numbers, pattern stats and 5 AI-generated sets.`;
      writePage(urlPath, layout({
        title: post.title,
        description,
        path: urlPath,
        ogType: "article",
        jsonLd: articleJsonLd(post.title, description, urlPath, post.publishedDate),
        content: renderPostBody(post),
      }));
      urls.push({ path: urlPath, date: post.publishedDate });
      cards.push({
        path: urlPath,
        gameKey: gameKey(game.id),
        gameName: game.name,
        title: post.title,
        dateLabel: shortDate(post.resultDate),
        metaText: `AI picks for ${shortDate(post.targetDate)}`,
        numbers: post.stats.latest.white,
        special: post.stats.latest.special,
        excerpt: post.prose.intro,
        sortDate: post.publishedDate,
        sortKey: `${post.publishedDate}~post~${game.id}`,
      });
    }
  }

  // ── 다이제스트 ──
  const digests = listJson(path.join(DATA, "digests")).map(readJson);
  digests.sort((a, b) => b.date.localeCompare(a.date));
  for (const digest of digests) {
    const urlPath = `/${DIGEST.slug}/${digest.date}/`;
    const description =
      `NY Take 5 (midday & evening) and Millionaire for Life results for ${longDate(digest.date)}, ` +
      `plus hot numbers and AI picks for the next drawings.`;
    writePage(urlPath, layout({
      title: digest.title,
      description,
      path: urlPath,
      ogType: "article",
      jsonLd: articleJsonLd(digest.title, description, urlPath, digest.date),
      content: renderDigestBody(digest),
    }));
    urls.push({ path: urlPath, date: digest.date });
    const lead =
      digest.sections.take5_eve || digest.sections.take5_mid || digest.sections.millionaire;
    cards.push({
      path: urlPath,
      gameKey: "take5",
      gameName: DIGEST.name,
      title: digest.title,
      dateLabel: shortDate(digest.date),
      metaText: "Take 5 ×2 + Millionaire",
      numbers: lead ? lead.stats.latest.white : [],
      special: lead ? lead.stats.latest.special : null,
      excerpt: digest.intro,
      sortDate: digest.date,
      sortKey: `${digest.date}~digest`,
    });
  }

  // ── 월간 리캡 ──
  for (const game of GAMES.filter((g) => g.mode === "post")) {
    const dir = path.join(DATA, "recaps", game.slug);
    const recaps = listJson(dir).map(readJson);
    recaps.sort((a, b) => b.month.localeCompare(a.month));
    for (const recap of recaps) {
      const urlPath = `/${game.slug}/${recap.month}-recap/`;
      const description =
        `${game.name} monthly recap for ${recap.monthName}: every drawing, ` +
        `the month's hottest numbers, pattern breakdown and AI scorecard.`;
      writePage(urlPath, layout({
        title: `${recap.title} — ${SITE.title}`,
        description,
        path: urlPath,
        ogType: "article",
        jsonLd: articleJsonLd(recap.title, description, urlPath, recap.draws[0]?.date),
        content: renderRecapBody(recap),
      }));
      urls.push({ path: urlPath, date: recap.draws[0]?.date });
      cards.push({
        path: urlPath,
        gameKey: gameKey(game.id),
        gameName: game.name,
        title: recap.title,
        dateLabel: recap.monthName,
        metaText: `${recap.draws.length} draws recapped`,
        numbers: recap.hot.slice(0, 5).map((h) => h.num),
        special: null,
        stickerText: "Monthly Recap",
        excerpt: `Every ${game.name} drawing from ${recap.monthName}: results, hot numbers and patterns.`,
        sortDate: recap.draws[0]?.date || `${recap.month}-28`,
        sortKey: `${recap.draws[0]?.date || recap.month}~recap~${game.id}`,
      });
    }
  }

  // ── 주간 심층 분석 ──
  for (const game of GAMES.filter((g) => g.mode === "post")) {
    const dir = path.join(DATA, "analysis", game.slug);
    const analyses = listJson(dir).map(readJson);
    analyses.sort((a, b) => b.weekStart.localeCompare(a.weekStart));
    for (const analysis of analyses) {
      const urlPath = `/${game.slug}/${analysis.weekStart}-analysis/`;
      const description =
        `${game.name} deep analysis for the week of ${longDate(analysis.weekStart)}: number pools, ` +
        `play-slip patterns, sum regression, momentum and neighbor stats — build your own line.`;
      writePage(urlPath, layout({
        title: `${analysis.title} — ${SITE.title}`,
        description,
        path: urlPath,
        ogType: "article",
        jsonLd: articleJsonLd(analysis.title, description, urlPath, analysis.publishedDate),
        content: renderAnalysisBody(analysis),
      }));
      urls.push({ path: urlPath, date: analysis.publishedDate });
      cards.push({
        path: urlPath,
        gameKey: gameKey(game.id),
        gameName: game.name,
        title: analysis.title,
        dateLabel: `Week of ${shortDate(analysis.weekStart)}`,
        metaText: "build-your-own guide",
        numbers: analysis.deep.pools.hot.slice(0, 5).map((h) => h.num),
        special: null,
        stickerText: "Deep Analysis",
        excerpt: analysis.prose.intro,
        sortDate: analysis.publishedDate,
        sortKey: `${analysis.publishedDate}~analysis~${game.id}`,
      });
    }
  }

  cards.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  // ── 게임 허브 페이지 ──
  for (const game of GAMES.filter((g) => g.mode === "post")) {
    const posts = hubPosts[game.slug];
    const urlPath = `/${game.slug}/`;
    const list = cards.filter((c) => c.gameName === game.name).map(postCard).join("");
    writePage(urlPath, layout({
      title: `${game.name} Predictions & Analysis — ${SITE.title}`,
      description: `Every ${game.name} drawing analyzed: hot & cold numbers, pattern stats and AI predicted sets, updated automatically after each draw.`,
      path: urlPath,
      content: `
<section class="hero">
  <div class="hero-copy">
    <div style="margin-bottom:14px">${sticker(`${game.name} · AI Picks`)}</div>
    <h1>${esc(game.name)} — predictions &amp; analysis</h1>
    <p>Fresh analysis after every drawing (${esc(game.drawTimeEt)}). Newest first.</p>
  </div>
  <div class="hero-side">${countdownTile(game, `until the next ${game.name} draw`)}</div>
</section>
<section class="wrap">
  <div class="card-grid">${list || "<p>First analysis coming right after the next drawing.</p>"}</div>
</section>`,
    }));
    urls.push({ path: urlPath, date: posts[0]?.publishedDate });
  }

  // ── 다이제스트 허브 ──
  {
    const urlPath = `/${DIGEST.slug}/`;
    const list = cards.filter((c) => c.gameName === DIGEST.name).map(postCard).join("");
    const tiles = DIGEST.gameIds.map((id) => countdownTile(gameById(id))).join("");
    writePage(urlPath, layout({
      title: `NY Daily Digest — Take 5 & Millionaire for Life — ${SITE.title}`,
      description: "Daily results and AI picks for NY Take 5 (midday & evening) and Millionaire for Life.",
      path: urlPath,
      content: `
<section class="hero">
  <div class="hero-copy">
    <div style="margin-bottom:14px">${sticker("Daily games · AI Picks")}</div>
    <h1>NY Daily Digest</h1>
    <p>Take 5 runs twice a day and Millionaire for Life draws nightly — one daily roundup covers them all.</p>
  </div>
</section>
<div class="wrap"><div class="cd-strip">${tiles}</div></div>
<section class="wrap">
  <div class="card-grid" style="margin-top:32px">${list || "<p>First digest coming right after the next drawing.</p>"}</div>
</section>`,
    }));
    urls.push({ path: urlPath, date: digests[0]?.date });
  }

  // ── 홈 ──
  {
    const latest = cards.slice(0, 12).map(postCard).join("");
    const pb = gameById("powerball");
    const stripTiles = ["mega", "nylotto", "take5_eve", "millionaire"]
      .map((id) => countdownTile(gameById(id)))
      .join("");
    writePage("/", layout({
      title: `${SITE.title} — ${SITE.tagline}`,
      description: SITE.description,
      path: "/",
      content: `
<section class="hero">
  <div class="hero-copy">
    <div style="margin-bottom:14px">${sticker("New York · AI Picks")}</div>
    <h1>Fresh AI picks the second the <span class="scribble">drawing</span> ends.</h1>
    <p>We sketch out the most likely number sets for every New York game — Powerball, Mega Millions, NY Lotto, Take 5 and Millionaire for Life — moments after each draw closes.</p>
    <div class="hero-actions">
      ${ctaButton("Get the free app", "lg")}
      ${playBadge()}
    </div>
  </div>
  <div class="hero-side">${countdownTile(pb, "until next Powerball")}</div>
</section>
<div class="wrap"><div class="cd-strip">${stripTiles}</div></div>
<section class="content">${generatorWidget()}</section>
<section class="wrap">
  ${sectionHead("Latest predictions", "updated after every draw")}
  <div class="card-grid">${latest}</div>
</section>
<section class="content">${stickyNote()}</section>
<div class="wrap">${installPanel()}</div>`,
    }));
    urls.push({ path: "/", date: cards[0]?.sortDate });
  }

  // ── 월간 리캡 아카이브 ──
  {
    const urlPath = "/recaps/";
    const list = cards.filter((c) => c.stickerText === "Monthly Recap").map(postCard).join("");
    writePage(urlPath, layout({
      title: `Monthly Recaps — ${SITE.title}`,
      description: "Month-by-month recaps for Powerball, Mega Millions and NY Lotto: every drawing, hot numbers, patterns and the AI scorecard.",
      path: urlPath,
      content: `
<section class="hero">
  <div class="hero-copy">
    <div style="margin-bottom:14px">${sticker("Archive · Month by month")}</div>
    <h1>Monthly recaps</h1>
    <p>Every drawing of the month in one place — hottest numbers, pattern breakdowns and how our AI sets scored.</p>
  </div>
</section>
<section class="wrap">
  <div class="card-grid">${list || "<p>The first monthly recap arrives when the month rolls over.</p>"}</div>
</section>`,
    }));
    urls.push({ path: urlPath });
  }

  // ── 주간 분석 아카이브 ──
  {
    const urlPath = "/analysis/";
    const list = cards.filter((c) => c.stickerText === "Deep Analysis").map(postCard).join("");
    writePage(urlPath, layout({
      title: `Weekly Deep Analysis — Build Your Own Numbers — ${SITE.title}`,
      description: "Weekly deep-dive analysis for Powerball, Mega Millions and NY Lotto: number pools, play-slip patterns, regression trends, momentum and neighbor stats.",
      path: urlPath,
      content: `
<section class="hero">
  <div class="hero-copy">
    <div style="margin-bottom:14px">${sticker("DIY · No picks, just data")}</div>
    <h1>Weekly deep analysis</h1>
    <p>No ready-made picks here — number pools, slip patterns, trend curves and neighbor stats so you can build your own line each week.</p>
  </div>
</section>
<section class="wrap">
  <div class="card-grid">${list || "<p>The first weekly analysis lands with the next drawing.</p>"}</div>
</section>`,
    }));
    urls.push({ path: urlPath });
  }

  // ── 생성기 전용 페이지 ──
  {
    const urlPath = "/generator/";
    writePage(urlPath, layout({
      title: `Free Lottery Number Generator — Powerball, Mega Millions & More — ${SITE.title}`,
      description: "Generate random Powerball, Mega Millions, NY Lotto, Take 5 and Millionaire for Life numbers in your browser — free, no sign-up.",
      path: urlPath,
      content: `
<section class="hero">
  <div class="hero-copy">
    <div style="margin-bottom:14px">${sticker("Free tool · No sign-up")}</div>
    <h1>Lucky number <span class="scribble">generator</span></h1>
    <p>Pick a game and roll a fresh Quick Pick right in your browser. Want the smarter AI strategies? They live in the free app.</p>
  </div>
</section>
<section class="content">${generatorWidget()}</section>
<div class="wrap">${installPanel("Four AI strategies, one tap away.")}</div>`,
    }));
    urls.push({ path: urlPath });
  }

  // ── 티켓 체커 전용 페이지 ──
  {
    const urlPath = "/checker/";
    const sections = [];
    for (const game of GAMES) {
      let latest = null;
      if (game.mode === "post") {
        const p = hubPosts[game.slug][0];
        latest = p ? p.stats.latest : null;
      } else {
        for (const d of digests) {
          const sec = d.sections[game.id];
          if (sec) { latest = sec.stats.latest; break; }
        }
      }
      if (latest) {
        sections.push(`<div class="tool-section">${ticketChecker(game, latest, `${game.name} — ${shortDate(latest.date)} drawing`)}</div>`);
      }
    }
    writePage(urlPath, layout({
      title: `Lottery Ticket Checker — Did I Win? — ${SITE.title}`,
      description: "Check your Powerball, Mega Millions, NY Lotto, Take 5 or Millionaire for Life ticket against the latest winning numbers.",
      path: urlPath,
      content: `
<section class="hero">
  <div class="hero-copy">
    <div style="margin-bottom:14px">${sticker("Free tool · Latest draws")}</div>
    <h1>Did your ticket <span class="scribble">win</span>?</h1>
    <p>Enter your numbers below and check them against the most recent drawing of each New York game.</p>
  </div>
</section>
<section class="content">${sections.join("")}
${stickyNote("Stop checking by hand", "Save your numbers once — the app checks every draw automatically and pings you when you win.", "Get auto win alerts")}
</section>`,
    }));
    urls.push({ path: urlPath });
  }

  // ── 정적 페이지 ──
  for (const page of STATIC_PAGES) {
    const urlPath = `/${page.slug}/`;
    writePage(urlPath, layout({
      title: `${page.title} — ${SITE.title}`,
      description: page.description,
      path: urlPath,
      content: `<div class="page">${page.body}</div>`,
    }));
    urls.push({ path: urlPath });
  }

  // ── assets / robots / sitemap / rss / 404 ──
  fs.mkdirSync(path.join(DIST, "assets"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "assets", "style.css"), path.join(DIST, "assets", "style.css"));
  fs.writeFileSync(
    path.join(DIST, "assets", "favicon.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#FDFBF4"/><path d="M32 8c1.4 9.6 5.6 15 15.2 16.6-9.3 2.6-13.6 7.7-15.2 17-1.7-9.3-5.9-14.4-15.2-17C26.4 23 30.6 17.6 32 8Z" fill="#FFD670" stroke="#3A3F4E" stroke-width="3" stroke-linejoin="round"/></svg>`,
    "utf8"
  );
  fs.writeFileSync(path.join(DIST, ".nojekyll"), "", "utf8");

  const base = SITE.baseUrl.replace(/\/$/, "");
  fs.writeFileSync(
    path.join(DIST, "robots.txt"),
    `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`,
    "utf8"
  );

  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls
      .map(
        (x) =>
          `  <url><loc>${base}${x.path}</loc>${x.date ? `<lastmod>${x.date}</lastmod>` : ""}</url>`
      )
      .join("\n") +
    `\n</urlset>\n`;
  fs.writeFileSync(path.join(DIST, "sitemap.xml"), sitemap, "utf8");

  const rssItems = cards
    .slice(0, 20)
    .map(
      (c) => `  <item>
    <title>${esc(c.title)}</title>
    <link>${base}${c.path}</link>
    <guid>${base}${c.path}</guid>
    <pubDate>${new Date(`${c.sortDate}T23:59:00Z`).toUTCString()}</pubDate>
    <description>${esc(c.excerpt)}</description>
  </item>`
    )
    .join("\n");
  fs.writeFileSync(
    path.join(DIST, "feed.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${esc(SITE.title)}</title>
  <link>${base}/</link>
  <description>${esc(SITE.description)}</description>
  <language>en-us</language>
${rssItems}
</channel></rss>\n`,
    "utf8"
  );

  fs.writeFileSync(
    path.join(DIST, "404.html"),
    layout({
      title: `Page Not Found — ${SITE.title}`,
      description: "Page not found.",
      path: "/404.html",
      content: `<div class="page"><h1>404 — Page not found</h1><p>That page doesn't exist. Head back to the <a href="${u("/")}">latest analysis</a>.</p></div>`,
    }),
    "utf8"
  );

  console.log(`Built ${urls.length} pages → dist/`);
}

main();
