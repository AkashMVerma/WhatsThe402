#!/usr/bin/env python3
"""
Verify every number the site publishes against the raw Radar pull it came from.

Written separately from build_dataset.py on purpose: it re-derives each figure
from the raw pull with its own code, so a bug in the build cannot hide itself.

Checks
  1. Recompute: every published figure equals the raw Radar value it claims to be.
  2. Cross-check: Radar answers several separate questions that must agree.
     An industry's 403 rate (asked directly) must equal
         its share of all agent 403s x the overall agent 403 rate / its share of agent traffic
     (each of the three asked in a separate request). Same for 402, for agents,
     and month by month for the 30 tracked industries.
  3. Sanity: distributions sum to ~100%, rates are 0-100, months are complete
     and contiguous, the snapshot window does not run past the pull date.
  4. Revisions: months that also appear in the August 2026 data pack, and how
     far Radar has revised them since.

Usage:
  python3 scripts/verify_dataset.py                    # newest pull vs public/data/index.json
  python3 scripts/verify_dataset.py PULL.json.gz INDEX.json
Writes public/data/verification.json and prints a summary. Exit code 1 if
check 1 or 3 fails (check 2 and 4 are reported, not enforced).
"""
import datetime as dt
import gzip
import json
import pathlib
import statistics
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
CODES = ["200", "402", "403", "404", "429"]
TOL = 1e-5  # recompute tolerance (index rounds to 6 decimals)


def load_pull(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


class Report:
    def __init__(self):
        self.recompute = {"checked": 0, "mismatches": []}
        self.sanity = {"checked": 0, "failures": []}
        self.cross = {}
        self.revisions = {}

    def eq(self, where, published, raw):
        self.recompute["checked"] += 1
        if published is None and raw is None:
            return
        if published is None or raw is None or abs(float(published) - float(raw)) > TOL:
            self.recompute["mismatches"].append({"where": where, "published": published, "raw": raw})

    def ok(self, where, cond, detail=""):
        self.sanity["checked"] += 1
        if not cond:
            self.sanity["failures"].append({"where": where, "detail": detail})


def g(d, k):
    return None if d is None else float(d.get(k, 0.0))


def recompute(R, P, I):
    S = P["snapshot"]
    months = sorted(m for m, b in P["monthly"].items() if b.get("agents") and b.get("all"))
    pub_months = [m["month"] for m in I["monthly"]]
    R.ok("monthly: published months = complete months in pull", pub_months == months, f"{pub_months} vs {months}")
    for row in I["monthly"]:
        raw = P["monthly"][row["month"]]
        for c in CODES:
            R.eq(f"monthly {row['month']} agents {c}", row["agents"][c], g(raw["agents"], c))
            R.eq(f"monthly {row['month']} allBots {c}", row["allBots"][c], g(raw["all"], c))
            if row.get("training") is not None:
                R.eq(f"monthly {row['month']} training {c}", row["training"][c], g(raw["training"], c))

    for c in CODES:
        R.eq(f"overall agents {c}", I["overall"]["agents"][c], g(S["statusAgents"], c))
        R.eq(f"overall trainers {c}", I["overall"]["trainers"][c], g(S["statusTraining"], c))

    traffic = S.get("industriesAgents") or {}
    sh = {c: S.get(f"industriesAgents{c}") or {} for c in ("403", "402", "429")}
    raw_names = {k for k, v in (S.get("statusAgentsByIndustry") or {}).items() if v}
    pub_names = {i["name"] for i in I["industries"]}
    R.ok("industries: same set as pull", raw_names == pub_names, f"missing {sorted(raw_names - pub_names)}, extra {sorted(pub_names - raw_names)}")
    thr = I["meta"]["lowVolumeThresholdPct"]
    for ind in I["industries"]:
        n = ind["name"]
        ua = S["statusAgentsByIndustry"].get(n)
        tr = (S.get("statusTrainingByIndustry") or {}).get(n)
        for c in CODES:
            R.eq(f"industry {n} agents {c}", ind["agents"][c], g(ua, c))
            if ind["trainers"] is not None or tr:
                R.eq(f"industry {n} trainers {c}", None if ind["trainers"] is None else ind["trainers"][c], g(tr, c))
        R.eq(f"industry {n} traffic share", ind["agentTrafficShare"], traffic.get(n))
        for c in ("403", "402", "429"):
            R.eq(f"industry {n} share of agent {c}s", ind[f"shareOfAgent{c}"], sh[c].get(n, 0.0))
        t = traffic.get(n)
        R.ok(f"industry {n} low-volume flag", ind["lowVolume"] == (t is None or t < thr), f"flag {ind['lowVolume']}, traffic {t}")
        im = (P.get("industryMonthly") or {}).get(n)
        if ind.get("monthly"):
            for pt in ind["monthly"]:
                for c in ("403", "402"):
                    R.eq(f"industry {n} {pt['month']} agents {c}", pt[c], g(im[pt["month"]], c))

    for b in I["bots"]:
        n = b["name"]
        R.eq(f"agent {n} traffic share", b["trafficShare"], (S.get("agentsTraffic") or {}).get(n))
        for c, key in (("402", "shareOfAgent402"), ("403", "shareOfAgent403")):
            src = S.get(f"agents{c}")
            if b.get(key) is not None or (src and n in src):
                R.eq(f"agent {n} share of {c}s", b.get(key), None if not src else src.get(n))
        raw = (S.get("statusByAgent") or {}).get(n)
        for c, v in (b.get("rates") or {}).items():
            R.eq(f"agent {n} {c} rate", v, g(raw, c))

    for key, src, field in (("verticals402", "verticalsAgents402", "shareOfAgent402"), ("verticals403", "verticalsAgents403", "shareOfAgent403")):
        for v in I[key]:
            R.eq(f"vertical {v['name']} {field}", v[field], (S.get(src) or {}).get(v["name"]))


def sanity(R, P, I):
    def dist_ok(where, d):
        if not d:
            return
        tot = sum(d.values())
        R.ok(f"{where} sums to 100%", abs(tot - 100) < 0.6, f"sum {tot:.3f}")
        R.ok(f"{where} values in 0-100", all(0 <= v <= 100 for v in d.values()), "")

    for m, b in P["monthly"].items():
        for k in ("all", "agents", "training"):
            dist_ok(f"monthly {m} {k}", b.get(k))
    S = P["snapshot"]
    for k in ("statusAgents", "statusTraining", "statusAll", "crawlPurpose", "industriesAgents", "industriesAgents403", "industriesAgents402", "agentsTraffic"):
        dist_ok(f"snapshot {k}", S.get(k))
    for n, d in (S.get("statusAgentsByIndustry") or {}).items():
        dist_ok(f"industry {n} agents", d)

    months = sorted(P["monthly"])
    exp, (y, m) = [], map(int, months[0].split("-"))
    while len(exp) < len(months):
        exp.append(f"{y}-{m:02d}")
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    R.ok("months contiguous", months == exp, f"{months}")
    pulled = dt.datetime.fromisoformat(P["pulledAt"].replace("Z", "+00:00"))
    last = dt.datetime.strptime(months[-1] + "-01", "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)
    nxt = (last.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    R.ok("last month complete before pull", nxt <= pulled, f"{months[-1]} vs pulled {P['pulledAt']}")
    end = dt.datetime.fromisoformat(P["windows"]["snapshot"]["dateEnd"].replace("Z", "+00:00"))
    R.ok("snapshot window ends before pull", end <= pulled, "")
    R.ok("pull reported no failed requests", not P.get("errors"), f"{len(P.get('errors') or [])} failed")


def summarise(diffs):
    if not diffs:
        return {"n": 0}
    ab = sorted(abs(d["diff"]) for d in diffs)
    return {
        "n": len(ab),
        "medianAbsDiffPP": round(statistics.median(ab), 3),
        "p90AbsDiffPP": round(ab[int(0.9 * (len(ab) - 1))], 3),
        "within1pp": sum(a <= 1 for a in ab),
        "largest": sorted(diffs, key=lambda d: -abs(d["diff"]))[:5],
    }


def check_groups(label, overall, shares_c, traffic, direct, min_traffic):
    """Radar answers three separate questions per group (share of traffic, share of
    all responses with code c, rate of c within the group). They must satisfy
        rate_g = share_c_g * R / traffic_g
    where R is the code's rate across the population the breakdown covers. Industry
    breakdowns cover only sites Cloudflare has assigned an industry, so R is that
    population's rate, not the all-traffic rate. We take R = overall / k, with k the
    median of implied/direct across groups, and report k and how tightly every
    group fits it."""
    pairs = []
    for n, t in traffic.items():
        d = direct.get(n)
        if n == "other" or not t or t < min_traffic or d is None:
            continue
        implied = shares_c.get(n, 0.0) * overall / t
        pairs.append((n, d, implied))
    usable = [imp / d for _, d, imp in pairs if d > 0.05]
    if not usable:
        return {"n": 0}
    k = statistics.median(usable)
    diffs = [{"what": n, "direct": round(d, 3), "implied": round(imp / k, 3), "diff": round(imp / k - d, 3)} for n, d, imp in pairs]
    out = summarise(diffs)
    out["populationFactor"] = round(k, 4)
    out["coveredPopulationRate"] = round(overall / k, 4)
    out["overallRate"] = round(overall, 4)
    return out


def cross(R, P, I):
    S = P["snapshot"]
    thr = I["meta"]["lowVolumeThresholdPct"]
    for c in ("403", "402"):
        direct = {n: (d or {}).get(c, 0.0) for n, d in (S.get("statusAgentsByIndustry") or {}).items() if d}
        R.cross[f"industries_{c}_snapshot"] = check_groups(c, S["statusAgents"].get(c, 0.0), S.get(f"industriesAgents{c}") or {}, S.get("industriesAgents") or {}, direct, thr)
        direct = {n: (d or {}).get(c) for n, d in (S.get("statusByAgent") or {}).items() if d}
        R.cross[f"agents_{c}_snapshot"] = check_groups(c, S["statusAgents"].get(c, 0.0), S.get(f"agents{c}") or {}, S.get("agentsTraffic") or {}, direct, 0)
        per_month = {}
        for m in sorted(P.get("monthlyIndustryShares") or {}):
            sh = P["monthlyIndustryShares"][m] or {}
            direct = {n: (series.get(m) or {}).get(c, 0.0) for n, series in (P.get("industryMonthly") or {}).items() if series.get(m)}
            if not direct or not sh.get("traffic") or not (P["monthly"][m].get("agents")):
                continue
            per_month[m] = check_groups(c, P["monthly"][m]["agents"].get(c, 0.0), sh.get(c) or {}, sh["traffic"], direct, 0.5)
        flat = [d for v in per_month.values() for d in v.get("largest", [])]
        R.cross[f"industries_{c}_monthly"] = {
            "months": len(per_month),
            "medianAbsDiffPP": round(statistics.median([v["medianAbsDiffPP"] for v in per_month.values() if v.get("n")]), 3) if per_month else None,
            "populationFactorByMonth": {m: v.get("populationFactor") for m, v in per_month.items()},
            "largest": sorted(flat, key=lambda d: -abs(d["diff"]))[:5],
        }


def revisions(R, P):
    pack = ROOT / "data" / "raw" / "radar_402_yoy_out.json"
    if not pack.exists():
        return
    old = json.load(open(pack))["months"]
    for c in ("403", "402"):
        diffs = []
        for m, b in old.items():
            ua = b.get("user_action") or {}
            if "error" in ua or m not in P["monthly"] or not P["monthly"][m].get("agents"):
                continue
            then, now = float(ua.get(c, 0)), P["monthly"][m]["agents"].get(c, 0.0)
            diffs.append({"what": m, "direct": round(then, 3), "implied": round(now, 3), "diff": round(now - then, 3)})
        s = summarise(diffs)
        s["note"] = "direct = August 2026 pack, implied = this pull"
        R.revisions[f"agents_{c}"] = s


def main():
    if len(sys.argv) == 3:
        pull_path, index_path = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
    else:
        pulls = sorted((ROOT / "data" / "pulls").glob("radar-*.json.gz"))
        if not pulls:
            sys.exit("No pull in data/pulls; nothing to verify against.")
        pull_path, index_path = pulls[-1], ROOT / "public" / "data" / "index.json"
    P, I = load_pull(pull_path), json.load(open(index_path))
    if I["meta"].get("inputFile") != pull_path.name:
        sys.exit(f"index.json was built from {I['meta'].get('inputFile')}, not {pull_path.name}. Rebuild first.")

    R = Report()
    recompute(R, P, I)
    sanity(R, P, I)
    cross(R, P, I)
    revisions(R, P)

    out = {
        "verifiedAt": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "pull": pull_path.name,
        "pulledAt": P["pulledAt"],
        "recompute": {"checked": R.recompute["checked"], "mismatches": len(R.recompute["mismatches"]), "examples": R.recompute["mismatches"][:20]},
        "sanity": {"checked": R.sanity["checked"], "failures": len(R.sanity["failures"]), "examples": R.sanity["failures"][:20]},
        "crossChecks": R.cross,
        "revisionsSinceAugustPack": R.revisions,
        "pullStats": P.get("stats"),
    }
    dest = index_path.parent / "verification.json"
    with open(dest, "w") as f:
        json.dump(out, f, indent=1)

    print(f"Verified {pull_path.name} -> {index_path.name}")
    print(f"  1. recompute: {out['recompute']['checked']} figures, {out['recompute']['mismatches']} mismatches")
    print(f"  3. sanity:    {out['sanity']['checked']} checks, {out['sanity']['failures']} failures")
    for k, v in R.cross.items():
        if v.get("n"):
            print(f"  2. cross {k:24s} n={v['n']:3d} factor {v['populationFactor']:.3f} (covered-population rate {v['coveredPopulationRate']}% vs all traffic {v['overallRate']}%), median |diff| {v['medianAbsDiffPP']:.3f} pp, p90 {v['p90AbsDiffPP']:.3f} pp, within 1pp {v['within1pp']}/{v['n']}")
        elif v.get("months"):
            print(f"  2. cross {k:24s} {v['months']} months, median of monthly median |diff| {v['medianAbsDiffPP']} pp, largest {v['largest'][:1]}")
    for k, v in R.revisions.items():
        if v.get("n"):
            print(f"  4. revision {k:10s} n={v['n']} median |diff| {v['medianAbsDiffPP']:.3f} pp, largest {v['largest'][0]}")
    for e in out["recompute"]["examples"][:5] + out["sanity"]["examples"][:5]:
        print("   !", e)
    print(f"Wrote {dest.relative_to(ROOT) if dest.is_relative_to(ROOT) else dest}")
    sys.exit(1 if out["recompute"]["mismatches"] or out["sanity"]["failures"] else 0)


if __name__ == "__main__":
    main()
