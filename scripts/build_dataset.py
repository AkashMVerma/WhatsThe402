#!/usr/bin/env python3
"""
Build the site's dataset (public/data/index.json) from the newest Radar pull.

Input, in order of preference:
  1. the newest data/pulls/radar-YYYY-MM-DD.json.gz written by scripts/pull_radar.py;
  2. the August 2026 data pack in data/raw/ (converted to the same shape).

Everything Radar publishes is a percentage of requests within a filter, never a
count. Every number in the output is a percent, and each block says which filter
and window it belongs to.

Usage: python3 scripts/build_dataset.py [pulls-folder]
"""
import datetime as dt
import gzip
import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
PULLS = ROOT / "data" / "pulls"
OUT = ROOT / "public" / "data" / "index.json"

# Industries below this share of agent traffic are hidden by default in the UI:
# a handful of sites can swing their rates.
LOW_VOLUME_PCT = 0.1
KEY_CODES = ["200", "402", "403", "404", "429"]
# A month-on-month move this large (percentage points) in an industry's agent
# 403 or 402 rate gets an automatic note.
SHIFT_PP = 15
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

STATIC_NOTES = {
    "Internet Service Providers, Website Hosting & Internet-related Services": (
        "Very little traffic: only a handful of status codes are recorded. Treat its rates as anecdotal."
    ),
    "software": "Lower-case label is Cloudflare's own taxonomy and is kept separate from Computer Software.",
}
# Only used with the August pack, which has weekly (not monthly) industry data.
# Source: data/raw/radar_data_ytd.json -> gaming_weekly_200_403_402
LEGACY_NOTES = {
    "Gaming": (
        "The 402 rate was under 1% of agent requests until late June 2026, then jumped to 60-69% "
        "for the weeks from 28 Jun. The year-to-date figure reflects that switch."
    ),
}


# --------------------------------------------------------------------------- inputs

def newest_pull(folder=PULLS):
    files = sorted(pathlib.Path(folder).glob("radar-*.json.gz"))
    if not files:
        return None, None
    with gzip.open(files[-1], "rt", encoding="utf-8") as f:
        return json.load(f), files[-1].name


def legacy_pack():
    """Convert the August 2026 data pack into the pull_radar.py shape."""
    def load(name):
        with open(RAW / name) as f:
            return json.load(f)

    def num(d):
        if not d or "error" in d:
            return None
        out = {}
        for k, v in d.items():
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                pass
        return out

    sweep = load("radar_sweep_out.json")["ytd"]
    yoy = load("radar_402_yoy_out.json")["months"]
    comma = load("radar_comma_out.json").get("fetched", {})
    browser = load("radar_data_ytd.json")

    ua_by = {k: num(v) for k, v in sweep["status_ua_by_industry"].items()}
    for k, v in comma.items():
        if num(v):
            ua_by[k] = num(v)

    return {
        "schema": 2,
        "pulledAt": "2026-08-31T00:00:00Z",
        "windows": {"snapshot": {"dateStart": "2026-01-01T00:00:00Z", "dateEnd": "2026-08-18T00:00:00Z"}},
        "monthly": {m: {"all": num(b.get("all")), "agents": num(b.get("user_action")), "training": None} for m, b in yoy.items()},
        "monthlyIndustryShares": {},
        "industryMonthly": {},
        "snapshot": {
            "crawlPurpose": num(sweep["crawl_purpose"]),
            "statusAgents": num(sweep["status_ua_overall"]),
            "statusTraining": num(sweep["status_training_overall"]),
            "industriesAllTraffic": num(sweep["industries_all_traffic"]),
            "industriesAgents": num(sweep["industries_ua"]),
            "industriesAgents403": num(sweep["industries_ua_403"]),
            "industriesAgents402": num(sweep["industries_ua_402"]),
            "industriesAgents429": num(sweep["industries_ua_429"]),
            "verticalsAgents": num(sweep["verticals_ua"]),
            "verticalsAgents403": num(sweep["verticals_ua_403"]),
            "verticalsAgents402": num(sweep["verticals_ua_402"]),
            "agentsTraffic": browser["ua_agents_ytd"],
            "agents402": browser["ua_402_agents_ytd"],
            "agents403": None,
            "statusByAgent": browser["bot_status_ytd"],
            "statusAgentsByIndustry": ua_by,
            "statusTrainingByIndustry": {k: num(v) for k, v in sweep["status_training_by_industry"].items()},
        },
        "radarMeta": None,
        "errors": [],
        "_sources": [
            "Monthly response status, all AI bots and agents: Radar API RESPONSE_STATUS, pulled 31 Aug 2026.",
            "Industry response status, agents and training crawlers: Radar API filtered by industry, pulled 20 Aug 2026.",
            "Agent mix and per-agent rates: Radar Data Explorer, pulled 18 Aug 2026.",
        ],
        "_legacy": True,
    }


# --------------------------------------------------------------------------- helpers

def r6(v):
    return round(float(v), 6)


def opt(d, k):
    return None if not d or k not in d else r6(d[k])


def rates(dist):
    return None if not dist else {c: r6(dist.get(c, 0.0)) for c in KEY_CODES}


def groups(dist):
    """Collapse a full status distribution into the buckets the UI stacks."""
    if not dist:
        return None
    g = {"2xx": 0.0, "3xx": 0.0, "403": 0.0, "402": 0.0, "429": 0.0, "other": 0.0}
    for code, v in dist.items():
        if code in ("403", "402", "429"):
            g[code] += v
        elif code.startswith("2"):
            g["2xx"] += v
        elif code.startswith("3"):
            g["3xx"] += v
        else:
            g["other"] += v
    return {k: round(v, 4) for k, v in g.items()}


def month_label(ym):
    y, m = ym.split("-")
    return f"{MONTHS[int(m) - 1]} {y}"


def date_of(ts):
    return dt.datetime.strptime(ts[:10], "%Y-%m-%d").date()


def window_label(w):
    a, b = date_of(w["dateStart"]), date_of(w["dateEnd"])
    left = f"{a.day} {MONTHS[a.month - 1]}" + ("" if a.year == b.year else f" {a.year}")
    return f"{left} to {b.day} {MONTHS[b.month - 1]} {b.year}"


def fmt_pct(v):
    return f"{v:.1f}%" if v >= 1 else f"{v:.2f}%"


def shift_note(series):
    """Largest month-on-month move in agent 403 or 402 rate, if it clears SHIFT_PP."""
    best = None
    for code, name in (("402", "402"), ("403", "403")):
        for prev, cur in zip(series, series[1:]):
            d = cur[code] - prev[code]
            if abs(d) >= SHIFT_PP and (best is None or abs(d) > abs(best[0])):
                best = (d, name, prev, cur)
    if not best:
        return None
    d, name, prev, cur = best
    verb = "jumped" if d > 0 else "fell"
    note = (f"The agent {name} rate {verb} from {fmt_pct(prev[name])} in {month_label(prev['month'])} "
            f"to {fmt_pct(cur[name])} in {month_label(cur['month'])}.")
    latest = series[-1]
    # The biggest move is not the whole story if the rate has moved again since.
    if latest["month"] != cur["month"] and fmt_pct(latest[name]) != fmt_pct(cur[name]):
        note += f" Latest: {fmt_pct(latest[name])} in {month_label(latest['month'])}."
    return note


# --------------------------------------------------------------------------- build

def build(p, source_file):
    S = p["snapshot"]
    legacy = p.get("_legacy", False)

    monthly = []
    pending = []
    for ym in sorted(p["monthly"]):
        b = p["monthly"][ym]
        if not b.get("agents") or not b.get("all"):
            pending.append(ym)
            continue
        monthly.append({"month": ym, "agents": rates(b["agents"]), "allBots": rates(b["all"]), "training": rates(b.get("training"))})

    share_traffic = S.get("industriesAgents") or {}
    shares = {c: S.get(f"industriesAgents{c}") or {} for c in ("403", "402", "429")}
    ua_by = S.get("statusAgentsByIndustry") or {}
    tr_by = S.get("statusTrainingByIndustry") or {}

    industries = []
    for name in sorted(ua_by):
        ua = ua_by[name]
        if not ua:
            continue
        tr = tr_by.get(name)
        traffic = share_traffic.get(name)
        series = None
        im = p.get("industryMonthly", {}).get(name)
        if im:
            series = [{"month": ym, "403": r6(d.get("403", 0)), "402": r6(d.get("402", 0))} for ym, d in sorted(im.items()) if d]
        note = STATIC_NOTES.get(name) or (shift_note(series) if series else None)
        if legacy and not note:
            note = LEGACY_NOTES.get(name)
        industries.append({
            "name": name,
            "agentTrafficShare": None if traffic is None else r6(traffic),
            "lowVolume": traffic is None or traffic < LOW_VOLUME_PCT,
            "agents": rates(ua),
            "trainers": rates(tr),
            "agentGroups": groups(ua),
            "trainerGroups": groups(tr),
            "shareOfAgent403": r6(shares["403"].get(name, 0.0)),
            "shareOfAgent402": r6(shares["402"].get(name, 0.0)),
            "shareOfAgent429": r6(shares["429"].get(name, 0.0)),
            "monthly": series,
            "note": note,
        })

    bots = []
    for name, share in sorted((S.get("agentsTraffic") or {}).items(), key=lambda kv: -kv[1]):
        if name == "other":
            continue
        r = (S.get("statusByAgent") or {}).get(name)
        bots.append({
            "name": name,
            "trafficShare": r6(share),
            # Missing from Radar's ranking means below its cutoff, which we show as n/a rather than 0.
            "shareOfAgent402": opt(S.get("agents402"), name),
            "shareOfAgent403": opt(S.get("agents403"), name),
            "rates": None if not r else {c: r6(r[c]) for c in KEY_CODES if c in r},
        })

    def ranked(d, key):
        return [{"name": k, key: r6(v)} for k, v in sorted((d or {}).items(), key=lambda kv: -kv[1]) if k != "other"]

    annotations = []
    ci = ((p.get("radarMeta") or {}).get("confidenceInfo") or {}).get("annotations") or []
    for a in ci:
        desc = a.get("description") or a.get("eventType")
        if desc:
            annotations.append({"description": desc, "start": (a.get("startDate") or "")[:10], "end": (a.get("endDate") or "")[:10]})

    pulled = date_of(p["pulledAt"])
    sources = p.get("_sources") or [
        f"All series: Radar API /radar/ai/bots/summary, pulled {pulled.day} {MONTHS[pulled.month - 1]} {pulled.year}.",
        "Monthly status for all AI bots, agents and training crawlers; industry, vertical and agent breakdowns for the snapshot window; monthly agent status for the 30 industries with the most agent traffic.",
    ]

    snap = p["windows"]["snapshot"]
    return {
        "meta": {
            "title": "Agent Access Index",
            "source": "Cloudflare Radar, AI Bots & Crawlers dataset (/radar/ai/bots/summary)",
            "sourceUrl": "https://radar.cloudflare.com/ai-insights",
            "unit": "percent of requests within the stated filter",
            "definitions": {
                "agents": "crawlPurpose = User Action: bots fetching a page because a person asked, e.g. ChatGPT-User, Claude-User, Perplexity-User.",
                "trainers": "crawlPurpose = Training: bots collecting pages for model training.",
                "allBots": "All AI bot and crawler traffic Cloudflare classifies, every purpose combined.",
            },
            "windows": {
                "ytd": {"start": snap["dateStart"][:10], "end": snap["dateEnd"][:10], "label": window_label(snap)},
                "monthly": {"start": monthly[0]["month"], "end": monthly[-1]["month"]},
            },
            "updated": p["pulledAt"][:10],
            "inputFile": source_file,
            "sources": sources,
            "radarNotes": annotations,
            "failedRequests": len(p.get("errors") or []),
            "monthsPending": pending,
            "lowVolumeThresholdPct": LOW_VOLUME_PCT,
            "hasIndustryTrends": any(i["monthly"] for i in industries),
        },
        "overall": {
            "agents": rates(S["statusAgents"]),
            "trainers": rates(S["statusTraining"]),
            "agentGroups": groups(S["statusAgents"]),
            "trainerGroups": groups(S["statusTraining"]),
            "crawlPurpose": {k: r6(v) for k, v in (S.get("crawlPurpose") or {}).items()},
        },
        "monthly": monthly,
        "industries": industries,
        "bots": bots,
        "verticals402": ranked(S.get("verticalsAgents402"), "shareOfAgent402"),
        "verticals403": ranked(S.get("verticalsAgents403"), "shareOfAgent403"),
    }


def main():
    # Optional argument: a different pulls folder (used by tests).
    pull, name = newest_pull(sys.argv[1]) if len(sys.argv) > 1 else newest_pull()
    if pull is None:
        pull, name = legacy_pack(), "data/raw (August 2026 pack)"
    out = build(pull, name)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, separators=(",", ":"))
    ind = out["industries"]
    print(f"{name} -> {OUT.relative_to(ROOT)}: {len(out['monthly'])} months "
          f"({out['meta']['windows']['monthly']['start']} to {out['meta']['windows']['monthly']['end']}), "
          f"{len(ind)} industries ({sum(not i['lowVolume'] for i in ind)} shown by default, "
          f"{sum(1 for i in ind if i['monthly'])} with trends), {len(out['bots'])} agents, "
          f"{out['meta']['failedRequests']} failed requests, pending months: {out['meta']['monthsPending']}")
    if out["meta"]["failedRequests"]:
        print("Warning: some Radar requests failed; see 'errors' in the pull file.", file=sys.stderr)


if __name__ == "__main__":
    main()
