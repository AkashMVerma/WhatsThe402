#!/usr/bin/env python3
"""
Full Cloudflare Radar industry sweep for 4Mica.
Discovers ALL industries/verticals visible in the AI Bots dataset, then pulls the
complete response-status distribution for each, for two windows:
  - 2026-01-01 .. 2026-08-18 (YTD only)
Usage:
  CF_RADAR_TOKEN=... python3 radar_sweep.py > radar_sweep_out.json
Token: dash.cloudflare.com -> My Profile -> API Tokens -> Custom Token -> Account > Radar > Read.
~80 requests, well under the 1,200/5min limit.
"""
import json, os, ssl, sys, time, urllib.parse, urllib.request

try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    sys.exit("Missing certificates for HTTPS. Run:  pip install certifi  and retry.")

TOKEN = os.environ.get("CF_RADAR_TOKEN") or (sys.argv[1] if len(sys.argv) > 1 else None)
if not TOKEN:
    sys.exit("Set CF_RADAR_TOKEN or pass token as first arg")

BASE = "https://api.cloudflare.com/client/v4/radar/ai/bots/summary"
WINDOWS = {"ytd": {"dateStart": "2026-01-01T00:00:00Z", "dateEnd": "2026-08-18T00:00:00Z"}}

def get(dimension, **params):
    q = list(params.items())
    url = f"{BASE}/{dimension}?{urllib.parse.urlencode(q)}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
                res = json.load(r)["result"]
                for k, v in res.items():
                    if k != "meta" and isinstance(v, dict):
                        return v
                return {"error": "no data block", "keys": list(res.keys())}
        except Exception as e:
            if attempt == 2:
                return {"error": str(e)[:200], "url": url}
            time.sleep(2)

out = {"meta": "Cloudflare Radar /radar/ai/bots/summary, pulled " + time.strftime("%Y-%m-%d")}

for wname, wparams in WINDOWS.items():
    W = out[wname] = {}
    # 1. discover industries and verticals (with and without User Action filter)
    W["industries_all_traffic"] = get("INDUSTRY", limitPerGroup=100, **wparams)
    W["industries_ua"] = get("INDUSTRY", limitPerGroup=100, crawlPurpose="User Action", **wparams)
    W["verticals_ua"] = get("VERTICAL", limitPerGroup=100, crawlPurpose="User Action", **wparams)
    # rankings by response type
    for code in ["403", "402", "429"]:
        W[f"industries_ua_{code}"] = get("INDUSTRY", limitPerGroup=100, crawlPurpose="User Action", responseStatus=code, **wparams)
        W[f"verticals_ua_{code}"] = get("VERTICAL", limitPerGroup=100, crawlPurpose="User Action", responseStatus=code, **wparams)
    # 2. union of every industry name seen in any ranking
    inds = set()
    for k in ["industries_ua", "industries_ua_403", "industries_ua_402", "industries_ua_429", "industries_all_traffic"]:
        d = W.get(k) or {}
        inds.update(x for x in d.keys() if x not in ("other", "error", "url"))
    # 3. full status distribution per industry, User Action and Training
    W["status_ua_by_industry"] = {}
    W["status_training_by_industry"] = {}
    for ind in sorted(inds):
        W["status_ua_by_industry"][ind] = get("RESPONSE_STATUS", limitPerGroup=25, crawlPurpose="User Action", industry=ind, **wparams)
        W["status_training_by_industry"][ind] = get("RESPONSE_STATUS", limitPerGroup=25, crawlPurpose="Training", industry=ind, **wparams)
        time.sleep(0.15)
    # baselines
    W["status_ua_overall"] = get("RESPONSE_STATUS", limitPerGroup=25, crawlPurpose="User Action", **wparams)
    W["status_training_overall"] = get("RESPONSE_STATUS", limitPerGroup=25, crawlPurpose="Training", **wparams)
    W["crawl_purpose"] = get("CRAWL_PURPOSE", **wparams)
    sys.stderr.write(f"{wname}: {len(inds)} industries swept\n")

json.dump(out, sys.stdout, indent=1)
