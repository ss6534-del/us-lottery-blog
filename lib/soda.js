// NY Open Data (SODA) fetch + parsing.
// 앱(ai_lottery_hub)과 동일한 데이터셋·필드 규칙을 사용한다.

/** 해당 게임의 최근 회차들을 최신순으로 가져와 {date, white[], special} 배열로 반환. */
export async function fetchDraws(game, limit = 60) {
  const select = [game.whiteField];
  if (game.specialSource === "field") select.push(game.specialField);
  const where = encodeURIComponent(`${game.whiteField} IS NOT NULL`);
  const url =
    `${game.api}?$select=draw_date,${select.join(",")}` +
    `&$where=${where}&$order=draw_date DESC&$limit=${limit}`;

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`SODA HTTP ${res.status} for ${game.id}`);
  const rows = await res.json();
  if (!Array.isArray(rows)) throw new Error(`SODA bad payload for ${game.id}`);

  const draws = [];
  for (const row of rows) {
    const parsed = parseRow(game, row);
    if (parsed) draws.push(parsed);
  }
  return draws; // 최신순 (draws[0] = latest)
}

function parseRow(game, row) {
  const raw = row[game.whiteField];
  if (!raw || !row.draw_date) return null;
  const nums = String(raw)
    .trim()
    .split(/\s+/)
    .map((s) => parseInt(s, 10))
    .filter((n) => Number.isFinite(n));

  let white = nums;
  let special = null;

  if (game.specialSource === "lastOfWhite") {
    if (nums.length !== game.whiteCount + 1) return null;
    white = nums.slice(0, game.whiteCount);
    special = nums[game.whiteCount];
  } else if (game.specialSource === "field") {
    if (nums.length !== game.whiteCount) return null;
    const sp = parseInt(row[game.specialField], 10);
    if (!Number.isFinite(sp)) return null;
    special = sp;
  } else {
    if (nums.length !== game.whiteCount) return null;
  }

  // sanity check — 범위를 벗어난 데이터는 버린다
  if (white.some((n) => n < 1 || n > game.whiteMax)) return null;
  if (special !== null && (special < 1 || special > game.specialMax)) return null;

  return {
    date: String(row.draw_date).slice(0, 10), // YYYY-MM-DD
    white,
    special,
  };
}

// ── 날짜 유틸 ────────────────────────────────────────────────────────────────

const WEEKDAY_FROM_UTC = [7, 1, 2, 3, 4, 5, 6]; // getUTCDay(0=Sun) → 1=Mon…7=Sun

/** "YYYY-MM-DD"의 요일 (1=Mon … 7=Sun). draw_date는 날짜만 쓰므로 UTC로 계산해도 안전. */
export function weekdayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return WEEKDAY_FROM_UTC[d.getUTCDay()];
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 직전 결과일 이후의 다음 추첨일 (해당 게임 요일 스케줄 기준). */
export function nextDrawDate(game, afterDateStr) {
  let d = addDays(afterDateStr, 1);
  for (let i = 0; i < 8; i++) {
    if (game.drawWeekdays.includes(weekdayOf(d))) return d;
    d = addDays(d, 1);
  }
  throw new Error(`No draw weekday found for ${game.id}`);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];

/** "2026-07-05" → "July 5, 2026" */
export function longDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "2026-07-05" → "Sunday, July 5, 2026" */
export function longDateWithDay(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${DAYS[d.getUTCDay()]}, ${longDate(dateStr)}`;
}
