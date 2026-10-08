#!/usr/bin/env python3
"""
Pull everything the Agent Access Index needs from the Cloudflare Radar API in one run.

Replaces radar_sweep.py, radar_402_yoy.py and radar_comma_fix.py. Same plumbing
(retries, summary_0 parsing, %252C for comma-named industries) plus:
  - dateEnd is capped at today 00:00 UTC, so a month is only requested once it
    is complete (this is what broke the August 2026 pull);
  - requests run in parallel under a global rate cap (default 3/s, Radar allows 4/s);
  - 429s honour Retry-After, and 400s record Radar's own error message;
  - a time budget: core data first, and if the industry-trend phase runs past
    --max-minutes the pull saves what it has instead of losing everything;
  - timestamped progress so a slow run shows where the time went.

Output: data/pulls/radar-YYYY-MM-DD.json.gz

Usage:
  CF_RADAR_TOKEN=... python3 scripts/pull_radar.py
  CF_RADAR_TOKEN=... python3 scripts/pull_radar.py --top-industries 30 --workers 6 --max-minutes 40

Token: dash.cloudflare.com > My Profile > API Tokens > Custom token > Account > Radar > Read.
"""
import argparse
import concurrent.futures as cf
import datetime as dt
import gzip
import json
import os
import pathlib
import ssl
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE = os.environ.get("RADAR_BASE", "https://api.cloudflare.com/client/v4/radar/ai/bots/summary")

AGENTS = "User Action"
TRAINING = "Training"
T0 = time.time()


def _log(s):
    sys.stderr.write(f"[{time.time() - T0:6.0f}s] {s}\n")
    sys.stderr.flush()


def ssl_context():
    try:
        import certifi  # macOS python.org builds ship without system certs

        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


class Fatal(Exception):
    pass


class Radar:
    def __init__(self, token, rate, workers):
        self.token = token
        self.ctx = ssl_context() if BASE.startswith("https") else None
        self.workers = workers
        self.interval = 1.0 / rate
        self.lock = threading.Lock()
        self.next_slot = 0.0
        self.pause_until = 0.0
        self.calls = 0
        self.done = 0
        self.rate_limited = 0
        self.latency = 0.0
        self.errors = []
        self.metas = {}  # Radar's meta block (lastUpdated, data-quality annotations) for chosen keys
        self.want_meta = {"snapshot/statusAgents"}

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

    def _slot(self):
        """Global rate limiter shared by all worker threads."""
        with self.lock:
            now = time.time()
            start = max(now, self.next_slot, self.pause_until)
            self.next_slot = start + self.interval
            self.calls += 1
        if start > now:
            time.sleep(start - now)

    def get(self, key, dimension, params):
        """Return the summary_0 block as {label: float}, or None on failure (logged)."""
        url = f"{BASE}/{dimension}?{self.query(params)}"
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}", "Accept": "application/json"})
        for attempt in range(5):
            self._slot()
            t = time.time()
            try:
                with urllib.request.urlopen(req, timeout=30, context=self.ctx) as r:
                    body = json.load(r)
                with self.lock:
                    self.latency += time.time() - t
                    self.done += 1
                res = body.get("result") or {}
                if key in self.want_meta and isinstance(res.get("meta"), dict):
                    self.metas[key] = res["meta"]
                for k, v in res.items():
                    if k != "meta" and isinstance(v, dict):
                        return {lbl: float(val) for lbl, val in v.items() if _isnum(val)}
                self._err(key, url, 200, "response had no summary block")
                return None
            except urllib.error.HTTPError as e:
                msg = _radar_message(e)
                if e.code == 429:
                    wait = int(e.headers.get("Retry-After") or 30)
                    with self.lock:
                        self.rate_limited += 1
                        self.pause_until = max(self.pause_until, time.time() + wait)
                    _log(f"rate limited by Radar, pausing all requests {wait}s")
                    continue
                if e.code >= 500 and attempt < 4:
                    time.sleep(2 * (attempt + 1))
                    continue
                if e.code in (401, 403):
                    raise Fatal(f"Radar refused the token (HTTP {e.code}: {msg}). Check CF_RADAR_TOKEN has Account > Radar > Read.")
                self._err(key, url, e.code, msg)
                return None
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
                if isinstance(getattr(e, "reason", None), ssl.SSLError):
                    raise Fatal(f"TLS error talking to Radar ({e}). Run: pip install certifi")
                if attempt < 4:
                    time.sleep(2 * (attempt + 1))
                    continue
                self._err(key, url, None, str(e)[:200])
                return None
        self._err(key, url, 429, "still rate limited after retries")
        return None

    def many(self, label, jobs, deadline=None):
        """Run [(key, dimension, params)] in parallel; return {key: result}.
        Jobs not started before `deadline` are skipped (returned as missing)."""
        out = {}
        if not jobs:
            return out
        _log(f"{label}: {len(jobs)} requests")
        skipped = 0

        def run(job):
            nonlocal skipped
            if deadline and time.time() > deadline:
                skipped += 1
                return job[0], None, True
            return job[0], self.get(job[0], job[1], job[2]), False

        step = max(50, len(jobs) // 10)
        with cf.ThreadPoolExecutor(self.workers) as ex:
            for n, (key, res, skip) in enumerate(ex.map(run, jobs), 1):
                if not skip:
                    out[key] = res
                if n % step == 0 or n == len(jobs):
                    avg = self.latency / max(self.done, 1)
                    _log(f"  {label}: {n}/{len(jobs)} (avg response {avg:.2f}s, {self.rate_limited} rate-limit pauses, {len(self.errors)} errors)")
        if skipped:
            _log(f"  {label}: time budget reached, skipped {skipped} requests")
        return out

    def _err(self, key, url, status, msg):
        with self.lock:
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
        return "; ".join(str(x.get("message", x)) for x in errs)[:300] or str(e.reason)
    except Exception:
        return str(e.reason)[:300]


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


def ranked(d):
    return [k for k, _ in sorted((d or {}).items(), key=lambda kv: -kv[1]) if k != "other"]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--start", default="2025-01", help="first month of the monthly series (YYYY-MM)")
    ap.add_argument("--top-industries", type=int, default=30, help="industries that get monthly trend lines (0 to skip)")
    ap.add_argument("--top-agents", type=int, default=8, help="agents that get their own response-status pull")
    ap.add_argument("--workers", type=int, default=6, help="parallel requests in flight")
    ap.add_argument("--rate", type=float, default=3.0, help="max requests per second (Radar allows 4)")
    ap.add_argument("--max-minutes", type=float, default=40, help="stop starting industry-trend requests after this")
    ap.add_argument("--out", default=str(ROOT / "data" / "pulls"))
    args = ap.parse_args()

    token = os.environ.get("CF_RADAR_TOKEN")
    if not token:
        sys.exit("Set CF_RADAR_TOKEN (Cloudflare API token with Account > Radar > Read).")

    rad = Radar(token, args.rate, args.workers)
    deadline = T0 + args.max_minutes * 60
    now = dt.datetime.now(dt.timezone.utc)
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    months = complete_months(args.start, today)
    ytd = {"dateStart": iso(today.replace(month=1, day=1)), "dateEnd": iso(today)}
    if today.month == 1 and today.day < 15:
        # Too little of the new year to be meaningful: fall back to the last 90 days.
        ytd = {"dateStart": iso(today - dt.timedelta(days=90)), "dateEnd": iso(today)}
    _log(f"Pull for {today:%Y-%m-%d}: {months[0][0]} to {months[-1][0]} monthly, snapshot {ytd['dateStart'][:10]} to {ytd['dateEnd'][:10]}, {args.workers} workers at {args.rate}/s")

    try:
        # 1. Monthly status (all AI bots, agents, training) and monthly industry mix of agent traffic/403s/402s.
        jobs = []
        for ym, s, e in months:
            w = {"dateStart": s, "dateEnd": e, "limitPerGroup": 40}
            jobs += [
                (f"m/{ym}/all", "RESPONSE_STATUS", w),
                (f"m/{ym}/agents", "RESPONSE_STATUS", {**w, "crawlPurpose": AGENTS}),
                (f"m/{ym}/training", "RESPONSE_STATUS", {**w, "crawlPurpose": TRAINING}),
            ]
            wi = {"dateStart": s, "dateEnd": e, "limitPerGroup": 100, "crawlPurpose": AGENTS}
            jobs += [
                (f"ms/{ym}/traffic", "INDUSTRY", wi),
                (f"ms/{ym}/403", "INDUSTRY", {**wi, "responseStatus": 403}),
                (f"ms/{ym}/402", "INDUSTRY", {**wi, "responseStatus": 402}),
            ]
        r1 = rad.many("Monthly series", jobs)

        # 2a. Snapshot rankings (these decide which industries and agents get pulled next).
        base = {"limitPerGroup": 100, "crawlPurpose": AGENTS, **ytd}
        jobs = [
            ("crawlPurpose", "CRAWL_PURPOSE", ytd),
            ("statusAgents", "RESPONSE_STATUS", {"limitPerGroup": 40, "crawlPurpose": AGENTS, **ytd}),
            ("statusTraining", "RESPONSE_STATUS", {"limitPerGroup": 40, "crawlPurpose": TRAINING, **ytd}),
            ("statusAll", "RESPONSE_STATUS", {"limitPerGroup": 40, **ytd}),
            ("industriesAllTraffic", "INDUSTRY", {"limitPerGroup": 100, **ytd}),
            ("agentsTraffic", "USER_AGENT", {"limitPerGroup": 25, "crawlPurpose": AGENTS, **ytd}),
            ("agents403", "USER_AGENT", {"limitPerGroup": 25, "crawlPurpose": AGENTS, "responseStatus": 403, **ytd}),
            ("agents402", "USER_AGENT", {"limitPerGroup": 25, "crawlPurpose": AGENTS, "responseStatus": 402, **ytd}),
        ]
        for dim, key in (("INDUSTRY", "industries"), ("VERTICAL", "verticals")):
            jobs.append((f"{key}Agents", dim, base))
            for code in ("403", "402", "429"):
                jobs.append((f"{key}Agents{code}", dim, {**base, "responseStatus": code}))
        rad.want_meta = {"statusAgents"}
        S = rad.many("Snapshot rankings", jobs)

        # 2b. Snapshot status per agent and per industry (agents and training crawlers).
        agents = ranked(S.get("agentsTraffic"))[: args.top_agents]
        industries = set()
        for k in ("industriesAgents", "industriesAgents403", "industriesAgents402", "industriesAgents429", "industriesAllTraffic"):
            industries.update(x for x in (S.get(k) or {}) if x != "other")
        jobs = [(f"agent/{a}", "RESPONSE_STATUS", {"limitPerGroup": 40, "crawlPurpose": AGENTS, "userAgent": a, **ytd}) for a in agents]
        for ind in sorted(industries):
            jobs.append((f"ind/{ind}/agents", "RESPONSE_STATUS", {"limitPerGroup": 40, "crawlPurpose": AGENTS, "industry": ind, **ytd}))
            jobs.append((f"ind/{ind}/training", "RESPONSE_STATUS", {"limitPerGroup": 40, "crawlPurpose": TRAINING, "industry": ind, **ytd}))
        r2 = rad.many(f"Snapshot detail ({len(agents)} agents, {len(industries)} industries)", jobs)

        # 3. Monthly agent status for the top N industries; respects the time budget.
        top = ranked(S.get("industriesAgents"))[: args.top_industries]
        jobs = [
            (f"im/{ind}/{ym}", "RESPONSE_STATUS", {"dateStart": s, "dateEnd": e, "limitPerGroup": 40, "crawlPurpose": AGENTS, "industry": ind})
            for ind in top
            for ym, s, e in months
        ]
        r3 = rad.many(f"Industry trends (top {len(top)})", jobs, deadline=deadline)
    except Fatal as e:
        sys.exit(str(e))

    out = {
        "schema": 2,
        "pulledAt": iso(now),
        "windows": {"snapshot": ytd, "months": [m[0] for m in months]},
        "monthly": {ym: {k: r1.get(f"m/{ym}/{k}") for k in ("all", "agents", "training")} for ym, _, _ in months},
        "monthlyIndustryShares": {ym: {k: r1.get(f"ms/{ym}/{k}") for k in ("traffic", "403", "402")} for ym, _, _ in months},
        "snapshot": {
            **S,
            "statusByAgent": {a: r2.get(f"agent/{a}") for a in agents},
            "statusAgentsByIndustry": {i: r2.get(f"ind/{i}/agents") for i in sorted(industries)},
            "statusTrainingByIndustry": {i: r2.get(f"ind/{i}/training") for i in sorted(industries)},
        },
        # Only industries whose full monthly series arrived; partial series would mislead.
        "industryMonthly": {
            ind: {ym: r3[f"im/{ind}/{ym}"] for ym, _, _ in months}
            for ind in top
            if all(r3.get(f"im/{ind}/{ym}") for ym, _, _ in months)
        },
        "radarMeta": rad.metas.get("statusAgents"),
        "errors": rad.errors,
        "stats": {
            "requests": rad.calls,
            "seconds": round(time.time() - T0),
            "avgResponseSeconds": round(rad.latency / max(rad.done, 1), 2),
            "rateLimitPauses": rad.rate_limited,
            "industryTrendsComplete": len(r3) == len(jobs),
        },
    }

    dest = pathlib.Path(args.out)
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / f"radar-{today:%Y-%m-%d}.json.gz"
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), sort_keys=True)

    st = out["stats"]
    _log(f"Wrote {path}: {st['requests']} requests in {st['seconds']}s, avg response {st['avgResponseSeconds']}s, "
         f"{st['rateLimitPauses']} rate-limit pauses, {len(rad.errors)} failed, "
         f"industry trends for {len(out['industryMonthly'])}/{len(top)} industries")
    core_missing = [ym for ym, b in out["monthly"].items() if not b["agents"] or not b["all"]]
    if core_missing or not S.get("statusAgents") or not S.get("industriesAgents"):
        _log(f"Core data missing (months: {core_missing}). Not safe to publish.")
        sys.exit(2)


if __name__ == "__main__":
    main()
