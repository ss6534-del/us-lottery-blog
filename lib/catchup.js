export const MAX_CATCH_UP_DRAWS = 120;

function assertIsoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a YYYY-MM-DD string`);
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a valid calendar date: ${value}`);
  }
}

/**
 * Build an oldest-to-newest catch-up plan from newest-first draw data.
 *
 * Each step owns an as-of snapshot beginning at that draw. Consumers must use
 * the snapshot (rather than the full response) so a historical post cannot see
 * results that happened after its publication date.
 */
export function planCatchUp(draws, stateDate, options = {}) {
  const maxCatchUp = options.maxCatchUp ?? MAX_CATCH_UP_DRAWS;
  if (!Number.isInteger(maxCatchUp) || maxCatchUp < 1) {
    throw new Error(`maxCatchUp must be a positive integer`);
  }
  if (!Array.isArray(draws)) throw new Error(`draws must be an array`);
  if (draws.length === 0) return [];

  let previousDate = null;
  const seenDates = new Set();
  for (let i = 0; i < draws.length; i++) {
    const date = draws[i] && draws[i].date;
    assertIsoDate(date, `draws[${i}].date`);
    if (seenDates.has(date)) throw new Error(`draw history contains duplicate date ${date}`);
    if (previousDate !== null && date >= previousDate) {
      throw new Error(`draw history must be strictly newest-first (${previousDate}, ${date})`);
    }
    seenDates.add(date);
    previousDate = date;
  }

  // First run intentionally preserves the existing behavior: publish only the
  // latest draw instead of attempting to recreate the entire dataset history.
  if (stateDate === undefined || stateDate === null || stateDate === "") {
    return [{ index: 0, draw: draws[0], snapshot: draws.slice(0) }];
  }

  assertIsoDate(stateDate, `state date`);
  const latestDate = draws[0].date;
  const oldestDate = draws.at(-1).date;
  if (stateDate > latestDate) {
    throw new Error(`state date ${stateDate} is in the future of latest draw ${latestDate}`);
  }

  const stateIndex = draws.findIndex((draw) => draw.date === stateDate);
  if (stateIndex === -1) {
    if (stateDate < oldestDate) {
      throw new Error(
        `state date ${stateDate} is outside fetched draw history ` +
        `(${oldestDate} through ${latestDate})`,
      );
    }
    throw new Error(
      `state date ${stateDate} was not found in fetched draw history ` +
      `(${oldestDate} through ${latestDate})`,
    );
  }
  if (stateIndex === 0) return [];
  if (stateIndex > maxCatchUp) {
    throw new Error(
      `catch-up requires ${stateIndex} draws, exceeding the ${maxCatchUp}-draw safety limit ` +
      `(state ${stateDate}, latest ${latestDate})`,
    );
  }

  const plan = [];
  for (let index = stateIndex - 1; index >= 0; index--) {
    plan.push({ index, draw: draws[index], snapshot: draws.slice(index) });
  }
  return plan;
}
