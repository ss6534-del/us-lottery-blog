// data/의 게시글 JSON → dist/ 정적 사이트 렌더링.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, GAMES, DIGEST, gameById } from "../site.config.js";
import { longDate } from "../lib/soda.js";
import { layout, renderPostBody, renderDigestBody, postCard, u, esc } from "../lib/html.js";
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

function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const urls = []; // sitemap용
  const cards = []; // 홈/피드용 {path,color,gameName,title,excerpt,sortDate}

  // ── 빅3 개별 포스트 ──
  const hubPosts = {}; // slug → posts[]
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
        color: game.color,
        gameName: game.name,
        title: post.title,
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
    cards.push({
      path: urlPath,
      color: DIGEST.color,
      gameName: DIGEST.name,
      title: digest.title,
      excerpt: digest.intro,
      sortDate: digest.date,
      sortKey: `${digest.date}~digest`,
    });
  }

  cards.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  // ── 게임 허브 페이지 ──
  for (const game of GAMES.filter((g) => g.mode === "post")) {
    const posts = hubPosts[game.slug];
    const urlPath = `/${game.slug}/`;
    const list = posts
      .map((p) =>
        postCard({
          path: `/${game.slug}/${p.targetDate}/`,
          color: game.color,
          gameName: game.name,
          title: p.title,
          excerpt: p.prose.intro,
          sortDate: p.publishedDate,
        })
      )
      .join("");
    writePage(urlPath, layout({
      title: `${game.name} Predictions & Analysis — ${SITE.title}`,
      description: `Every ${game.name} drawing analyzed: hot & cold numbers, pattern stats and AI predicted sets, updated automatically after each draw.`,
      path: urlPath,
      content: `
<div class="home-intro">
  <h1>${esc(game.name)} — Predictions &amp; Analysis</h1>
  <p>Fresh analysis after every drawing (${esc(game.drawTimeEt)}). Newest first.</p>
</div>
<div class="card-grid">${list || "<p>First analysis coming right after the next drawing.</p>"}</div>`,
    }));
    urls.push({ path: urlPath, date: posts[0]?.publishedDate });
  }

  // ── 다이제스트 허브 ──
  {
    const urlPath = `/${DIGEST.slug}/`;
    const list = digests
      .map((d) =>
        postCard({
          path: `/${DIGEST.slug}/${d.date}/`,
          color: DIGEST.color,
          gameName: DIGEST.name,
          title: d.title,
          excerpt: d.intro,
          sortDate: d.date,
        })
      )
      .join("");
    writePage(urlPath, layout({
      title: `NY Daily Digest — Take 5 & Millionaire for Life — ${SITE.title}`,
      description: "Daily results and AI picks for NY Take 5 (midday & evening) and Millionaire for Life.",
      path: urlPath,
      content: `
<div class="home-intro">
  <h1>NY Daily Digest</h1>
  <p>Take 5 runs twice a day and Millionaire for Life draws nightly — one daily roundup covers them all.</p>
</div>
<div class="card-grid">${list || "<p>First digest coming right after the next drawing.</p>"}</div>`,
    }));
    urls.push({ path: urlPath, date: digests[0]?.date });
  }

  // ── 홈 ──
  {
    const latest = cards.slice(0, 12).map(postCard).join("");
    writePage("/", layout({
      title: `${SITE.title} — ${SITE.tagline}`,
      description: SITE.description,
      path: "/",
      content: `
<div class="home-intro">
  <h1>${esc(SITE.tagline)}</h1>
  <p>${esc(SITE.description)}</p>
</div>
<div class="card-grid">${latest}</div>`,
    }));
    urls.push({ path: "/", date: cards[0]?.sortDate });
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
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#1751a5"/><circle cx="32" cy="32" r="18" fill="#fff"/><text x="32" y="40" font-family="system-ui,sans-serif" font-size="22" font-weight="800" text-anchor="middle" fill="#1751a5">7</text></svg>`,
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
      content: `<div class="page"><h1>404 — Page Not Found</h1><p>That page doesn't exist. Head back to the <a href="${u("/")}">latest analysis</a>.</p></div>`,
    }),
    "utf8"
  );

  console.log(`Built ${urls.length} pages → dist/`);
}

main();
