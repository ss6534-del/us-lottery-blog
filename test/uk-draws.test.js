import test from "node:test";
import assert from "node:assert/strict";
import { fetchUkDraws, normaliseUkDraws } from "../lib/uk-draws.js";

function firestoreValue(value) {
  if (Array.isArray(value)) return { arrayValue: { values: value.map(firestoreValue) } };
  if (typeof value === "object") {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, firestoreValue(v)])) } };
  }
  return { stringValue: String(value) };
}

const updated = "2026-11-21T23:15:03.55Z";
function snapshot(rows, timestamp = updated) {
  const fields = { history: firestoreValue(rows) };
  if (timestamp) fields.last_updated = { timestampValue: timestamp };
  return { fields };
}

// Field names, ordinal dates and values from the public UK Lotto AI documents.
const lotto = {
  draw_date: "Saturday 21st November 2026", numbers: [9, 29, 30, 42, 45, 46], bonus_number: 3,
  round2_numbers: [6, 20, 45, 56, 58, 59], round2_bonus: 12,
};
const euro = {
  draw_date: "Friday 20th Nov 2026", numbers: [8, 21, 24, 36, 49],
  bonus_number: "1, 8", lucky_stars_list: ["01", "08"],
};
const thunder = { draw_date: "Saturday 21st November 2026", numbers: [15, 28, 31, 32, 36], bonus_number: 10 };
const parse = (game, rows) => normaliseUkDraws(game, snapshot(rows), { now: new Date(updated) });

test("UK feed reads both rounds, both Lucky Stars, and the Thunderball from their own pools", () => {
  assert.deepEqual(parse("lotto", [lotto]), [{
    game: "lotto", date: "2026-11-21", numbers: lotto.numbers, bonus: [3],
    sourceUrl: "https://www.lottery.co.uk/lotto/results-21-11-2026", round2: { numbers: lotto.round2_numbers, bonus: [12] },
  }]);
  const [euroDraw] = parse("euromillions", [euro]);
  assert.deepEqual(euroDraw.bonus, [1, 8]);
  assert.equal(euroDraw.sourceUrl, "https://www.lottery.co.uk/euromillions/results-20-11-2026");
  const [thunderDraw] = parse("thunderball", [thunder]);
  assert.deepEqual(thunderDraw.bonus, [10]);
  assert.equal(thunderDraw.sourceUrl, "https://www.lottery.co.uk/thunderball/results-21-11-2026");
  assert.deepEqual(parse("thunderball", [{ ...thunder, numbers: [10, 11, 12, 13, 14] }])[0].bonus, [10]);
  const { lucky_stars_list, ...legacy } = euro;
  assert.deepEqual(parse("euromillions", [legacy])[0].bonus, [1, 8]);
});

test("the last single-round UK Lotto draw and first two-round draw use their respective formats", () => {
  const lastSingle = { draw_date: "Saturday 6th June 2026", numbers: [8, 10, 26, 30, 35, 42], bonus_number: 50 };
  const [single] = parse("lotto", [lastSingle]);
  assert.ok(!Object.hasOwn(single, "round2"));
  assert.equal(single.sourceUrl, "https://www.lottery.co.uk/lotto/results-06-06-2026");
  const firstDouble = {
    draw_date: "Wednesday 10th June 2026", numbers: [1, 12, 25, 29, 40, 41], bonus_number: 16,
    round2_numbers: [2, 5, 12, 42, 47, 54], round2_bonus: 51,
  };
  assert.deepEqual(parse("lotto", [lastSingle, firstDouble]).map(draw => draw.date), ["2026-06-10", "2026-06-06"]);
  assert.throws(() => parse("lotto", [{ ...lastSingle, draw_date: firstDouble.draw_date }]), /round 2/);
});

test("UK feed rejects incomplete, duplicated, out-of-range or conflicting balls", () => {
  for (const [id, invalid] of [
    ["lotto", { ...lotto, bonus_number: 45 }],
    ["lotto", { ...lotto, round2_bonus: 59 }],
    ["lotto", { ...lotto, round2_numbers: [6, 20, 45, 56, 58] }],
    ["lotto", { ...lotto, numbers: [9, 29, 30, 42, 45, 60] }],
    ["euromillions", { ...euro, bonus_number: "1, 7" }],
    ["euromillions", { ...euro, bonus_number: "8, 8", lucky_stars_list: [8, 8] }],
    ["euromillions", { ...euro, bonus_number: "1, 13", lucky_stars_list: [1, 13] }],
    ["thunderball", { ...thunder, numbers: [15, 28, 31, 32, 32] }],
    ["thunderball", { ...thunder, bonus_number: "10 pending" }],
    ["thunderball", { ...thunder, bonus_number: 15 }],
  ]) assert.throws(() => parse(id, [invalid]), /balls|stars|Lotto bonus|Lucky Stars/);
});

test("yearless dates use the source update time across New Year, including an upcoming placeholder", () => {
  const document = snapshot([
    { ...thunder, draw_date: "Wednesday 30th December" },
    { draw_date: "Friday 1st January" },
  ], null);
  document.updateTime = "2026-12-31T23:15:03Z";
  const now = new Date("2028-01-01T12:00:00Z");
  assert.deepEqual(normaliseUkDraws("thunderball", document, { now }).map(draw => draw.date), ["2026-12-30"]);
  document.updateTime = "2027-01-01T08:00:00Z";
  assert.equal(normaliseUkDraws("thunderball", document, { now })[0].date, "2026-12-30");
  delete document.updateTime;
  assert.throws(() => normaliseUkDraws("thunderball", document, { now }), /Cannot date/);
});

test("the publication cutoff follows London summer time and winter time", () => {
  for (const [date, before, at] of [
    ["Friday 19th June 2026", "2026-06-19T19:44Z", "2026-06-19T19:45Z"],
    [euro.draw_date, "2026-11-20T20:44Z", "2026-11-20T20:45Z"],
  ]) {
    const document = snapshot([{ ...euro, draw_date: date }]);
    assert.deepEqual(normaliseUkDraws("euromillions", document, { now: new Date(before) }), []);
    assert.equal(normaliseUkDraws("euromillions", document, { now: new Date(at) }).length, 1);
  }
  assert.deepEqual(parse("lotto", [{ draw_date: "Wednesday 25th November 2026" }]), []);
});

test("UK feed rejects bad dates and contradictory duplicates while coalescing identical results", () => {
  for (const date of ["Unknown Date", "Friday 21st November 2026", "Thursday 19th November 2026", "31st Nov 2026"]) {
    assert.throws(() => parse("thunderball", [{ ...thunder, draw_date: date }]), /date/i);
  }
  assert.equal(parse("thunderball", [thunder, thunder]).length, 1);
  assert.throws(() => parse("thunderball", [thunder, { ...thunder, bonus_number: 7 }]), /Conflicting results/);
});

test("UK fetch uses the public read-only EuroMillions document and rejects an HTTP or schema failure", async () => {
  let requested;
  const fetchImpl = async (url, init) => {
    requested = { url, init };
    return { ok: true, json: async () => snapshot([euro]) };
  };
  const [draw] = await fetchUkDraws("euromillions", { fetchImpl, now: new Date(updated) });
  assert.equal(draw.date, "2026-11-20");
  assert.equal(requested.url, "https://firestore.googleapis.com/v1/projects/uk-app-16abb/databases/(default)/documents/lotto_results/latest_euroMillions");
  assert.equal(requested.init.method ?? "GET", "GET");
  assert.equal(requested.init.headers.authorization, undefined);
  await assert.rejects(fetchUkDraws("lotto", { fetchImpl: async () => ({ ok: false, status: 403 }) }), /Firestore HTTP 403/);
  await assert.rejects(fetchUkDraws("missing", { fetchImpl }), /Unknown UK game/);
  assert.throws(() => normaliseUkDraws("lotto", { fields: {} }), /Missing Firestore history/);
});
