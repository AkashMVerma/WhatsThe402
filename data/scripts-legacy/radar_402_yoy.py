#!/usr/bin/env python3
"""
402 YoY comparison: monthly 402/403 response rates for AI bot traffic,
2025 vs 2026, from Cloudflare Radar. Adapted from radar_sweep.py plumbing
(certifi TLS, retries, summary_0 parsing, %252C comma-industry fix).

For each month it pulls the RESPONSE_STATUS summary twice:
  - all AI bot traffic
  - crawlPurpose=User Action (agents fetching for a user)
limitPerGroup=40 so tiny codes like 402 are never folded into "other"
(the Data Explorer default of 20 hides sub-cutoff codes; this was the
likely reason a March 2026 all-bots pull showed no 402 at all).

Usage:
  CF_RADAR_TOKEN=... python3 radar_402_yoy.py > radar_402_yoy_out.json
Prints a readable table to stderr and full JSON to stdout.
"""
import json, os, ssl, sys, time, urllib.parse, urllib.request

try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    sys.exit("pip install certifi first")

TOKEN = os.environ.get("CF_RADAR_TOKEN") or (sys.argv[1] if len(sys.argv) > 1 else None)
if not TOKEN:
    sys.exit("Set CF_RADAR_TOKEN")

BASE = "https://api.cloudflare.com/client/v4/radar/ai/bots/summary/RESPONSE_STATUS"
MONTH_ENDS = {1:31,2:28,3:31,4:30,5:31,6:30,7:31,8:31,9:30,10:31,11:30,12:31}

def get(**params):
    q = urllib.parse.urlencode(list(params.items()))
    url = f"{BASE}?{q}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
                res = json.load(r)["result"]
                for k, v in res.items():
                    if k != "meta" and isinstance(v, dict):
                        return v
                return {"error": "no data block"}
        except Exception as e:
            if attempt == 2:
                return {"error": str(e)[:150], "url": url}
            time.sleep(2)

def month_pull(y, m, purpose=None):
    p = {"dateStart": f"{y}-{m:02d}-01T00:00:00Z",
         "dateEnd": f"{y}-{m:02d}-{MONTH_ENDS[m]}T23:59:59Z",
         "limitPerGroup": 40}
    if purpose:
        p["crawlPurpose"] = purpose
    return get(**p)

out = {"meta": "Radar RESPONSE_STATUS monthly, all AI bots and User Action, pulled " + time.strftime("%Y-%m-%d"),
       "months": {}}
sys.stderr.write(f"{'month':<9}{'402 all':>9}{'402 UA':>9}{'403 all':>9}{'403 UA':>9}\n")
for y in (2025, 2026):
    for m in range(1, 13):
        if y == 2026 and m > 8:  # adjust as months accrue
            break
        key = f"{y}-{m:02d}"
        allb = month_pull(y, m)
        ua = month_pull(y, m, "User Action")
        out["months"][key] = {"all": allb, "user_action": ua}
        def g(d, c):
            try: return float(d.get(c, 0) or 0)
            except Exception: return 0.0
        e = "ERR" if ("error" in allb or "error" in ua) else ""
        sys.stderr.write(f"{key:<9}{g(allb,'402'):>9.3f}{g(ua,'402'):>9.3f}{g(allb,'403'):>9.2f}{g(ua,'403'):>9.2f} {e}\n")
        time.sleep(0.3)

# YoY summary for months present in both years
sys.stderr.write("\nYoY 402 (User Action), 2026 vs 2025:\n")
for m in range(1, 9):
    a = out["months"].get(f"2025-{m:02d}", {}).get("user_action", {})
    b = out["months"].get(f"2026-{m:02d}", {}).get("user_action", {})
    try:
        va, vb = float(a.get("402", 0) or 0), float(b.get("402", 0) or 0)
        ratio = (vb / va) if va > 0 else float("inf") if vb > 0 else 0
        sys.stderr.write(f"  {m:02d}: {va:.3f}% -> {vb:.3f}%  ({'x%.1f' % ratio if va>0 else 'n/a (2025 below floor)'})\n")
    except Exception:
        pass
json.dump(out, sys.stdout, indent=1)
