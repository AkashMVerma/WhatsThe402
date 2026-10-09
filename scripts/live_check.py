#!/usr/bin/env python3
"""
Re-measure the headline numbers from Cloudflare Radar a second, independent way.

The site's headline (share of agent requests answered 403 or 402) comes from one
query: RESPONSE_STATUS filtered to crawlPurpose = User Action. Here we rebuild it
from three different queries instead:

    P(403 | agent) = P(agent | 403) x P(403) / P(agent)

  P(agent | 403): CRAWL_PURPOSE breakdown of all AI bot requests answered 403
  P(403):         RESPONSE_STATUS of all AI bot requests
  P(agent):       CRAWL_PURPOSE breakdown of all AI bot requests

If Radar's breakdowns are consistent and our pull is right, both routes agree.
Run after pull_radar.py and verify_dataset.py; adds a "liveCheck" block to
public/data/verification.json. Needs CF_RADAR_TOKEN. About 10 requests.
"""
import datetime as dt
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from pull_radar import AGENTS, Fatal, Radar, complete_months, iso  # noqa: E402

ROOT = pathlib.Path(__file__).resolve().parent.parent


def main():
    token = os.environ.get("CF_RADAR_TOKEN")
    if not token:
        sys.exit("Set CF_RADAR_TOKEN")
    index = json.load(open(ROOT / "public" / "data" / "index.json"))
    vpath = ROOT / "public" / "data" / "verification.json"
    ver = json.load(open(vpath)) if vpath.exists() else {}

    rad = Radar(token, rate=2.0, workers=1)
    today = dt.datetime.now(dt.timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    last_month = complete_months(index["meta"]["windows"]["monthly"]["end"], today)
    windows = {}
    if last_month:
        ym, s, e = last_month[0]
        windows[f"month {ym}"] = ({"dateStart": s, "dateEnd": e}, next(m["agents"] for m in index["monthly"] if m["month"] == ym))
    ytd = index["meta"]["windows"]["ytd"]
    windows["year to date"] = ({"dateStart": ytd["start"] + "T00:00:00Z", "dateEnd": ytd["end"] + "T00:00:00Z"}, index["overall"]["agents"])

    results = []
    try:
        for name, (w, published) in windows.items():
            purpose = rad.get(f"live/{name}/purpose", "CRAWL_PURPOSE", w) or {}
            status = rad.get(f"live/{name}/status", "RESPONSE_STATUS", {"limitPerGroup": 40, **w}) or {}
            direct = rad.get(f"live/{name}/direct", "RESPONSE_STATUS", {"limitPerGroup": 40, "crawlPurpose": AGENTS, **w}) or {}
            for code in ("403", "402"):
                by_code = rad.get(f"live/{name}/purpose{code}", "CRAWL_PURPOSE", {"responseStatus": code, **w}) or {}
                p_agent, p_code, p_agent_given = purpose.get(AGENTS), status.get(code), by_code.get(AGENTS)
                implied = p_agent_given * p_code / p_agent if p_agent and p_code is not None and p_agent_given is not None else None
                results.append({
                    "window": name,
                    "code": code,
                    "published": round(published[code], 4),
                    "requeriedDirect": None if code not in direct else round(direct[code], 4),
                    "independentRoute": None if implied is None else round(implied, 4),
                    "diffPP": None if implied is None else round(implied - published[code], 4),
                })
    except Fatal as e:
        sys.exit(str(e))

    ver["liveCheck"] = {"checkedAt": iso(dt.datetime.now(dt.timezone.utc)), "results": results, "errors": rad.errors}
    with open(vpath, "w") as f:
        json.dump(ver, f, indent=1)
    for r in results:
        print(f"{r['window']:16s} {r['code']}: published {r['published']}%, re-queried {r['requeriedDirect']}%, independent route {r['independentRoute']}% (diff {r['diffPP']} pp)")


if __name__ == "__main__":
    main()
