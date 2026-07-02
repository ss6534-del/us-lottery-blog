// ── Site-wide configuration (single source of truth) ─────────────────────────
//
// After creating the GitHub repo, set `baseUrl` to your GitHub Pages URL:
//   https://<username>.github.io/<repo-name>
// (No trailing slash. If you later attach a custom domain, just change it here.)

export const SITE = {
  title: "AI Lottery Hub",
  tagline: "AI-Powered US Lottery Analysis & Predictions",
  description:
    "Free AI-driven analysis for Powerball, Mega Millions, NY Lotto, Take 5 and " +
    "Millionaire for Life. Hot & cold numbers, pattern stats and predicted sets, " +
    "updated automatically after every draw.",
  baseUrl: "https://ss6534-del.github.io/us-lottery-blog",
  language: "en",
  appName: "AI Lottery Hub",
  appUrl:
    "https://play.google.com/store/apps/details?id=appfactory.US.lottery.usailottery",
  playBadge:
    "https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png",
  analysisWindow: 50, // 최근 N회차 기준 통계
};

// ── Game registry ─────────────────────────────────────────────────────────────
// mode: "post"   → 회차마다 개별 분석 글 (빅3)
// mode: "digest" → 하루 1건 NY Daily Digest에 섹션으로 포함
export const GAMES = [
  {
    id: "powerball",
    slug: "powerball",
    name: "Powerball",
    mode: "post",
    api: "https://data.ny.gov/resource/d6yy-54nr.json",
    whiteField: "winning_numbers",
    specialSource: "lastOfWhite", // winning_numbers 마지막 숫자가 Powerball
    specialField: null,
    specialName: "Powerball",
    whiteCount: 5,
    whiteMax: 69,
    specialMax: 26,
    drawWeekdays: [1, 3, 6], // 1=Mon … 7=Sun (ET 기준)
    drawTimeEt: "10:59 PM ET",
    color: "#d0021b",
    colorDark: "#8f0113",
  },
  {
    id: "mega",
    slug: "mega-millions",
    name: "Mega Millions",
    mode: "post",
    api: "https://data.ny.gov/resource/5xaw-6ayf.json",
    whiteField: "winning_numbers",
    specialSource: "field",
    specialField: "mega_ball",
    specialName: "Mega Ball",
    whiteCount: 5,
    whiteMax: 70,
    specialMax: 25,
    drawWeekdays: [2, 5], // Tue, Fri
    drawTimeEt: "11:00 PM ET",
    color: "#1751a5",
    colorDark: "#0e3268",
  },
  {
    id: "nylotto",
    slug: "ny-lotto",
    name: "NY Lotto",
    mode: "post",
    api: "https://data.ny.gov/resource/6nbc-h7bj.json",
    whiteField: "winning_numbers",
    specialSource: "field",
    specialField: "bonus",
    specialName: "Bonus",
    whiteCount: 6,
    whiteMax: 59,
    specialMax: 59,
    drawWeekdays: [3, 6], // Wed, Sat
    drawTimeEt: "8:15 PM ET",
    color: "#0f7b3a",
    colorDark: "#095226",
  },
  {
    id: "take5_mid",
    slug: "take-5-midday",
    name: "Take 5 Midday",
    mode: "digest",
    api: "https://data.ny.gov/resource/dg63-4siq.json",
    whiteField: "midday_winning_numbers",
    specialSource: "none",
    specialField: null,
    specialName: null,
    whiteCount: 5,
    whiteMax: 39,
    specialMax: 0,
    drawWeekdays: [1, 2, 3, 4, 5, 6, 7],
    drawTimeEt: "2:30 PM ET",
    color: "#6a35b8",
    colorDark: "#472278",
  },
  {
    id: "take5_eve",
    slug: "take-5-evening",
    name: "Take 5 Evening",
    mode: "digest",
    api: "https://data.ny.gov/resource/dg63-4siq.json",
    whiteField: "evening_winning_numbers",
    specialSource: "none",
    specialField: null,
    specialName: null,
    whiteCount: 5,
    whiteMax: 39,
    specialMax: 0,
    drawWeekdays: [1, 2, 3, 4, 5, 6, 7],
    drawTimeEt: "10:30 PM ET",
    color: "#6a35b8",
    colorDark: "#472278",
  },
  {
    id: "millionaire",
    slug: "millionaire-for-life",
    name: "Millionaire for Life",
    mode: "digest",
    api: "https://data.ny.gov/resource/a4w9-a3tp.json",
    whiteField: "winning_numbers",
    specialSource: "field",
    specialField: "mill_ball",
    specialName: "Millionaire Ball",
    whiteCount: 5,
    whiteMax: 58,
    specialMax: 5,
    drawWeekdays: [1, 2, 3, 4, 5, 6, 7],
    drawTimeEt: "11:15 PM ET",
    color: "#0d8a80",
    colorDark: "#085a54",
  },
];

export const DIGEST = {
  slug: "ny-daily",
  name: "NY Daily Digest",
  title: "NY Take 5 & Millionaire for Life — Daily Results & Predictions",
  color: "#6a35b8",
  colorDark: "#472278",
  gameIds: ["take5_mid", "take5_eve", "millionaire"],
};

export function gameById(id) {
  const g = GAMES.find((g) => g.id === id);
  if (!g) throw new Error(`Unknown game id: ${id}`);
  return g;
}
