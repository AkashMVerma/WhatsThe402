// Short, computed takeaways for the 402 Index overview. Every sentence is built
// from the data so it stays true after each daily refresh.
import { monthLabel, pct } from "./format";
import type { Dataset, Industry } from "./types";

const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
/** "August" within the same year as `ref`, otherwise "December 2025". */
const nameOf = (ym: string, ref: string) => (ym.slice(0, 4) === ref.slice(0, 4) ? LONG[+ym.slice(5) - 1] : `${LONG[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`);

/**
 * One line under a headline number: the change from the previous month, then
 * either the year-on-year change or, for a series well below its peak, the peak.
 */
export function compareLine(months: string[], vals: number[], k: number, opts: { peakFirst?: boolean } = {}): string {
  if (k === 0) return "First month in the series.";
  const cur = months[k];
  const v = vals[k];
  const pv = vals[k - 1];
  const prevName = nameOf(months[k - 1], cur);
  const rm = v / (pv || Number.EPSILON);
  const dirM = rm >= 1.1 ? 1 : rm > 0.9 ? 0 : -1;
  const mom = dirM > 0 ? `Up from ${pct(pv)} in ${prevName}` : dirM < 0 ? `Down from ${pct(pv)} in ${prevName}` : `About the same as ${prevName} (${pct(pv)})`;

  const p = vals.indexOf(Math.max(...vals));
  if (opts.peakFirst && k > p && p !== k - 1 && v < vals[p] * 0.6) {
    return `${mom}, and well below its ${nameOf(months[p], cur)} peak of ${pct(vals[p])}.`;
  }
  if (k < 12) return `${mom}.`;
  const y = vals[k - 12];
  const r = v / (y || Number.EPSILON);
  const dirY = r >= 1.1 ? 1 : r > 0.9 ? 0 : -1;
  const yoy =
    r >= 2.75
      ? `about ${Math.round(r)} times the rate a year earlier`
      : r >= 1.75
        ? "about twice the rate a year earlier"
        : dirY > 0
          ? `up from ${pct(y)} a year earlier`
          : dirY < 0
            ? `down from ${pct(y)} a year earlier`
            : "about the same as a year earlier";
  const join = dirM !== 0 && dirY !== 0 && dirM !== dirY ? ", but " : ", and ";
  return `${mom}${join}${yoy}.`;
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

/** "about twice as often as", "more often than", ... for a ratio a/b. */
export function often(r: number): string {
  if (!Number.isFinite(r)) return "more often than";
  if (r >= 2.75) return `about ${Math.round(r)} times as often as`;
  if (r >= 1.75) return "about twice as often as";
  if (r >= 1.6) return "almost twice as often as";
  if (r >= 1.15) return "more often than";
  if (r > 0.87) return "about as often as";
  return "less often than";
}

/**
 * One-line findings about which agents are refused, computed year to date:
 * the busiest agent against the agents refused clearly more often, and agents
 * against AI training crawlers.
 */
export function agentFindings(d: Dataset): { lines: string[]; rows: { name: string; rate: number; share: number }[] } {
  const rows = d.bots
    .filter((b) => b.rates?.["403"] != null)
    .map((b) => ({ name: b.name, rate: b.rates!["403"]!, share: b.trafficShare }))
    .sort((a, b) => b.share - a.share);
  const lines: string[] = [];
  const top = rows[0];
  if (top) {
    const harder = rows.filter((r) => r !== top && r.rate >= top.rate * 1.4);
    if (harder.length >= 2) {
      const avgRate = harder.reduce((s, r) => s + r.rate, 0) / harder.length;
      const names = harder.slice(0, 3).map((r) => r.name);
      const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
      lines.push(`${list} are refused ${often(avgRate / top.rate)} ${top.name}, the busiest agent (about ${Math.round(avgRate)}% against ${Math.round(top.rate)}%).`);
    }
  }
  const ag = d.overall.agents["403"];
  const tr = d.overall.trainers["403"];
  lines.push(`Websites refuse AI agents ${often(ag / tr)} AI training crawlers (${Math.round(ag)}% against ${Math.round(tr)}% this year).`);
  return { lines, rows };
}
