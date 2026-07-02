// 문장 로테이션 풀 — 시드 고정 선택이라 같은 글은 재빌드해도 문구가 안 바뀌고,
// 회차·게임이 다르면 다른 변형이 뽑혀 글마다 표현이 달라진다.

function hashSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function prosePicker(seedStr) {
  let state = hashSeed(seedStr);
  return function pick(pool) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return pool[state % pool.length];
  };
}

// {g}=game name, {date}=next draw long date, {n}=window size
export const POOLS = {
  intro: [
    "The numbers are in, and our models have already crunched them. Here is the full breakdown ahead of the {g} drawing on {date}.",
    "Another {g} draw is behind us — time to reset the charts and look forward. Below is our data-driven preview of the {date} drawing.",
    "If you are picking your {g} lines for {date}, start here: fresh frequency charts, overdue alerts and five AI-generated sets.",
    "Our AI engine has re-run its full analysis after the latest {g} results. Here is what the data says heading into {date}.",
  ],
  recap: [
    "First, a quick look back at the most recent winning line:",
    "Before looking ahead, here is the latest result at a glance:",
    "As always, we start with the numbers that just hit:",
  ],
  hot: [
    "Over the last {n} draws, these numbers have shown up more often than any others. Streaks never last forever, but hot numbers are where frequency players start:",
    "These are the workhorses of the last {n} drawings — the numbers the machine keeps spitting out:",
    "Frequency first. Across the past {n} draws, this group has dominated the board:",
  ],
  cold: [
    "At the other end of the chart, these numbers have gone quiet. Due-number players watch this list closely:",
    "Every draw pool has its sleepers. These numbers have been absent the longest:",
    "Cold does not mean dead — it means overdue, at least in theory. The longest droughts right now:",
  ],
  patterns: [
    "Structure matters as much as individual numbers. Here is how recent draws have been shaped:",
    "Beyond single numbers, the shape of winning lines has been remarkably consistent:",
    "Zooming out, the recent draws share some clear structural tendencies:",
  ],
  predictionsLead: [
    "Putting it all together, our engine generated the following sets for {date}. Each one follows a different strategy, so pick the philosophy that suits you:",
    "Here are this draw's AI-generated lines. Five sets, five different logics — hot chasing, balance, overdue hunting, pattern mirroring and one pure wildcard:",
    "Our model blended the stats above into the following candidate lines for {date}:",
  ],
  outro: [
    "Want fresh sets like these on your phone the moment results drop? The free {app} app runs this same engine for every NY game, checks your saved tickets automatically, and pings you when you win.",
    "These picks update after every single draw. To get them instantly — plus automatic ticket checking and win alerts — grab the free {app} app below.",
    "If you play regularly, let the app do the heavy lifting: live results, AI number generation and automatic winning-ticket alerts, all free in {app}.",
  ],
};
