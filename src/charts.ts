import { scaleLinear, scaleLog, scalePoint } from "d3-scale";
import { line } from "d3-shape";
import { esc, monthLabel, pct } from "./format";

const NS = "http://www.w3.org/2000/svg";

export interface LineSeries {
  label: string;
  values: number[];
  /** CSS color expression, e.g. "var(--c403)". */
  color: string;
}

export interface LineChartOpts {
  months: string[];
  series: LineSeries[];
  yMax: number;
  yTicks: number[];
  annotation?: { index: number; text: string };
  ariaLabel: string;
  /** Shorter chart for use inside table rows. */
  compact?: boolean;
  /** Numbered markers for dated events (index into months). */
  events?: { index: number; n: number }[];
  /** Months to shade as "under review". */
  review?: number[];
  /** Month to ring on the first series (the month picked at the top). */
  focus?: number;
}

/** A rounded axis maximum and 3-5 evenly spaced ticks covering `max`. */
export function niceScale(max: number): { yMax: number; yTicks: number[] } {
  const target = Math.max(max, 0.01) * 1.08;
  const steps = [0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 1, 2, 2.5, 5, 10, 20, 25];
  const step = steps.find((st) => target / st <= 4) ?? 25;
  const n = Math.ceil(target / step);
  const ticks = Array.from({ length: n + 1 }, (_, i) => +(i * step).toFixed(2));
  return { yMax: n * step, yTicks: ticks };
}

/**
 * Monthly line chart with end labels, hairline grid and a crosshair tooltip.
 * Redraws at the container's real width so text never scales.
 */
let uidSeq = 0;

export function lineChart(host: HTMLElement, opts: LineChartOpts): () => void {
  host.classList.add("chart");
  const uid = ++uidSeq;
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;

  let active = -1;

  const draw = () => {
    const W = Math.max(280, host.clientWidth);
    const narrow = W < 460;
    const H = opts.compact ? 150 : narrow ? 200 : 230;
    const m = { top: 14, right: narrow ? 70 : 84, bottom: 26, left: 40 };
    const x = scalePoint<string>().domain(opts.months).range([m.left, W - m.right]);
    const y = scaleLinear().domain([0, opts.yMax]).range([H - m.bottom, m.top]);

    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", opts.ariaLabel);
    svg.setAttribute("tabindex", "0");

    let g = "";
    for (const t of opts.yTicks) {
      const yy = y(t);
      g += `<line x1="${m.left}" x2="${W - m.right}" y1="${yy}" y2="${yy}" class="${t === 0 ? "axis" : "grid"}"/>`;
      g += `<text x="${m.left - 8}" y="${yy}" class="tick" text-anchor="end" dominant-baseline="middle">${t}%</text>`;
    }
    opts.months.forEach((mo, i) => {
      const mm = mo.slice(5);
      const isJan = mm === "01";
      // Label density follows the space per month: years only, then Jan/Jul, then quarters.
      const perMonth = (W - m.left - m.right) / opts.months.length;
      const show = isJan || (perMonth > 14 && mm === "07") || (perMonth > 26 && (mm === "04" || mm === "10"));
      if (!show) return;
      const label = isJan ? monthLabel(mo) : monthLabel(mo, true);
      const anchor = i === 0 ? "start" : "middle";
      g += `<text x="${x(mo)}" y="${H - 6}" class="tick" text-anchor="${anchor}">${label}</text>`;
    });

    const step = opts.months.length > 1 ? x(opts.months[1])! - x(opts.months[0])! : 20;
    if (opts.review?.length) {
      g += `<defs><pattern id="hatch-${uid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hatch"/></pattern></defs>`;
      for (const i of opts.review) {
        const cx = x(opts.months[i])!;
        g += `<rect x="${cx - step / 2}" y="${m.top}" width="${step}" height="${H - m.bottom - m.top}" fill="url(#hatch-${uid})" class="review"/>`;
      }
    }
    for (const e of opts.events ?? []) {
      const ex = x(opts.months[e.index])!;
      g += `<line x1="${ex}" x2="${ex}" y1="${m.top + 9}" y2="${H - m.bottom}" class="event-rule"/>`;
      g += `<circle cx="${ex}" cy="${m.top}" r="8" class="event-dot"/><text x="${ex}" y="${m.top}" class="event-n" text-anchor="middle" dominant-baseline="central">${e.n}</text>`;
    }

    if (opts.annotation) {
      const a = opts.annotation;
      const ax = x(opts.months[a.index])!;
      g += `<line x1="${ax}" x2="${ax}" y1="${m.top}" y2="${H - m.bottom}" class="note-rule"/>`;
      g += `<text x="${ax - 6}" y="${m.top + 4}" class="note-text" text-anchor="end" dominant-baseline="hanging">${esc(a.text)}</text>`;
    }

    const path = line<number>()
      .x((_, i) => x(opts.months[i])!)
      .y((v) => y(v));
    // Draw de-emphasised series first so the highlighted one sits on top.
    const ordered = [...opts.series].reverse();
    for (const s of ordered) {
      g += `<path d="${path(s.values)}" class="series" style="stroke:${s.color}"/>`;
    }
    // End labels, nudged apart if they collide.
    const last = opts.months.length - 1;
    const ends = opts.series.map((s) => ({ s, y: y(s.values[last]) }));
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) {
      if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
    }
    for (const e of ends) {
      const ex = x(opts.months[last])!;
      g += `<circle cx="${ex}" cy="${y(e.s.values[last])}" r="3.5" style="fill:${e.s.color}" class="end"/>`;
      g += `<text x="${ex + 8}" y="${e.y}" class="end-label" dominant-baseline="middle">${esc(e.s.label)}</text>`;
    }
    if (opts.focus != null && opts.focus !== last && opts.series[0]) {
      const fx = x(opts.months[opts.focus])!;
      g += `<circle cx="${fx}" cy="${y(opts.series[0].values[opts.focus])}" r="5.5" class="focus" style="stroke:${opts.series[0].color}"/>`;
    }
    g += `<g class="cross" visibility="hidden"><line class="cross-rule" y1="${m.top}" y2="${H - m.bottom}"/>`;
    for (const s of opts.series) g += `<circle r="4.5" class="cross-dot" style="fill:${s.color}"/>`;
    g += `</g><rect class="hit" x="${m.left}" y="0" width="${W - m.left - m.right}" height="${H}"/>`;
    svg.innerHTML = g;

    host.replaceChildren(svg, tip);

    const cross = svg.querySelector<SVGGElement>(".cross")!;
    const rule = cross.querySelector<SVGLineElement>(".cross-rule")!;
    const dots = cross.querySelectorAll<SVGCircleElement>(".cross-dot");

    const show = (i: number) => {
      active = i;
      if (i < 0) {
        cross.setAttribute("visibility", "hidden");
        tip.hidden = true;
        return;
      }
      const mo = opts.months[i];
      const cx = x(mo)!;
      cross.setAttribute("visibility", "visible");
      rule.setAttribute("x1", String(cx));
      rule.setAttribute("x2", String(cx));
      opts.series.forEach((s, k) => {
        dots[k].setAttribute("cx", String(cx));
        dots[k].setAttribute("cy", String(y(s.values[i])));
      });
      tip.innerHTML =
        `<div class="tip-title">${monthLabel(mo)}</div>` +
        opts.series
          .map((s) => `<div class="tip-row"><span class="swatch" style="background:${s.color}"></span>${esc(s.label)}<b>${pct(s.values[i])}</b></div>`)
          .join("");
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const left = cx + 14 + tw > W ? cx - 14 - tw : cx + 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${m.top}px`;
    };

    const hit = svg.querySelector<SVGRectElement>(".hit")!;
    hit.addEventListener("pointermove", (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let best = 0;
      let bd = Infinity;
      opts.months.forEach((mo, i) => {
        const d = Math.abs(x(mo)! - px);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      show(best);
    });
    hit.addEventListener("pointerleave", () => show(-1));
    svg.addEventListener("keydown", (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      ev.preventDefault();
      const start = active < 0 ? opts.months.length - 1 : active;
      show(Math.min(opts.months.length - 1, Math.max(0, start + (ev.key === "ArrowRight" ? 1 : -1))));
    });
    svg.addEventListener("blur", () => show(-1));
    if (active >= 0) show(active);
  };

  draw();
  let lastW = host.clientWidth;
  new ResizeObserver(() => {
    if (host.clientWidth !== lastW) {
      lastW = host.clientWidth;
      draw();
    }
  }).observe(host);
  // Callers mutate opts (e.g. focus) and call this to redraw.
  return draw;
}

export interface ScatterPoint {
  name: string;
  x: number;
  y: number;
  label?: boolean;
  /** Keep the label on narrow screens too (others are dropped to avoid overlaps). */
  keyLabel?: boolean;
}

/**
 * Scatter of agent traffic share (log x) against 403 rate (y, 0-100), with a
 * horizontal benchmark line. Selected points carry direct labels; every point
 * has a hover/tap tooltip.
 */
export function scatterChart(
  host: HTMLElement,
  opts: { points: ScatterPoint[]; bench: number; benchLabel: string; xLabel: string; yLabel: string; ariaLabel: string },
): void {
  host.classList.add("chart");
  const tip = document.createElement("div");
  tip.className = "tip";
  tip.hidden = true;
  const draw = () => {
    const W = Math.max(280, host.clientWidth);
    const narrow = W < 460;
    const H = narrow ? 300 : 340;
    const m = { top: 16, right: 16, bottom: 40, left: 44 };
    const xs = opts.points.map((p) => p.x);
    const lo = Math.pow(10, Math.floor(Math.log10(Math.min(...xs))));
    const hi = Math.pow(10, Math.ceil(Math.log10(Math.max(...xs))));
    const x = scaleLog().domain([lo, hi]).range([m.left, W - m.right]);
    const y = scaleLinear().domain([0, 100]).range([H - m.bottom, m.top]);
    let g = "";
    for (const t of [0, 25, 50, 75, 100]) {
      g += `<line x1="${m.left}" x2="${W - m.right}" y1="${y(t)}" y2="${y(t)}" class="${t === 0 ? "axis" : "grid"}"/>`;
      g += `<text x="${m.left - 8}" y="${y(t)}" class="tick" text-anchor="end" dominant-baseline="middle">${t}%</text>`;
    }
    for (let t = lo; t <= hi + 1e-9; t *= 10) {
      g += `<text x="${x(t)}" y="${H - m.bottom + 16}" class="tick" text-anchor="middle">${t >= 1 ? t : t.toFixed(String(t).split(".")[1]?.length ?? 1)}%</text>`;
    }
    g += `<text x="${W - m.right}" y="${H - 4}" class="tick" text-anchor="end">${esc(opts.xLabel)}</text>`;
    const by = y(opts.bench);
    g += `<line x1="${m.left}" x2="${W - m.right}" y1="${by}" y2="${by}" class="bench-rule"/>`;
    opts.points.forEach((p, i) => {
      g += `<circle cx="${x(p.x)}" cy="${y(p.y)}" r="5" class="pt${p.label && (!narrow || p.keyLabel) ? " lab" : ""}" data-i="${i}"/>`;
    });
    // Direct labels: right of the dot if it fits, else left, else above it (narrow screens).
    for (const p of opts.points.filter((q) => q.label && (!narrow || q.keyLabel))) {
      const px = x(p.x);
      const py = y(p.y);
      const w = p.name.length * 6.6;
      let lx = px + 9;
      let ly = py;
      let anchor = "start";
      if (px + 9 + w > W - 2) {
        if (px - 9 - w >= 2) {
          lx = px - 9;
          anchor = "end";
        } else {
          lx = Math.max(2, Math.min(W - 2 - w, px - w / 2));
          ly = py - 13;
        }
      }
      g += `<text x="${lx}" y="${ly}" class="pt-label" text-anchor="${anchor}" dominant-baseline="middle">${esc(p.name)}</text>`;
    }
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", String(W));
    svg.setAttribute("height", String(H));
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", opts.ariaLabel);
    svg.innerHTML = g;
    host.replaceChildren(svg, tip);
    const show = (el: SVGCircleElement | null) => {
      svg.querySelectorAll(".pt.on").forEach((c) => c.classList.remove("on"));
      if (!el) {
        tip.hidden = true;
        return;
      }
      el.classList.add("on");
      const p = opts.points[+el.dataset.i!];
      tip.innerHTML = `<div class="tip-title">${esc(p.name)}</div><div class="tip-row">${esc(opts.xLabel)}<b>${pct(p.x)}</b></div><div class="tip-row">${esc(opts.yLabel)}<b>${pct(p.y)}</b></div>`;
      tip.hidden = false;
      const cx = x(p.x);
      const tw = tip.offsetWidth;
      tip.style.left = `${Math.max(0, Math.min(W - tw, cx + 12 + tw > W ? cx - 12 - tw : cx + 12))}px`;
      tip.style.top = `${Math.max(0, y(p.y) - 20)}px`;
    };
    svg.querySelectorAll<SVGCircleElement>(".pt").forEach((c) => {
      c.addEventListener("pointerenter", () => show(c));
      c.addEventListener("click", () => show(c));
    });
    svg.addEventListener("pointerleave", () => show(null));
  };
  draw();
  let lastW = host.clientWidth;
  new ResizeObserver(() => {
    if (host.clientWidth !== lastW) {
      lastW = host.clientWidth;
      draw();
    }
  }).observe(host);
}
