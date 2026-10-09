import { scaleLinear, scalePoint } from "d3-scale";
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
export function lineChart(host: HTMLElement, opts: LineChartOpts): void {
  host.classList.add("chart");
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
}
