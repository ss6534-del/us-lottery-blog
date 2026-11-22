import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { updateUk } from "../scripts/update-uk.js";

function draw(game, date, bonus = game === "euromillions" ? [7, 8] : [7]) {
  const numbers = game === "lotto" ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  return { game, date, numbers, bonus, sourceUrl: "https://www.lottery.co.uk/" };
}

function tempArchive(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "uk-posts-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("seed once, preserve the archive, and apply late draws and corrections at the same permalink", async t => {
  const dataDir = tempArchive(t);
  const game = "thunderball";
  const seed = draw(game, "2026-11-13");
  const prior = draw(game, "2026-11-11");
  let response = [seed, prior];
  const run = () => updateUk({ dataDir, fetchDraws: async id => id === game ? response : [] });
  assert.deepEqual(await run(), { written: 1, errors: [] });
  assert.deepEqual(fs.readdirSync(path.join(dataDir, game)), [seed.date + ".json"]);
  assert.equal((await run()).written, 0);

  const latest = draw(game, "2026-11-18");
  const missing = draw(game, "2026-11-14");
  response = [latest, seed, prior];
  assert.equal((await run()).written, 1);
  response = [latest, missing, draw(game, seed.date, [8]), prior];
  assert.equal((await run()).written, 2);
  response = [latest];
  assert.equal((await run()).written, 0);
  assert.deepEqual(fs.readdirSync(path.join(dataDir, game)).sort(), [seed, missing, latest].map(x => x.date + ".json"));
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, game, seed.date + ".json")));
  assert.deepEqual(saved.special, [8]);
});

test("a failed game can recover while the other games publish both Lotto rounds", async t => {
  const dataDir = tempArchive(t);
  let unavailable = true;
  const run = () => updateUk({
    dataDir,
    fetchDraws: async game => {
      if (game === "euromillions" && unavailable) throw new Error("temporarily unavailable");
      const entry = draw(game, game === "euromillions" ? "2026-11-20" : "2026-11-21");
      if (game === "lotto") entry.round2 = { numbers: [8, 9, 10, 11, 12, 13], bonus: [14] };
      return [entry];
    },
  });
  assert.deepEqual(await run(), { written: 2, errors: [{ game: "euromillions", message: "temporarily unavailable" }] });
  const saved = JSON.parse(fs.readFileSync(path.join(dataDir, "lotto", "2026-11-21.json")));
  assert.deepEqual(saved.round2, { numbers: [8, 9, 10, 11, 12, 13], special: [14] });
  unavailable = false;
  assert.deepEqual(await run(), { written: 1, errors: [] });
});
