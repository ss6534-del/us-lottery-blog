import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fetchUkDraws, UK_GAMES } from "../lib/uk-draws.js";

const UK_DATA = fileURLToPath(new URL("../data/uk/", import.meta.url));
const dateFile = /^\d{4}-\d{2}-\d{2}\.json$/;

function saveDraw(dir, draw) {
  const record = {
    game: draw.game,
    date: draw.date,
    numbers: draw.numbers,
    special: draw.bonus,
    ...(draw.round2 && { round2: { numbers: draw.round2.numbers, special: draw.round2.bonus } }),
    sourceUrl: draw.sourceUrl,
  };
  const file = path.join(dir, draw.date + ".json");
  const json = JSON.stringify(record, null, 2) + "\n";
  if (fs.existsSync(file) && fs.readFileSync(file, "utf8").replaceAll("\r\n", "\n") === json) return false;

  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + "." + randomUUID() + ".tmp";
  try {
    fs.writeFileSync(tmp, json, "utf8");
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  return true;
}

export async function updateUk({ dataDir = UK_DATA, fetchDraws = fetchUkDraws } = {}) {
  const errors = [];
  let written = 0;
  for (const game of Object.keys(UK_GAMES)) {
    let draws;
    try {
      draws = await fetchDraws(game);
    } catch (err) {
      errors.push({ game, message: err.message });
      continue;
    }
    if (!draws.length) continue;

    const dir = path.join(dataDir, game);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => dateFile.test(name)).sort() : [];
    // Start each archive at its newest draw. On later runs revisit the source window
    // to pick up corrections and draws that were first reported out of order.
    const firstDate = files.length ? files[0].slice(0, 10) : draws[0].date;
    for (const draw of draws) {
      if (draw.date >= firstDate && saveDraw(dir, draw)) written++;
    }
  }
  return { written, errors };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const { written, errors } = await updateUk();
  for (const { game, message } of errors) console.warn(`[UK] ${game}: ${message}`);
  console.log(`[UK] Wrote ${written} new or corrected draw record(s).`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `changed=${written > 0}\n`);
  }
  if (errors.length === Object.keys(UK_GAMES).length) process.exitCode = 1;
}
