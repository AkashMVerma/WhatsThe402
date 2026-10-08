#!/usr/bin/env python3
"""
Pull everything the Agent Access Index needs from the Cloudflare Radar API in one run.

Replaces radar_sweep.py, radar_402_yoy.py and radar_comma_fix.py. Same plumbing
(retries, summary_0 parsing, %252C for comma-named industries) plus:
  - dateEnd is capped at today 00:00 UTC, so a month is only requested once it
    is complete (this is what broke the August 2026 pull);
  - 429s honour Retry-After, and 400s record Radar's own error message;
  - per-agent rates come from the API (userAgent filter), not browser pulls;
  - monthly status for the top N industries, for industry trend lines.

Output: data/pulls/radar-YYYY-MM-DD.json.gz (one file per run, kept as history).

Usage:
  CF_RADAR_TOKEN=... python3 scripts/pull_radar.py
  CF_RADAR_TOKEN=... python3 scripts/pull_radar.py --top-industries 30 --start 2025-01

Token: dash.cloudflare.com > My Profile > API Tokens > Custom token > Account > Radar > Read.
A full run is ~1,000 requests and takes 6-8 minutes (Radar allows 1,200 per 5 minutes).
"""
import argparse
import datetime as dt
import gzip
import json
import os
import pathlib
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = os.environ.get("RADAR_BASE", "https://api.cloudflare.com/client/v4/radar/ai/bots/summary")

AGENTS = "User Action"
TRAINING = "Training"


def ssl_context():
    try:
        import certifi  # macOS python.org builds ship without system certs

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


class Radar:
    def __init__(self, token, sleep):
        self.token = token
        self.sleep = sleep
        self.ctx = ssl_context() if BASE.startswith("https") else None
        self.calls = 0
        self.errors = []
        self.metas = {}  # Radar's meta block (lastUpdated, data-quality annotations) for chosen keys
        self.want_meta = {"snapshot/statusAgents"}
        self.started = time.time()

    @staticmethod
    def query(params):
        """Build the query string by hand: industry/vertical values with commas
        must have the comma double-encoded (%252C) or Radar treats it as a list
        separator and answers 400."""
        parts = []
        for k, v in params.items():
            if v is None:
                continue
            enc = urllib.parse.quote(str(v), safe="")
            if k in ("industry", "vertical"):
                enc = enc.replace("%2C", "%252C")
            parts.append(f"{k}={enc}")
        return "&".join(parts)

    def get(self, key, dimension, **params):
        """Return the summary_0 block as {label: float}, or None on failure (logged)."""
        url = f"{BASE}/{dimension}?{self.query(params)}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}", "Accept": "application/json"})
        for attempt in range(5):
            self.calls += 1
            try:
                with urllib.request.urlopen(req, timeout=60, context=self.ctx) as r:
                    body = json.load(r)
                res = body.get("result") or {}
                if key in self.want_meta and isinstance(res.get("meta"), dict):
                    self.metas[key] = res["meta"]
                for k, v in res.items():
                    if k != "meta" and isinstance(v, dict):
                        time.sleep(self.sleep)
                        return {lbl: float(val) for lbl, val in v.items() if _isnum(val)}
                self._err(key, url, 200, "response had no summary block")
                return None
            except urllib.error.HTTPError as e:
                msg = _radar_message(e)
                if e.code == 429:
                    wait = int(e.headers.get("Retry-After") or 30)
                    _log(f"  rate limited, waiting {wait}s")
                    time.sleep(wait)
                    continue
                if e.code >= 500 and attempt < 4:
                    time.sleep(2 * (attempt + 1))
                    continue
                if e.code in (401, 403):
                    sys.exit(f"Radar refused the token (HTTP {e.code}: {msg}). Check CF_RADAR_TOKEN has Account > Radar > Read.")
                self._err(key, url, e.code, msg)
                return None
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if isinstance(getattr(e, "reason", None), ssl.SSLError):
                    sys.exit(f"TLS error talking to Radar ({e}). Run: pip install certifi")
                if attempt < 4:
                    time.sleep(2 * (attempt + 1))
                    continue
                self._err(key, url, None, str(e)[:200])
                return None
        self._err(key, url, 429, "still rate limited after retries")
        return None

    def _err(self, key, url, status, msg):
        self.errors.append({"key": key, "status": status, "message": msg, "url": url})
        _log(f"  ! {key}: HTTP {status} {msg}")


def _isnum(v):
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False


def _radar_message(e):
    try:
        body = json.loads(e.read().decode("utf-8", "replace"))
        errs = body.get("errors") or []
        return "; ".join(str(x.get("message", x)) for x in errs)[:300] or e.reason
    except Exception:
        return str(e.reason)[:300]


def _log(s):
    sys.stderr.write(s + "\n")
    sys.stderr.flush()


def iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


def complete_months(start_ym, today):
    """[(YYYY-MM, start, end)] for every month from start_ym whose last day is before today."""
    y, m = map(int, start_ym.split("-"))
    out = []
    while True:
        first = dt.datetime(y, m, 1, tzinfo=dt.timezone.utc)
        nxt = dt.datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=dt.timezone.utc)
        if nxt > today:
            break
        out.append((f"{y}-{m:02d}", iso(first), iso(nxt - dt.timedelta(seconds=1))))
        y, m = nxt.year, nxt.month
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2025-01", help="first month of the monthly series (YYYY-MM)")
    ap.add_argument("--top-industries", type=int, default=30, help="industries that get monthly trend lines (0 to skip)")
    ap.add_argument("--top-agents", type=int, default=8, help="agents that get their own response-status pull")
    ap.add_argument("--sleep", type=float, default=0.3, help="seconds between requests")
    ap.add_argument("--out", default=str(ROOT / "data" / "pulls"))
    args = ap.parse_args()

    token = os.environ.get("CF_RADAR_TOKEN")
    if not token:
        sys.exit("Set CF_RADAR_TOKEN (Cloudflare API token with Account > Radar > Read).")

    rad = Radar(token, args.sleep)
    now = dt.datetime.now(dt.timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    months = complete_months(args.start, today)
    ytd = {"dateStart": iso(today.replace(month=1, day=1)), "dateEnd": iso(today)}
    if today.month == 1 and today.day < 15:
        # Too little of the new year to be meaningful: fall back to the last 90 days.
        ytd = {"dateStart": iso(today - dt.timedelta(days=90)), "dateEnd": iso(today)}

    out = {
        "schema": 2,
        "pulledAt": iso(now),
        "windows": {"snapshot": ytd, "months": [m[0] for m in months]},
        "monthly": {},
        "monthlyIndustryShares": {},
        "industryMonthly": {},
        "snapshot": {},
    }

    # 1. Monthly response status: all AI bots, agents, training crawlers.
    _log(f"Monthly status, {months[0][0]} to {months[-1][0]} ({len(months)} months)")
    for ym, s, e in months:
        w = {"dateStart": s, "dateEnd": e, "limitPerGroup": 40}
        out["monthly"][ym] = {
            "all": rad.get(f"monthly/{ym}/all", "RESPONSE_STATUS", **w),
            "agents": rad.get(f"monthly/{ym}/agents", "RESPONSE_STATUS", crawlPurpose=AGENTS, **w),
            "training": rad.get(f"monthly/{ym}/training", "RESPONSE_STATUS", crawlPurpose=TRAINING, **w),
        }
        # Industry mix of agent traffic and of agent 403s/402s, per month.
        wi = {"dateStart": s, "dateEnd": e, "limitPerGroup": 100, "crawlPurpose": AGENTS}
        out["monthlyIndustryShares"][ym] = {
            "traffic": rad.get(f"monthlyShares/{ym}/traffic", "INDUSTRY", **wi),
            "403": rad.get(f"monthlyShares/{ym}/403", "INDUSTRY", responseStatus=403, **wi),
            "402": rad.get(f"monthlyShares/{ym}/402", "INDUSTRY", responseStatus=402, **wi),
        }

    # 2. Snapshot window (year to date): rankings, mixes, per-industry and per-agent status.
    _log(f"Snapshot {ytd['dateStart'][:10]} to {ytd['dateEnd'][:10]}")
    S = out["snapshot"]
    S["crawlPurpose"] = rad.get("snapshot/crawlPurpose", "CRAWL_PURPOSE", **ytd)
    S["statusAgents"] = rad.get("snapshot/statusAgents", "RESPONSE_STATUS", limitPerGroup=40, crawlPurpose=AGENTS, **ytd)
    S["statusTraining"] = rad.get("snapshot/statusTraining", "RESPONSE_STATUS", limitPerGroup=40, crawlPurpose=TRAINING, **ytd)
    S["statusAll"] = rad.get("snapshot/statusAll", "RESPONSE_STATUS", limitPerGroup=40, **ytd)
    S["industriesAllTraffic"] = rad.get("snapshot/industriesAll", "INDUSTRY", limitPerGroup=100, **ytd)
    for dim, key in (("INDUSTRY", "industries"), ("VERTICAL", "verticals")):
        base = {"limitPerGroup": 100, "crawlPurpose": AGENTS, **ytd}
        S[f"{key}Agents"] = rad.get(f"snapshot/{key}Agents", dim, **base)
        for code in ("403", "402", "429"):
            S[f"{key}Agents{code}"] = rad.get(f"snapshot/{key}Agents{code}", dim, responseStatus=code, **base)

    S["agentsTraffic"] = rad.get("snapshot/agentsTraffic", "USER_AGENT", limitPerGroup=25, crawlPurpose=AGENTS, **ytd)
    for code in ("403", "402"):
        S[f"agents{code}"] = rad.get(f"snapshot/agents{code}", "USER_AGENT", limitPerGroup=25, crawlPurpose=AGENTS, responseStatus=code, **ytd)
    S["statusByAgent"] = {}
    top_agents = [a for a, _ in sorted((S["agentsTraffic"] or {}).items(), key=lambda kv: -kv[1]) if a != "other"][: args.top_agents]
    for a in top_agents:
        S["statusByAgent"][a] = rad.get(f"snapshot/agent/{a}", "RESPONSE_STATUS", limitPerGroup=40, crawlPurpose=AGENTS, userAgent=a, **ytd)

    industries = set()
    for k in ("industriesAgents", "industriesAgents403", "industriesAgents402", "industriesAgents429", "industriesAllTraffic"):
        industries.update(x for x in (S.get(k) or {}) if x != "other")
    _log(f"Per-industry status for {len(industries)} industries")
    S["statusAgentsByIndustry"], S["statusTrainingByIndustry"] = {}, {}
    for ind in sorted(industries):
        S["statusAgentsByIndustry"][ind] = rad.get(f"snapshot/industry/{ind}/agents", "RESPONSE_STATUS", limitPerGroup=40, crawlPurpose=AGENTS, industry=ind, **ytd)
        S["statusTrainingByIndustry"][ind] = rad.get(f"snapshot/industry/{ind}/training", "RESPONSE_STATUS", limitPerGroup=40, crawlPurpose=TRAINING, industry=ind, **ytd)

    # 3. Monthly agent status for the top N industries by agent traffic.
    top = [i for i, _ in sorted((S.get("industriesAgents") or {}).items(), key=lambda kv: -kv[1]) if i != "other"][: args.top_industries]
    if top:
        _log(f"Monthly status for top {len(top)} industries ({len(top) * len(months)} requests)")
    for n, ind in enumerate(top, 1):
        _log(f"  [{n}/{len(top)}] {ind}")
        out["industryMonthly"][ind] = {
            ym: rad.get(f"industryMonthly/{ind}/{ym}", "RESPONSE_STATUS", dateStart=s, dateEnd=e, limitPerGroup=40, crawlPurpose=AGENTS, industry=ind)
            for ym, s, e in months
        }

    out["radarMeta"] = rad.metas.get("snapshot/statusAgents")
    out["errors"] = rad.errors
    out["stats"] = {"requests": rad.calls, "seconds": round(time.time() - rad.started)}

    dest = pathlib.Path(args.out)
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"radar-{today:%Y-%m-%d}.json.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)

    _log(f"\nWrote {path} ({rad.calls} requests in {out['stats']['seconds']}s, {len(rad.errors)} failed)")
    core_missing = [ym for ym, b in out["monthly"].items() if not b["agents"] or not b["all"]]
    if core_missing or not S.get("statusAgents") or not S.get("industriesAgents"):
        _log(f"Core data missing (months: {core_missing}). Not safe to publish.")
        sys.exit(2)


if __name__ == "__main__":
    main()
