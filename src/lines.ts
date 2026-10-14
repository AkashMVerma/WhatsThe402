// Short, computed takeaways for the 402 Index overview. Every sentence is built
// from the data so it stays true after each daily refresh.
import { monthLabel, pct } from "./format";
import type { Dataset, Industry } from "./types";

/** One line comparing month k with a year earlier (or with the first month). */
export function compareLine(months: string[], vals: number[], k: number, opts: { peakFirst?: boolean } = {}): string {
  const p = vals.indexOf(Math.max(...vals));
  // For a series that has fallen well below its peak, the peak is the useful comparison.
  if (opts.peakFirst && k > p && vals[k] < vals[p] * 0.6) {
    return `Down from ${pct(vals[p])} at its peak in ${monthLabel(months[p])}.`;
  }
  if (k === 0) return `First month in the series.`;
  const j = k >= 12 ? k - 12 : 0;
  const r = vals[k] / (vals[j] || Number.EPSILON);
  const then = monthLabel(months[j]);
  if (r >= 2.75) return `About ${Math.round(r)} times the rate of ${then}.`;
  if (r >= 1.75) return `About twice the rate of ${then}.`;
  if (r >= 1.1) return `Up from ${pct(vals[j])} in ${then}.`;
  if (r > 0.9) return `About the same as ${then} (${pct(vals[j])}).`;
  return `Down from ${pct(vals[j])} in ${then}.`;
}

export interface Mover {
  ind: Industry;
  before: number;
  after: number;
  series: number[];
}

/**
 * Industries whose agent 402 rate rose most: the latest three months against the
 * three months half a year earlier. Only industries Radar tracks monthly.
 */
export function rising402(d: Dataset, n = 5): { rows: Mover[]; before: string; after: string } | null {
  const months = d.monthly.map((m) => m.month);
  const L = months.length - 1;
  if (L < 8) return null;
  const A = months.slice(L - 8, L - 5);
  const B = months.slice(L - 2);
  const avg = (i: Industry, ms: string[]) => {
    const v = i.monthly!.filter((x) => ms.includes(x.month)).map((x) => x["402"]);
    return v.reduce((s, x) => s + x, 0) / (v.length || 1);
  };
  const rows = d.industries
    .filter((i) => i.monthly?.length && !i.lowVolume)
    .map((i) => ({ ind: i, before: avg(i, A), after: avg(i, B), series: i.monthly!.map((x) => x["402"]) }))
    // A real rise, not noise: at least half again the earlier rate and 0.1 points.
    .filter((r) => r.after >= r.before * 1.5 && r.after - r.before >= 0.1)
    .sort((a, b) => b.after - b.before - (a.after - a.before))
    .slice(0, n);
  return { rows, before: `${monthLabel(A[0], true)} to ${monthLabel(A[2])}`, after: `${monthLabel(B[0], true)} to ${monthLabel(B[2])}` };
}

/** Industries that receive the largest share of all refused agent requests, year to date. */
export function refusedDemand(d: Dataset, n = 5): Industry[] {
  return d.industries
    .filter((i) => !i.lowVolume)
    .sort((a, b) => b.shareOfAgent403 - a.shareOfAgent403)
    .slice(0, n);
}

/** Tiny inline sparkline (no axes) for a 0-based series. */
export function spark(vals: number[], color: string): string {
  const w = 84;
  const h = 22;
  const max = Math.max(...vals, 0.0001);
  const pts = vals.map((v, i) => `${((i / Math.max(1, vals.length - 1)) * (w - 4) + 2).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`);
  const last = pts[pts.length - 1].split(",");
  return `<svg class="mini" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true"><polyline points="${pts.join(" ")}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${color}"/></svg>`;
}
