import { lineChart, niceScale } from "./charts";
import { esc, monthLabel, pct } from "./format";
import type { Dataset, Industry } from "./types";

type Period = "month" | "ytd";
type Code = "403" | "402";

interface Row {
  ind: Industry;
  v403: number;
  v402: number;
}

const PAGE = 20;
const INFO_SVG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="6.5"></circle><line x1="8" y1="7" x2="8" y2="11.5"></line><circle cx="8" cy="4.8" r="0.6" fill="currentColor"></circle></svg>`;

function labelSource(i: Industry): string {
  if (!i.label) return "Cloudflare label with no published definition.";
  if (i.label.source === "linkedin") {
    return i.label.linkedinName
      ? `Label matches LinkedIn's industry list, where it is now called ${i.label.linkedinName}.`
      : "Label matches LinkedIn's industry list.";
  }
  return "Cloudflare label with no published definition. This is our reading of it.";
}

function niceMax(v: number): number {
  const steps = [1, 2, 5, 10, 20, 30, 50, 75, 100];
  return steps.find((s) => s >= v) ?? 100;
}

export function initIndustries(host: HTMLElement, d: Dataset, getIdx: () => number) {
  const months = d.monthly.map((m) => m.month);
  const tracked = d.industries.filter((i) => i.monthly?.length);
  const lowCount = d.industries.filter((i) => i.lowVolume).length;
  const state = { period: "month" as Period, by: "403" as Code, q: "", includeLow: false, showAll: false, open: new Set<string>() };

  host.innerHTML = `<div class="page">
    <h1 id="ind-title"></h1>
    <p class="sub" id="ind-sub"></p>
    <div class="controls">
      <div class="seg" role="group" aria-label="Period">
        <button type="button" data-period="month">Selected month</button>
        <button type="button" data-period="ytd">Year to date</button>
      </div>
      <div class="seg" role="group" aria-label="Rank by">
        <button type="button" data-by="403">Rank by 403</button>
        <button type="button" data-by="402">Rank by 402</button>
      </div>
      <label class="search"><span class="vh">Find an industry</span><input type="search" id="ind-q" placeholder="Find an industry" autocomplete="off"></label>
      <label class="check" id="ind-low-wrap"><input type="checkbox" id="ind-low"> Include ${lowCount} small industries</label>
    </div>
    <div class="scroll"><div class="tbl" id="ind-tbl"></div></div>
    <div id="ind-foot"></div>
  </div>`;

  const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
  host.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((b) =>
    b.addEventListener("click", () => {
      state.period = b.dataset.period as Period;
      render();
    }),
  );
  host.querySelectorAll<HTMLButtonElement>("[data-by]").forEach((b) =>
    b.addEventListener("click", () => {
      state.by = b.dataset.by as Code;
      render();
    }),
  );
  q<HTMLInputElement>("#ind-q").addEventListener("input", (e) => {
    state.q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    render();
  });
  q<HTMLInputElement>("#ind-low").addEventListener("change", (e) => {
    state.includeLow = (e.target as HTMLInputElement).checked;
    render();
  });

  function rows(): Row[] {
    const idx = getIdx();
    const m = months[idx];
    const base =
      state.period === "month"
        ? tracked.map((ind) => {
            const pt = ind.monthly!.find((x) => x.month === m);
            return { ind, v403: pt?.["403"] ?? NaN, v402: pt?.["402"] ?? NaN };
          })
        : d.industries.filter((i) => state.includeLow || !i.lowVolume).map((ind) => ({ ind, v403: ind.agents["403"], v402: ind.agents["402"] }));
    return base
      .filter((r) => !Number.isNaN(r.v403))
      .filter((r) => !state.q || r.ind.name.toLowerCase().includes(state.q))
      .sort((a, b) => (state.by === "403" ? b.v403 - a.v403 : b.v402 - a.v402));
  }

  function render() {
    const idx = getIdx();
    const m = months[idx];
    host.querySelectorAll<HTMLButtonElement>("[data-period]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.period === state.period)));
    host.querySelectorAll<HTMLButtonElement>("[data-by]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.by === state.by)));
    q("#ind-low-wrap").hidden = state.period === "month";

    const isMonth = state.period === "month";
    q("#ind-title").textContent = isMonth ? `Industries, ${monthLabel(m)}` : `Industries, ${d.meta.windows.ytd.label}`;
    q("#ind-sub").textContent = isMonth
      ? `The ${tracked.length} industries with the most agent traffic, for the month picked above. Labels are Cloudflare's; the info icon says what each covers.`
      : `Every industry with at least ${d.meta.lowVolumeThresholdPct}% of agent traffic, ${d.meta.windows.ytd.label}. Labels are Cloudflare's; the info icon says what each covers.`;

    const all = rows();
    const shown = state.showAll || state.q ? all : all.slice(0, PAGE);
    const max402 = niceMax(Math.max(1, ...all.map((r) => r.v402)));
    const bench = isMonth ? d.monthly[idx].industrySites : d.overall.industrySites;
    const benchLabel = isMonth ? "All sites with an industry (est.)" : "All sites with an industry";

    const bar = (v: number, max: number, color: string) =>
      `<span class="bar"><span class="bar-track"><span class="bar-fill" style="width:${Math.min(100, (v / max) * 100).toFixed(1)}%;background:${color}"></span></span><span class="bar-val">${pct(v)}</span></span>`;
    const spark = (ind: Industry | null) => {
      // Benchmark row: the sites-with-an-industry series, falling back to all agent traffic for months it cannot be estimated.
      const vals = ind ? ind.monthly?.map((x) => x["403"]) : d.monthly.map((x) => x.industrySites?.["403"] ?? x.agents["403"]);
      if (!vals) return `<span class="small">Not tracked monthly</span>`;
      const pts = vals.map((v, k) => `${(k * 9.2 + 2).toFixed(1)},${(28 - (v / 100) * 26).toFixed(1)}`).join(" ");
      const dotY = (28 - (vals[idx] / 100) * 26).toFixed(1);
      return `<svg class="spark" viewBox="0 0 190 30" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${ind ? "#9A9A9A" : "var(--red)"}" stroke-width="1.4"></polyline><circle cx="${(idx * 9.2 + 2).toFixed(1)}" cy="${dotY}" r="3" fill="var(--red)"></circle></svg>`;
    };

    const head = `<div class="tr head">
      <span>#</span><span>Industry</span>
      <span>403 rate, scale 0 to 100%</span>
      <span>402 rate, scale 0 to ${max402}%</span>
      <span>403 rate since ${monthLabel(months[0])}</span>
      <span class="num">Traffic share, year to date</span>
    </div>`;
    const benchRow =
      bench && bench["403"] != null
        ? `<div class="tr bench">
          <span></span><span>${benchLabel}</span>
          ${bar(bench["403"], 100, "var(--red)")}
          ${bench["402"] != null ? bar(bench["402"], max402, "var(--blue)") : "<span></span>"}
          ${spark(null)}
          <span class="num small">100%</span>
        </div>`
        : "";

    const body = shown
      .map((r, n) => {
        const i = r.ind;
        const open = state.open.has(i.name);
        const flag = i.lowVolume ? `<span class="flag">Small</span>` : "";
        const row = `<div class="tr row">
          <span class="small">${n + 1}</span>
          <span class="name">
            <button type="button" class="name-btn" data-open="${esc(i.name)}" aria-expanded="${open}">${esc(i.name)}</button>
            <span class="info">
              <button type="button" class="info-btn" data-info aria-expanded="false" aria-label="What ${esc(i.name)} covers">${INFO_SVG}</button>
              <span class="pop" role="tooltip"><b>${esc(i.name)}</b>${esc(i.label?.desc ?? "No description yet.")}<small>${esc(labelSource(i))}</small></span>
            </span>
            ${flag}
          </span>
          ${bar(r.v403, 100, "var(--red)")}
          ${bar(r.v402, max402, "var(--blue)")}
          ${spark(i)}
          <span class="num small">${i.agentTrafficShare == null ? "under 0.03%" : pct(i.agentTrafficShare)}</span>
        </div>`;
        return row + (open ? detail(i) : "");
      })
      .join("");

    q("#ind-tbl").innerHTML = head + benchRow + (body || `<p class="small" style="padding:16px 0">No industry matches "${esc(state.q)}".</p>`);
    q("#ind-foot").innerHTML =
      !state.q && all.length > PAGE
        ? `<button type="button" class="more" id="ind-more">${state.showAll ? `Show top ${PAGE}` : `Show all ${all.length}`}</button>`
        : "";
    host.querySelector("#ind-more")?.addEventListener("click", () => {
      state.showAll = !state.showAll;
      render();
    });

    host.querySelectorAll<HTMLButtonElement>("[data-open]").forEach((b) =>
      b.addEventListener("click", () => {
        const n = b.dataset.open!;
        if (state.open.has(n)) state.open.delete(n);
        else state.open.add(n);
        render();
      }),
    );
    host.querySelectorAll<HTMLButtonElement>("[data-info]").forEach((b) =>
      b.addEventListener("click", () => {
        const was = b.getAttribute("aria-expanded") === "true";
        host.querySelectorAll("[data-info]").forEach((x) => x.setAttribute("aria-expanded", "false"));
        b.setAttribute("aria-expanded", String(!was));
      }),
    );
    host.querySelectorAll<HTMLElement>(".trend-host").forEach(mountTrend);
  }

  function detail(i: Industry): string {
    const trends = i.monthly?.length
      ? `<div class="trend-grid">
          <div class="trend-cell"><p>403 rate by month</p><ul class="legend" aria-hidden="true"><li><span class="swatch" style="background:var(--red)"></span>${esc(i.name)}</li><li><span class="swatch" style="background:#9A9A9A"></span>All agent traffic</li></ul><div class="trend-host" data-name="${esc(i.name)}" data-code="403"></div></div>
          <div class="trend-cell"><p>402 rate by month</p><ul class="legend" aria-hidden="true"><li><span class="swatch" style="background:var(--blue)"></span>${esc(i.name)}</li><li><span class="swatch" style="background:#9A9A9A"></span>All agent traffic</li></ul><div class="trend-host" data-name="${esc(i.name)}" data-code="402"></div></div>
        </div>`
      : `<p class="small">Monthly figures cover only the ${tracked.length} industries with the most agent traffic.</p>`;
    return `<div class="detail">
      <div class="facts">
        <span><em>403 rate, year to date</em><b>${pct(i.agents["403"])}</b></span>
        <span><em>402 rate, year to date</em><b>${pct(i.agents["402"])}</b></span>
        <span><em>Training crawlers' 403 rate</em><b>${i.trainers ? pct(i.trainers["403"]) : "not reported"}</b></span>
        <span><em>Share of all agent 403s</em><b>${pct(i.shareOfAgent403)}</b></span>
        <span><em>Share of all agent 402s</em><b>${pct(i.shareOfAgent402)}</b></span>
      </div>
      ${trends}
      ${i.note ? `<p class="note">${esc(i.note)}</p>` : ""}
    </div>`;
  }

  function mountTrend(el: HTMLElement) {
    const ind = d.industries.find((x) => x.name === el.dataset.name);
    const c = el.dataset.code as Code;
    if (!ind?.monthly) return;
    const pts = ind.monthly.filter((x) => months.includes(x.month));
    const ms = pts.map((x) => x.month);
    const mine = pts.map((x) => x[c]);
    const all = ms.map((m) => d.monthly.find((x) => x.month === m)!.agents[c]);
    const { yMax, yTicks } = niceScale(Math.max(...mine, ...all));
    lineChart(el, {
      months: ms,
      yMax,
      yTicks,
      compact: true,
      series: [
        { label: ind.name.length > 14 ? "Industry" : ind.name, values: mine, color: c === "403" ? "var(--red)" : "var(--blue)" },
        { label: "All", values: all, color: "#9A9A9A" },
      ],
      ariaLabel: `${ind.name}: agent ${c} rate by month, ${pct(mine[0])} in ${monthLabel(ms[0])} to ${pct(mine[mine.length - 1])} in ${monthLabel(ms[ms.length - 1])}.`,
    });
  }

  render();
  return { update: render };
}
