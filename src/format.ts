const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Percent with precision that scales with magnitude, so 0.04% and 82.8% both read correctly. */
export function pct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "n/a";
  if (v === 0) return "0%";
  if (v < 0.01) return "<0.01%";
  if (v < 1) return `${v.toFixed(2)}%`;
  return `${v.toFixed(1)}%`;
}

export function ratio(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  if (v >= 10) return `${Math.round(v)}×`;
  return `${v.toFixed(1)}×`;
}

/** "2025-07" -> "Jul 2025" (or "Jul" with short=true). */
export function monthLabel(ym: string, short = false): string {
  const [y, m] = ym.split("-");
  const name = MONTHS[Number(m) - 1];
  return short ? name : `${name} ${y}`;
}

/** "2026-08-18" -> "18 Aug 2026" */
export function dateLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
