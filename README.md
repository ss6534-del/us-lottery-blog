# AI Lottery Hub — Lottery Analysis Blog

Source for [ssgpost.org](https://ssgpost.org/). The home page covers Powerball,
Mega Millions, NY Lotto, Take 5 (midday & evening) and Millionaire for Life.
The [UK section](https://ssgpost.org/uk/) covers Lotto, EuroMillions and Thunderball.

US articles are generated automatically after each drawing from the official results
datasets on the [NY Open Data portal](https://data.ny.gov). Each post includes the
latest winning numbers, frequency charts, hot / cold / overdue numbers, pattern
breakdowns (odd–even and low–high splits, sum ranges, consecutive pairs, repeats)
and a handful of algorithmically generated number sets for the upcoming draw.

## How it works

GitHub Actions runs `scripts/update.js` for US results at 20 minutes past each hour.
On Tuesdays, Wednesdays, Fridays and Saturdays, it runs `scripts/update-uk.js` at
22:30 and 23:45 London time (GMT or BST). The UK script reads the same public
results cache as the UK Android app, sourced from Lottery.co.uk.
The workflow commits new or corrected records and builds both sections into
`dist/` for a single GitHub Pages deployment.

The site is rendered with Node.js. Charts are generated as inline SVG at build time, and the US number sets are
seeded per draw, so rebuilding the site never changes a published article.

Each UK archive starts with the most recent confirmed draw. Later checks fill
missing dates within the source history and correct existing records in place.
UK articles explain the draw, link to its source and promote the UK app on Google
Play. Game archives and the [UK RSS feed](https://ssgpost.org/uk/feed.xml) share
the site's existing domain.

```
site.config.js      site + game configuration
lib/                data fetching, statistics, set generation, templates
scripts/update.js   detect new draws, generate article data
scripts/update-uk.js  update UK records under data/uk/<game>/<date>.json
scripts/build.js    render data/ into dist/
scripts/serve.js    local preview server
data/               generated articles (the archive lives in git)
```

## Development

```bash
npm ci                   # install the image-rendering dependency
node scripts/update.js   # update US results
node scripts/update-uk.js # update UK results
node scripts/build.js    # render the site into dist/
node scripts/serve.js    # preview US at / and UK at /uk/ on http://localhost:8080
```

Note: open the preview through `serve.js` rather than the files directly —
directory-style URLs need a server to resolve `index.html`.

## Disclaimer

Lottery drawings are random. Nothing on the site or in this repository predicts
winning numbers or improves your odds; the analysis is published for entertainment.
This project is not affiliated with the New York Lottery, MUSL, or any lottery
operator. Please play responsibly (18+, 21+ in some jurisdictions).
