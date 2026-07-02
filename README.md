# AI Lottery Hub — Lottery Analysis Blog

Source for [ssgpost.org](https://ssgpost.org/),
a static blog covering six New York–drawn lottery games: Powerball, Mega Millions,
NY Lotto, Take 5 (midday & evening) and Millionaire for Life.

Articles are generated automatically after each drawing from the official results
datasets on the [NY Open Data portal](https://data.ny.gov). Each post includes the
latest winning numbers, frequency charts, hot / cold / overdue numbers, pattern
breakdowns (odd–even and low–high splits, sum ranges, consecutive pairs, repeats)
and a handful of algorithmically generated number sets for the upcoming draw.

## How it works

A scheduled GitHub Actions workflow checks the official datasets every hour.
When a new drawing shows up, `scripts/update.js` runs the statistics, writes the
article data as JSON under `data/`, and commits it. `scripts/build.js` then renders
the whole site as plain HTML into `dist/`, which is deployed to GitHub Pages.

Everything is plain Node.js with zero dependencies — no framework, no build tools.
Charts are generated as inline SVG at build time, and the generated number sets are
seeded per draw, so rebuilding the site never changes a published article.

```
site.config.js      site + game configuration
lib/                data fetching, statistics, set generation, templates
scripts/update.js   detect new draws, generate article data
scripts/build.js    render data/ into dist/
scripts/serve.js    local preview server
data/               generated articles (the archive lives in git)
```

## Development

```bash
node scripts/update.js   # fetch results and generate article data
node scripts/build.js    # render the site into dist/
node scripts/serve.js    # preview at http://localhost:8080
```

Note: open the preview through `serve.js` rather than the files directly —
directory-style URLs need a server to resolve `index.html`.

## Disclaimer

Lottery drawings are random. Nothing on the site or in this repository predicts
winning numbers or improves your odds; the analysis is published for entertainment.
This project is not affiliated with the New York Lottery, MUSL, or any lottery
operator. Please play responsibly (18+, 21+ in some jurisdictions).
