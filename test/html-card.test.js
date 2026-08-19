import test from "node:test";
import assert from "node:assert/strict";
import { postCard } from "../lib/html.js";

const BASE_CARD = {
  path: "/powerball/2026-08-19/",
  gameKey: "powerball",
  gameName: "Powerball",
  title: "Powerball Predictions",
  dateLabel: "Aug 17",
  metaText: "AI picks for Aug 19",
  numbers: [23, 40, 49, 65, 69],
  special: 23,
};

test("postCard keeps the number thumbnail by default", () => {
  const html = postCard(BASE_CARD);

  assert.match(html, /class="a-card"/);
  assert.match(html, /class="ball-row"/);
  assert.doesNotMatch(html, /a-thumb--image/);
});

test("postCard renders an existing OG image only when explicitly requested", () => {
  const html = postCard({
    ...BASE_CARD,
    showImage: true,
    ogImageFile: "powerball-2026-08-19.jpg",
  });

  assert.match(html, /class="a-card a-card--image"/);
  assert.match(html, /src="@@\/og\/powerball-2026-08-19\.jpg"/);
  assert.match(html, /width="1344" height="768" loading="lazy" decoding="async"/);
  assert.doesNotMatch(html, /class="ball-row"/);
});

test("postCard falls back to numbers when the OG image is unavailable", () => {
  const html = postCard({ ...BASE_CARD, showImage: true, ogImageFile: null });

  assert.match(html, /class="ball-row"/);
  assert.doesNotMatch(html, /a-thumb--image/);
});
