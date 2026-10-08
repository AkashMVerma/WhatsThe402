#!/usr/bin/env python3
"""
Comma-industry workaround test + fetch for Cloudflare Radar AI Bots.
The list separator for the `industry` filter is a comma, so names containing
commas 400. This script tries several encodings against one known-good control
and, if any variant works, fetches the three missing industries with it.
Usage: CF_RADAR_TOKEN=... python3 radar_comma_fix.py > radar_comma_out.json
"""
import json, os, ssl, sys, time, urllib.request

try:
    import certifi
    CTX = ssl.create_default_context(cafile=certifi.where())
except ImportError:
    sys.exit("pip install certifi first")

TOKEN = os.environ.get("CF_RADAR_TOKEN") or (sys.argv[1] if len(sys.argv) > 1 else None)
if not TOKEN:
    sys.exit("Set CF_RADAR_TOKEN")

BASE = "https://api.cloudflare.com/client/v4/radar/ai/bots/summary/RESPONSE_STATUS"
DATES = "dateStart=2026-01-01T00%3A00%3A00Z&dateEnd=2026-08-18T00%3A00%3A00Z"

def call(industry_param):
    url = f"{BASE}?limitPerGroup=25&crawlPurpose=User%20Action&industry={industry_param}&{DATES}"
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {TOKEN}"})
    try:
        with urllib.request.urlopen(req, timeout=60, context=CTX) as r:
            res = json.load(r)["result"]
            for k, v in res.items():
                if k != "meta" and isinstance(v, dict):
                    return {"ok": True, "data": v, "url": url}
            return {"ok": False, "why": "no block", "url": url}
    except Exception as e:
        return {"ok": False, "why": str(e)[:120], "url": url}

# Variants to try, using Leisure, Travel & Tourism as the test name.
NAME = "Leisure, Travel & Tourism"
variants = {
    "pct2C":   "Leisure%2C%20Travel%20%26%20Tourism",       # standard single encoding (known to 400)
    "pct252C": "Leisure%252C%20Travel%20%26%20Tourism",     # double-encoded comma
    "backslash": "Leisure%5C%2C%20Travel%20%26%20Tourism",  # escaped comma
    "quoted":  "%22Leisure%2C%20Travel%20%26%20Tourism%22", # quoted value
    "semicolon_list": "Leisure%3B%20Travel%20%26%20Tourism",# wrong name, control for false positives
    "no_comma": "Leisure%20Travel%20%26%20Tourism",         # name without comma (may not match)
}
out = {"meta": "comma workaround test, pulled " + time.strftime("%Y-%m-%d"), "tests": {}}
working = None
control = call("Publishing")  # known-good; also gives a shape/sanity reference
out["control_Publishing"] = control if not control.get("ok") else {"ok": True, "s403": control["data"].get("403")}

for tag, v in variants.items():
    r = call(v)
    ok = r.get("ok", False)
    # guard against false positives: an unfiltered response would match overall UA stats (403 ~22.7)
    out["tests"][tag] = {"ok": ok, "why": r.get("why"), "s403": r["data"].get("403") if ok else None}
    if ok and working is None and tag not in ("semicolon_list",):
        working = (tag, v)
    time.sleep(0.3)

if working:
    tag, _ = working
    out["working_variant"] = tag
    def enc(name):
        base = urllib.parse.quote(name, safe="") if False else None
    import urllib.parse as up
    def encode(name, tag):
        e = up.quote(name, safe="")
        if tag == "pct252C": return e.replace("%2C", "%252C")
        if tag == "backslash": return e.replace("%2C", "%5C%2C")
        if tag == "quoted": return "%22" + e + "%22"
        if tag == "no_comma": return up.quote(name.replace(",", ""), safe="")
        return e
    targets = ["Health, Wellness and Fitness",
               "Internet Service Providers, Website Hosting & Internet-related Services",
               "Leisure, Travel & Tourism"]
    out["fetched"] = {}
    for t in targets:
        r = call(encode(t, tag))
        out["fetched"][t] = r.get("data") if r.get("ok") else {"error": r.get("why")}
        time.sleep(0.3)
else:
    out["working_variant"] = None

json.dump(out, sys.stdout, indent=1)
sys.stderr.write(f"working variant: {out['working_variant']}\n")
