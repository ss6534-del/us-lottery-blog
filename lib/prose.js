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

  // ── 조건부 코멘트 (실데이터 조건이 맞을 때만 삽입) ──
  insightSumHigh: [
    "This was a top-heavy draw — the line summed to {sum}, well above the recent average of {avg}.",
    "Notably, the numbers ran high: a total of {sum} against a typical {avg}.",
  ],
  insightSumLow: [
    "The draw skewed low this time, summing to just {sum} versus a recent average of {avg}.",
    "A bottom-heavy result — the line added up to only {sum}, where {avg} is typical.",
  ],
  insightOddExtreme: [
    "An unusual shape too: {odd} of the {c} numbers came out odd — splits this lopsided are rare.",
    "The odd/even balance broke hard this draw ({odd} odd of {c}), which doesn't happen often.",
  ],
  insightRepeat: [
    "{nums} carried straight over from the previous drawing — repeat numbers strike again.",
    "Watch the carry-over: {nums} appeared in back-to-back draws.",
  ],
  insightConsec: [
    "The draw also produced a consecutive pair ({pair}), a pattern that shows up more often than most players expect.",
    "There it is again — a back-to-back pair ({pair}) landed in this line.",
  ],
  insightDrought: [
    "And {num} finally woke up, ending a {gap}-draw drought.",
    "Overdue watchers got paid: {num} showed for the first time in {gap} draws.",
  ],
  insightHot: [
    "Meanwhile {num} keeps rolling — it's one of the hottest numbers of the current window.",
    "No cooling off for {num}, which hit yet again.",
  ],

  // ── 주간 심층 분석 글 ──
  analysisIntro: [
    "This is our weekly deep-dive for {g} — no ready-made picks here, just the raw analysis so you can build your own line. We break down the number pools, the play-slip pattern, the trend curve and the neighbor effect below.",
    "Prefer to pick your own numbers? This weekly {g} workshop lays out everything the data says — pools, positions, momentum and neighbors — and leaves the combining to you.",
    "Welcome to the {g} builder's report: a week's worth of pattern data, organized so you can assemble your own line instead of taking anyone's picks.",
  ],
  analysisPools: [
    "A solid starting recipe from the data: take two numbers from the hot pool, two from the middle pool, and one overdue swing pick — then sanity-check the line against the checklist at the end.",
    "The classic build: 2 hot + 2 middle + 1 overdue. Draft from the pools below, then run your line through the checklist before you play it.",
  ],
  analysisOutro: [
    "That's the full workbench. Combine carefully, keep the checklist handy — and if you'd rather have this done for you, the app assembles five strategy lines from this exact data after every draw.",
    "Everything above updates weekly as draws come in. Build your line, check it twice — or let the app's AI do the assembling while you just play.",
  ],
};

// ── 이변 탐지 뉴스 글 (kind:"news") ──────────────────────────────────────────
// 변수: {g}=게임명 {n}=윈도 크기 {c}=번호 개수 {hot}=핫 3 {app}=앱 이름
//       + 이변별 수치({num} {gap} {record} {nums} {count} {parity} {sum} {dir}
//         {prevExtreme} {avg} {pairs})
// 금칙어(win/odds/guaranteed/jackpot 등)는 쓰지 않는다.
export const NEWS = {
  intro: {
    "long-absence": [
      "Our tracker flagged something in the latest {g} draw: number {num} has now sat out {gap} drawings in a row — the longest absence anywhere in our {n}-draw window.",
      "Every so often a number simply stops showing up. In {g}, that number is {num}, and it has now missed {gap} consecutive draws.",
      "The {g} board has a new record holder for silence. Number {num} has gone {gap} straight drawings without an appearance.",
    ],
    "repeat-number": [
      "The latest {g} draw did something the charts rarely see: {nums} came straight back from the previous drawing.",
      "Carry-over alert. {count} numbers — {nums} — landed in back-to-back {g} drawings.",
      "Most draws share nothing with the one before. This {g} line shares {count}: {nums}.",
    ],
    "parity-extreme": [
      "The newest {g} line came out with no balance at all — all {c} numbers landed {parity}.",
      "One of the rarer shapes just turned up in {g}: a line where every single number is {parity}.",
      "The {g} machine skipped half the pool this draw. All {c} numbers came in {parity}.",
    ],
    "sum-extreme": [
      "Add up the latest {g} line and you get {sum} — the {dir} total anywhere in our {n}-draw window.",
      "The {g} numbers pushed to an extreme this draw: a line total of {sum}, the {dir} we have on record for this window.",
      "Line totals usually cluster in a comfortable band. The newest {g} draw broke out of it with a {dir}-ever {sum}.",
    ],
    "consecutive-pair": [
      "The latest {g} line packed {count} consecutive pairs into a single draw: {pairs}.",
      "Back-to-back numbers are common enough. {count} pairs in one {g} line — {pairs} — is not.",
      "The {g} machine drew neighbors twice over this time: {pairs}, {count} consecutive pairs in one line.",
    ],
  },
  fact: {
    "long-absence": [
      "For scale: the longest completed drought inside the same window was {record} draws. At {gap}, number {num} has now pushed past everything we had measured.",
      "Before this run, no gap in the {n}-draw sample had stretched beyond {record} drawings. Number {num} just moved the ceiling to {gap}.",
      "The previous record in this window was a {record}-draw absence. Number {num} is at {gap} and still counting.",
    ],
    "repeat-number": [
      "Across our window, back-to-back draws typically share one number at most. An overlap of {count} sits well clear of that baseline.",
      "One repeat between drawings is routine. {count} in a single transition — {nums} — is measurably less common.",
      "Repeats happen often enough that we track them every post. Seeing {count} at once ({nums}) is the part worth noting.",
    ],
    "parity-extreme": [
      "Mixed lines dominate the record — the odd/even split almost always sits near the middle. A uniform all-{parity} line lives in the thin tail of that distribution.",
      "Across recent {g} draws the split clusters around the halfway mark. A line with all {c} numbers {parity} is the far edge of the range.",
      "The balanced splits do the heavy lifting draw after draw. Every number arriving {parity} is the exception, not the drift.",
    ],
    "sum-extreme": [
      "Recent {g} lines have averaged {avg}, and the previous {dir} total in the window was {prevExtreme}. This draw's {sum} extends the range outright.",
      "For context: the window average sits at {avg}, and {prevExtreme} was the old {dir} mark. The new line registers {sum}.",
      "Totals in this window average {avg}. The prior {dir} extreme was {prevExtreme} — until this {sum} landed.",
    ],
    "consecutive-pair": [
      "A single consecutive pair turns up in a healthy share of draws. Two or more in the same line pushes the result into the tail of the shape distribution.",
      "The usual expectation is zero or one adjacent pair per line. Logging {count} at once ({pairs}) is a clear structural outlier.",
      "One pair is unremarkable — we mention it in most posts. {count} pairs in one line is why this draw got its own entry.",
    ],
  },
  context: [
    "The usual reminder applies, and it matters most on days like this: draws are independent. A streak, a gap or an odd shape says nothing about what the next drawing will do. We log these because they describe the data, not because they change it.",
    "Worth saying plainly: none of this makes anything \"due\". Every drawing starts from scratch, and no gap or pattern carries over. This entry documents an extreme in the dataset — that's all it is.",
    "Standard caveat — every draw is random and independent. Records like this one describe where the data has been, never where it is going. Treat it as a curiosity, not a signal.",
  ],
  outro: [
    "The regular draw-by-draw analysis continues as always. Want the charts and fresh sets on your phone the moment results drop? The free {app} app runs the same engine for every New York game.",
    "That's the entry. For the standing frequency and overdue tables, see our regular posts — or carry them around in the free {app} app, which also checks your saved tickets automatically.",
    "Filed and logged. {app} keeps live results, pattern views and automatic ticket checking within reach — free on Google Play.",
  ],
};
