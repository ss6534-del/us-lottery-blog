// Read the same public results documents as UK Lotto AI. Their updater scrapes
// the three lottery.co.uk archives below and timestamps each Firestore snapshot.
const API = "https://firestore.googleapis.com/v1/projects/uk-app-16abb/databases/(default)/documents/lotto_results";
const FIRST_TWO_ROUND_DRAW = "2026-06-10";

export const UK_GAMES = {
  lotto: {
    name: "Lotto", document: "latest_lotto", sourceUrl: "https://www.lottery.co.uk/lotto/results/past",
    mainCount: 6, mainMax: 59, bonusCount: 1, bonusMax: 59, weekdays: [3, 6], drawTime: "20:00",
  },
  euromillions: {
    name: "EuroMillions", document: "latest_euroMillions", sourceUrl: "https://www.lottery.co.uk/euromillions/results/past",
    mainCount: 5, mainMax: 50, bonusCount: 2, bonusMax: 12, weekdays: [2, 5], drawTime: "20:45",
  },
  thunderball: {
    name: "Thunderball", document: "latest_thunderball", sourceUrl: "https://www.lottery.co.uk/thunderball/results/past",
    mainCount: 5, mainMax: 39, bonusCount: 1, bonusMax: 14, weekdays: [2, 3, 5, 6], drawTime: "20:00",
  },
};

const months = "january february march april may june july august september october november december".split(" ");
const weekdays = "sunday monday tuesday wednesday thursday friday saturday".split(" ");
const londonClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});

function londonDateTime(instant) {
  const parts = Object.fromEntries(londonClock.formatToParts(instant).map(({ type, value }) => [type, value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

function namedIndex(names, word) {
  const lower = word.toLowerCase();
  return names.findIndex(name => lower === name || lower === name.slice(0, 3));
}

function drawDate(text, anchor, game) {
  const match = /^(?:([a-z]+)\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/i.exec(text?.trim());
  if (!match) throw new Error("Missing or unrecognised UK draw date");
  const [, weekday, day, monthName, explicitYear] = match;
  const month = namedIndex(months, monthName) + 1;
  if (!month || (!explicitYear && !anchor)) throw new Error(`Cannot date UK draw: ${text}`);
  const monthDay = `${String(month).padStart(2, "0")}-${day.padStart(2, "0")}`;
  let year = Number(explicitYear ?? anchor?.slice(0, 4));
  if (!explicitYear) {
    // The source covers six months. Choose the neighbouring year at New Year,
    // allowing an upcoming placeholder to be removed by the publication cutoff.
    const dayOffset = (Date.UTC(year, month - 1, Number(day)) - Date.parse(anchor)) / 86_400_000;
    if (dayOffset > 184) year--;
    if (dayOffset < -184) year++;
  }
  const date = `${year}-${monthDay}`;
  const utc = new Date(Date.UTC(year, month - 1, Number(day)));
  if (utc.toISOString().slice(0, 10) !== date || !game.weekdays.includes(utc.getUTCDay()) ||
      (weekday && namedIndex(weekdays, weekday) !== utc.getUTCDay())) {
    throw new Error(`Invalid draw date for ${game.name}: ${text}`);
  }
  return date;
}

function fieldValue(field) {
  return field?.stringValue ?? field?.integerValue;
}

function arrayValues(field) {
  const values = field?.arrayValue?.values;
  return Array.isArray(values) ? values.map(fieldValue) : [];
}

function balls(values, count, max, label) {
  if (values.length !== count || values.some(value => !/^\d{1,2}$/.test(value))) {
    throw new Error(`Incomplete or malformed ${label}`);
  }
  const numbers = values.map(Number);
  if (new Set(numbers).size !== count || numbers.some(number => number < 1 || number > max)) {
    throw new Error(`Invalid numbers in ${label}`);
  }
  return numbers.sort((a, b) => a - b);
}

function round(game, mainField, bonusValues, label) {
  const numbers = balls(arrayValues(mainField), game.mainCount, game.mainMax, `${label} main balls`);
  const bonus = balls(bonusValues, game.bonusCount, game.bonusMax, `${label} bonus balls`);
  if (game === UK_GAMES.lotto && numbers.includes(bonus[0])) throw new Error(`Repeated Lotto bonus in ${label}`);
  return { numbers, bonus };
}

function readDraw(id, fields, date) {
  const game = UK_GAMES[id];
  const label = `${game.name} ${date}`;
  const printedBonus = fieldValue(fields.bonus_number);
  let bonusValues = [printedBonus];
  if (id === "euromillions") {
    const textValues = typeof printedBonus === "string" ? printedBonus.split(",").map(value => value.trim()) : [];
    bonusValues = fields.lucky_stars_list ? arrayValues(fields.lucky_stars_list) : textValues;
    if (fields.lucky_stars_list && printedBonus !== undefined) {
      const printed = balls(textValues, game.bonusCount, game.bonusMax, `${label} printed stars`);
      const listed = balls(bonusValues, game.bonusCount, game.bonusMax, `${label} listed stars`);
      if (printed.join() !== listed.join()) throw new Error(`Conflicting Lucky Stars for ${label}`);
    }
  }
  const [year, month, day] = date.split("-");
  const sourceUrl = new URL(`../results-${day}-${month}-${year}`, game.sourceUrl).href;
  const draw = { game: id, date, ...round(game, fields.numbers, bonusValues, label), sourceUrl };
  if (id === "lotto" && date >= FIRST_TWO_ROUND_DRAW) {
    draw.round2 = round(game, fields.round2_numbers, [fieldValue(fields.round2_bonus)], `${label} round 2`);
  } else if (fields.round2_numbers || fields.round2_bonus) {
    throw new Error(`Unexpected second round for ${label}`);
  }
  return draw;
}

function gameConfig(id) {
  if (!Object.hasOwn(UK_GAMES, id)) throw new Error(`Unknown UK game: ${id}`);
  return UK_GAMES[id];
}

export function normaliseUkDraws(id, document, { now = new Date() } = {}) {
  const game = gameConfig(id);
  const rows = document?.fields?.history?.arrayValue?.values;
  if (!Array.isArray(rows) || !rows.length) throw new Error(`Missing Firestore history for ${game.name}`);
  const timestamp = document.fields.last_updated?.timestampValue ?? document.updateTime;
  const updated = timestamp ? new Date(timestamp) : null;
  if (updated && !Number.isFinite(updated.getTime())) throw new Error(`Invalid snapshot timestamp for ${game.name}`);
  const anchor = updated ? londonDateTime(updated).date : null;
  const cutoff = londonDateTime(updated ? Math.min(new Date(now).getTime(), updated.getTime()) : new Date(now));
  const byDate = new Map();
  for (const row of rows) {
    const fields = row?.mapValue?.fields;
    const date = drawDate(fields?.draw_date?.stringValue, anchor, game);
    if (date > cutoff.date || (date === cutoff.date && cutoff.time < game.drawTime)) continue;
    const draw = readDraw(id, fields, date);
    const existing = byDate.get(date);
    if (existing && JSON.stringify(existing) !== JSON.stringify(draw)) {
      throw new Error(`Conflicting results for ${game.name} ${date}`);
    }
    byDate.set(date, draw);
  }
  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export async function fetchUkDraws(id, { now = new Date(), fetchImpl = fetch } = {}) {
  const game = gameConfig(id);
  const response = await fetchImpl(`${API}/${game.document}`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Firestore HTTP ${response.status} for ${game.name}`);
  return normaliseUkDraws(id, await response.json(), { now });
}
