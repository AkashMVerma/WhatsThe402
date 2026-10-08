# Cloudflare Radar data pack — everything behind the charts

All values are **percent of requests within the stated filter** (Radar publishes shares, not counts).
Dataset: Cloudflare Radar "AI Bots & Crawlers" (`ai.bots`), API path `/radar/ai/bots/summary/{DIMENSION}`.
"Agents" = crawlPurpose **User Action** (ChatGPT-User, Claude-User, Perplexity-User, MistralAI-User, TikTokSpider …).
"Trainers" = crawlPurpose **Training**.

| File | What it holds | Window | How it was pulled |
|---|---|---|---|
| `radar_403_agent_vs_trainer_by_industry_YTD2026.csv` | **The table for the refusal paragraph.** 130 industries: agent share of user-action traffic, agent vs trainer 403 / 200 / 429 / 402 rates, and the agent÷trainer 403 ratio. Row 1 = all industries combined. | 1 Jan – 18 Aug 2026 (YTD) | Derived from `radar_sweep_out.json` |
| `radar_sweep_out.json` | Full response-status distribution for every industry (133) and vertical, separately for User Action and Training; overall status by purpose; crawl-purpose mix. Keys: `ytd.status_ua_by_industry`, `ytd.status_training_by_industry`, `ytd.status_ua_overall`, `ytd.status_training_overall`, `ytd.industries_ua` (traffic share), `ytd.industries_ua_403/402/429` (share of each code by industry). | 1 Jan – 18 Aug 2026 | `radar_sweep.py` via API, 20 Aug 2026; comma-named industries recovered with `radar_comma_fix.py` (%252C encoding) |
| `radar_402_yoy_out.json` | Monthly RESPONSE_STATUS for all AI bots and for User Action, Jan 2025 – Jul 2026 (`limitPerGroup=40` so 402 is never folded into "other"). The 402 line-plot series. | Monthly, 2025-01 … 2026-07 | `radar_402_yoy.py` via API, 24 Aug 2026 |
| `radar_data_ytd.json` | Browser pulls from the Radar Data Explorer: crawl-purpose mix, status by purpose, weekly series (user-action 200/403/429/402; ChatGPT-User, Claude-User, Publishing, Media, Newspapers, Gaming weekly), agent mix, 402 by agent, industry/vertical status tables. Cross-validates the API sweep within 0.3pp. | 28d ending 18 Aug 2026 **and** YTD 1 Jan – 18 Aug 2026 — every key says which | Data Explorer, browser, 18 Aug 2026 |
| `radar_data.json` | Earlier browser pull, **28-day window only** (ending 18 Aug 2026), incl. `training_comparison` for Publishing and Gaming. Kept because some earlier numbers came from here. | 28d | Data Explorer, browser, 18 Aug 2026 |
| `radar_sweep.py`, `radar_402_yoy.py`, `radar_comma_fix.py` | The scripts. Run locally with `CF_RADAR_TOKEN=… python3 radar_sweep.py > out.json`. Token: dash.cloudflare.com → API Tokens → Custom → Account › Radar › Read. | — | — |

## What the data says about the refusal paragraph (YTD, `radar_sweep_out.json`)

- All industries combined: agents 403 = **22.76%**, trainers 403 = **12.03%** → **1.9x**. This is the volume-weighted aggregate.
- Per industry: agents are refused more than trainers in **85 of 130** industries; the ratio is **≥ 2x in only 32**; median ratio **1.33x**, traffic-weighted mean **1.3x**. So "about twice as often in nearly every industry" is **not** what the per-industry data shows — the 2x is the aggregate, and it is pulled up by a handful of high-refusal industries (Publishing 4.2x, Education Management 2.5x, Internet 1.7x, Market Research 1.6x) while the largest agent destination, Retail (22% of agent traffic), refuses agents *less* than trainers (4.4% vs 6.4%).
- Publishing YTD: agents 403 **82.84%**, trainers 403 **19.96%** → **4.15x**; agents 200 = 12.7% vs trainers 200 = 58.6% (trainers let through **4.6x** as readily).
- The "~3x" figure comes from the **28-day** browser pull (`radar_data.json`: Publishing agents 403 59.7% vs trainers 19.3% = 3.1x). The paragraph currently mixes the YTD 83% with the 28-day 3x. Pick one window: YTD gives 83% and ~4x; 28d gives ~60% and ~3x.

Suggested wording that the data supports: "Across everything Cloudflare Radar tracks, agents are refused nearly twice as often as training crawlers this year — 22.8% of agent requests get a 403 against 12.0% for trainers. The gap is not uniform: agents fare worse in 85 of 130 industries, and the aggregate is driven by a few sectors. Publishing is the extreme case: it refuses 83% of agent fetches and only 20% of trainer requests — four times as often."
