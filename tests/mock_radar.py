#!/usr/bin/env python3
"""
A local stand-in for the Radar /ai/bots/summary API, for testing the pipeline
without a token or network. Data is synthetic but shaped like Radar's, and it
reproduces the failure modes the real API has shown:
  - a comma in an industry/vertical filter that is not double-encoded -> 400
  - a dateEnd in the future -> 400
  - an occasional 429 with Retry-After

Usage:
  python3 tests/mock_radar.py 8765 &
  RADAR_BASE=http://127.0.0.1:8765 CF_RADAR_TOKEN=test python3 scripts/pull_radar.py --sleep 0
"""
import datetime as dt
import hashlib
import json
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

INDUSTRIES = [
    "Retail", "Computer Software", "Information Technology and Services", "Online Media", "Internet",
    "Telecommunications", "Publishing", "Media", "Financial Services", "Education Management",
    "Hospitality", "Information Services", "Market Research", "Marketing and Advertising", "Construction",
    "Gaming", "Gambling & Casinos", "Leisure, Travel & Tourism", "Consumer Services", "Government Administration",
    "Real Estate", "Manufacturing", "Nonprofit Organization Management", "E-Learning", "Newspapers",
    "Hospital & Health Care", "Print & Digital Media", "Health, Wellness and Fitness", "Entertainment", "Cryptocurrency",
    "Business Services", "Higher Education", "Automotive", "Legal Services", "Research", "Military",
]
VERTICALS = ["Shopping & General Merchandise", "Internet and Telecom", "Computer and Electronics",
             "News, Media, and Publications", "Games", "Finance", "Travel and Tourism", "Health"]
AGENTS = ["ChatGPT-User", "TikTokSpider", "Perplexity-User", "Claude-User", "MistralAI-User",
          "Google-NotebookLM", "Meta-ExternalFetcher", "DuckAssistBot"]
CALLS = {"n": 0}


def h(*parts):
    return int(hashlib.md5("|".join(map(str, parts)).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def shares(names, seed):
    w = [(n, (1.0 / (i + 1)) * (0.6 + 0.8 * h(seed, n))) for i, n in enumerate(names)]
    t = sum(v for _, v in w)
    return {n: v / t * 100 for n, v in w}


def status(purpose, industry, agent, month):
    m = 0 if not month else (int(month[:4]) - 2025) * 12 + int(month[5:7]) - 1  # 0 = Jan 2025
    if purpose == "Training":
        r403, r402 = 12 + 3 * h("t", industry), 0.08
    else:
        r403 = 15 + 0.6 * m + 40 * h("i403", industry) * (1 if industry else 0)
        r402 = (0.02 if m < 8 else 0.4 + 0.05 * m) * (0.2 + 3 * h("i402", industry) if industry else 1)
        if industry == "Gaming" and m >= 17:
            r402 = 60 + 8 * h("g", month)
        if agent:
            r403 *= 0.6 + 1.2 * h("a", agent)
            r402 *= 3 if agent == "ChatGPT-User" else 0.1
    r403, r402 = min(r403, 85), min(r402, 70)
    rest = 100 - r403 - r402
    d = {"200": rest * 0.72, "206": rest * 0.1, "301": rest * 0.06, "404": rest * 0.08, "429": rest * 0.03,
         "503": rest * 0.01, "403": r403, "402": r402}
    return {k: f"{v:.6f}" for k, v in d.items()}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def send(self, code, body, headers=None):
        raw = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def bad(self, msg):
        self.send(400, {"success": False, "errors": [{"code": 10000, "message": msg}], "result": {}})

    def do_GET(self):
        CALLS["n"] += 1
        if not self.headers.get("Authorization", "").startswith("Bearer "):
            return self.send(401, {"success": False, "errors": [{"message": "missing token"}]})
        if CALLS["n"] % 250 == 0:
            return self.send(429, {"success": False, "errors": [{"message": "rate limited"}]}, {"Retry-After": "1"})

        path, _, raw_q = self.path.partition("?")
        dim = path.rstrip("/").rsplit("/", 1)[-1]
        q = {}
        for pair in raw_q.split("&"):
            if not pair:
                continue
            k, _, v = pair.partition("=")
            once = urllib.parse.unquote(v)
            if k in ("industry", "vertical") and "," in once:
                return self.bad(f"Invalid value for {k}: commas separate list items")
            q[k] = urllib.parse.unquote(once)

        end = q.get("dateEnd")
        if end and dt.datetime.strptime(end, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=dt.timezone.utc) > dt.datetime.now(dt.timezone.utc):
            return self.bad("dateEnd cannot be in the future")
        limit = int(q.get("limitPerGroup", 20))
        # A one-month window gets month-specific data; the snapshot window gets the blend.
        month = q.get("dateStart", "")[:7] if q.get("dateStart", "")[:7] == q.get("dateEnd", "")[:7] else ""
        purpose = q.get("crawlPurpose", "")
        ind = q.get("industry", "")

        if dim == "RESPONSE_STATUS":
            data = status(purpose, ind, q.get("userAgent", ""), month)
        elif dim == "INDUSTRY":
            s = shares(INDUSTRIES, ("ind", purpose, q.get("responseStatus"), month))
            if q.get("responseStatus") == "402" and month >= "2026-06":
                s = {k: v * (40 if k == "Gaming" else 1) for k, v in s.items()}
                t = sum(s.values())
                s = {k: v / t * 100 for k, v in s.items()}
            data = self.limit(s, limit)
        elif dim == "VERTICAL":
            data = self.limit(shares(VERTICALS, ("v", q.get("responseStatus"))), limit)
        elif dim == "USER_AGENT":
            s = shares(AGENTS, ("ua", q.get("responseStatus")))
            if q.get("responseStatus") == "402":
                s = {k: (97.5 if k == "ChatGPT-User" else 2.5 / 4) for k in AGENTS[:5]}
            data = self.limit(s, limit)
        elif dim == "CRAWL_PURPOSE":
            data = {"Mixed Purpose": "43.5", "Training": "43.1", "Search": "9.9", "User Action": "2.7", "Undeclared": "0.8"}
        else:
            return self.bad(f"unknown dimension {dim}")

        meta = {"lastUpdated": dt.datetime.now(dt.timezone.utc).isoformat(), "confidenceInfo": {"level": 5, "annotations": [
            {"dataSource": "AI_BOTS", "description": "Mock: example data-quality note", "startDate": "2026-03-10T00:00:00Z", "endDate": "2026-03-12T00:00:00Z", "eventType": "PIPELINE"}]}}
        self.send(200, {"success": True, "result": {"meta": meta, "summary_0": data}})

    @staticmethod
    def limit(s, n):
        items = sorted(s.items(), key=lambda kv: -kv[1])
        out = {k: f"{v:.6f}" for k, v in items[:n]}
        if len(items) > n:
            out["other"] = f"{sum(v for _, v in items[n:]):.6f}"
        return out


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
