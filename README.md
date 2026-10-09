# WhatsThe402: Agent Access Index

A public index of how websites answer AI agents: how often they refuse them (`403 Forbidden`)
or ask them to pay (`402 Payment Required`), by month and by industry, built on
Cloudflare Radar's AI Bots & Crawlers dataset.

Hosted on GitHub Pages and refreshed daily by GitHub Actions.

## One-time setup on GitHub

1. **Create a repository** and push this folder to `main`.
   GitHub Pages on a *private* repo needs a paid plan (Pro, Team or Enterprise). On the free plan
   the repo must be public. Nothing secret lives in the code; the Radar token is stored as a secret.
2. **Add the Radar token:** Settings › Secrets and variables › Actions › New repository secret.
   Name `CF_RADAR_TOKEN`, value: a Cloudflare API token with *Account › Radar › Read*
   (the same kind you used for the August pull).
3. **Turn on Pages:** Settings › Pages › Build and deployment › Source: **GitHub Actions**.
4. **First run:** Actions › *Refresh data and deploy* › Run workflow (keep "Pull fresh data"
   ticked). The pull makes about 1,050 requests, capped at 3 per second. The site appears at `https://<owner>.github.io/<repo>/`.
5. Optional: a custom domain (for example `index.4mica.xyz`) under Settings › Pages.

After that it runs every day at 06:17 UTC. Each run commits the built dataset
(`public/data/index.json`), so every change to the published numbers is in git history. The raw
pull is kept as a downloadable workflow artifact for 90 days, and the first pull of each month is
archived in `data/pulls/`. Pushing code redeploys with the committed dataset and does not call
Radar. If Radar returns incomplete core data the run fails, nothing is deployed,
and GitHub emails the repo admins; the site keeps its previous version.

## How the numbers are checked

Every run of the workflow checks the data before anything is published:

1. **Recompute.** `scripts/verify_dataset.py` re-derives every published figure from the raw
   Radar pull with its own code (not the build's) and fails the run on any mismatch.
2. **Cross-check.** Radar answers separate questions that must agree: an industry's 403 rate,
   its share of all agent 403s, and its share of agent traffic. The check confirms
   `rate = share of 403s x 403 rate of the covered sites / traffic share` for every industry,
   for agents, and month by month. It also measures the 403 and 402 rates across sites that
   have an industry, which differ from all agent traffic (2026 to date: 19.2% vs 25.5% for 403).
3. **Sanity.** Totals near 100%, rates within 0 to 100, complete and contiguous months, no
   failed requests.
4. **Live re-measure.** `scripts/live_check.py` rebuilds the headline 403 and 402 rates from
   three different Radar queries (crawl-purpose mix, status mix, crawl-purpose mix of 403s)
   and reports the gap.

Results are written to `public/data/verification.json` and summarised on the Method tab.

## Industry labels

Cloudflare publishes no definitions for its industry labels. `data/industry_labels.json` holds
a one-line description for each, shown behind the info icon. Labels that match LinkedIn's
industry list use LinkedIn's definition; the rest are marked as our reading.

To run a full refresh from a code push, put `[pull]` in the commit message.

## Run it locally

```sh
npm install
CF_RADAR_TOKEN=... npm run pull   # ~1,050 requests at up to 3/s, parallel -> data/pulls/
npm run data                      # newest pull -> public/data/index.json
npm run dev                       # http://localhost:5173
npm run test:pipeline             # end-to-end check against a mock Radar, no token needed
```

`pip install certifi` first if Python reports a certificate error (common on macOS).

## Layout

```
scripts/pull_radar.py     One pull for everything (replaces the three August scripts)
scripts/build_dataset.py  Newest pull -> public/data/index.json; falls back to data/raw/
data/pulls/               Raw pulls (one archived per month in the repo)
data/raw/                 The August 2026 data pack (fallback until the first pull)
data/scripts-legacy/      The original August scripts, for reference
tests/mock_radar.py       Local stand-in for the Radar API, used by test:pipeline
src/                      Front end (TypeScript, no framework, d3 scales only)
.github/workflows/        Weekly refresh and Pages deploy
```

## What the pull collects

| Block | Filter | Window | Requests |
|---|---|---|---|
| Response status | all AI bots, agents, training crawlers | each complete month since Jan 2025 | 3 per month |
| Industry mix of agent traffic, 403s and 402s | agents | each month | 3 per month |
| Rankings by industry, vertical and agent; per-agent status | agents | year to date | ~20 |
| Response status per industry | agents and training crawlers | year to date | ~270 |
| Response status per industry | agents, top 30 industries | each month | 30 per month |

Fixes carried over or added:
- Comma-named industries are sent with the comma double-encoded (`%252C`).
- `dateEnd` never runs past today 00:00 UTC; a month is pulled once it is complete.
  (The August 2026 pull failed because it asked for a date in the future.)
- 429s honour `Retry-After`; 400s record Radar's own error message in the pull file.

## Data decisions

- **Every number is a percent of requests within a filter.** Radar does not publish counts.
- **Rate vs share.** Rate = of agent requests to an industry, the percent with a code.
  Share = of all agent responses with a code, the percent from an industry, shown against the
  industry's share of agent traffic so over-indexing is visible.
- **Low volume.** Industries under 0.1% of agent traffic are hidden by default.
- **Automatic notes.** A month-on-month move of 15+ percentage points in an industry's agent
  403 or 402 rate is written up as a note on that industry.
- **Snapshot window** is year to date (1 Jan to the pull date); in the first two weeks of
  January it falls back to the last 90 days.

## Roadmap

1. Snapshot site. Done.
2. Daily pipeline on GitHub Actions, industry trends. Done; waiting on the first live pull.
3. ICP layer (private): scores industries on 402 adoption, 403 friction, agent traffic share
   and trend. Needs a private host (a second private repo or a password-protected page).
4. Investor exports: chart PNG/CSV export and a narrative page.
