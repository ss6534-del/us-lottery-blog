import test from "node:test";
import assert from "node:assert/strict";
import { MAX_CATCH_UP_DRAWS, planCatchUp } from "../lib/catchup.js";

function makeDraws(count, start = "2026-08-20") {
  const startMs = Date.parse(`${start}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) => ({
    date: new Date(startMs - index * 86_400_000).toISOString().slice(0, 10),
    white: [index + 1],
    special: null,
  }));
}

test("missing state preserves first-run behavior and plans only the latest draw", () => {
  const draws = makeDraws(5);
  const plan = planCatchUp(draws);

  assert.equal(plan.length, 1);
  assert.equal(plan[0].draw, draws[0]);
  assert.equal(plan[0].index, 0);
  assert.deepEqual(plan[0].snapshot, draws);
});

test("up-to-date state creates no work", () => {
  const draws = makeDraws(5);
  assert.deepEqual(planCatchUp(draws, draws[0].date), []);
});

test("plans every missing draw oldest-to-newest with an as-of snapshot", () => {
  const draws = makeDraws(8);
  const plan = planCatchUp(draws, draws[4].date);

  assert.deepEqual(plan.map((step) => step.draw.date), [
    draws[3].date,
    draws[2].date,
    draws[1].date,
    draws[0].date,
  ]);
  assert.deepEqual(plan.map((step) => step.index), [3, 2, 1, 0]);
  for (const step of plan) {
    assert.deepEqual(step.snapshot, draws.slice(step.index));
    assert.equal(step.snapshot[0], step.draw);
    assert.ok(step.snapshot.every((draw) => draw.date <= step.draw.date));
  }
});

test("accepts exactly the 120-draw catch-up limit", () => {
  const draws = makeDraws(MAX_CATCH_UP_DRAWS + 20);
  const plan = planCatchUp(draws, draws[MAX_CATCH_UP_DRAWS].date);
  assert.equal(plan.length, MAX_CATCH_UP_DRAWS);
  assert.equal(plan[0].draw.date, draws[MAX_CATCH_UP_DRAWS - 1].date);
  assert.equal(plan.at(-1).draw.date, draws[0].date);
});

test("rejects a catch-up above the safety limit before returning partial work", () => {
  const draws = makeDraws(MAX_CATCH_UP_DRAWS + 10);
  assert.throws(
    () => planCatchUp(draws, draws[MAX_CATCH_UP_DRAWS + 1].date),
    /requires 121 draws, exceeding the 120-draw safety limit/,
  );
});

test("rejects a future state date", () => {
  const draws = makeDraws(5);
  assert.throws(() => planCatchUp(draws, "2026-08-21"), /in the future/);
});

test("rejects a state date older than the fetched range", () => {
  const draws = makeDraws(5);
  assert.throws(() => planCatchUp(draws, "2026-08-01"), /outside fetched draw history/);
});

test("rejects a state date missing inside the fetched range", () => {
  const draws = [
    { date: "2026-08-20" },
    { date: "2026-08-18" },
    { date: "2026-08-16" },
  ];
  assert.throws(() => planCatchUp(draws, "2026-08-19"), /was not found/);
});

test("rejects unordered or duplicate draw histories", () => {
  assert.throws(
    () => planCatchUp([{ date: "2026-08-19" }, { date: "2026-08-20" }]),
    /strictly newest-first/,
  );
  assert.throws(
    () => planCatchUp([{ date: "2026-08-20" }, { date: "2026-08-20" }]),
    /duplicate date/,
  );
});
