import { lineChart, mixBars, mixLegend, niceScale } from "./charts";
import { esc, monthLabel, pct, ratio } from "./format";
import type { Dataset, Industry } from "./types";

type CodeSel = "403" | "402";
type Measure = "rate" | "share";
type SortKey = "name" | "value" | "compare" | "ratio";

interface Row {
  ind: Industry;
  value: number;
  compare: number | null;
  ratio: number | null;
}

const PAGE = 20;

const COPY = {
  rate: {
    explain: (c: CodeSel) =>
      `Percent of agent requests to each industry answered with ${c}. The grey dot is the same rate for training crawlers.`,
    value: "Agents",
    compare: "Trainers",
    ratio: "Agents ÷ trainers",
    cmpLegend: "Training crawlers",
  },
  share: {
    explain: (c: CodeSel) =>
      `Percent of all agent ${c}s that came from each industry. The grey dot is the industry's share of agent traffic; a colored dot to its right means the industry sends more ${c}s than its size suggests.`,
    value: "Share of all",
    compare: "Share of traffic",
    ratio: "Over-index",
    cmpLegend: "Share of agent traffic",
  },
};

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const steps = [0.5, 1, 2, 2.5, 5, 10, 20, 25, 40, 50, 60, 80, 100];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 10) * 10;
}

export function initIndustries(host: HTMLElement, d: Dataset) {
  const state = {
    code: "403" as CodeSel,
    measure: "rate" as Measure,
    q: "",
    includeLow: false,
    sort: "value" as SortKey,
    dir: -1,
    showAll: false,
    open: new Set<string>(),
  };
  const lowCount = d.industries.filter((i) => i.lowVolume).length;

  host.innerHTML = `
    <div class="controls" role="group" aria-label="Industry view">
      <div class="seg-ctl" role="radiogroup" aria-label="Response code">
        <button type="button" role="radio" data-code="403" id="ctl-code-403"><code class="code c403">403</code> Forbidden</button>
        <button type="button" role="radio" data-code="402" id="ctl-code-402"><code class="code c402">402</code> Payment Required</button>
      </div>
      <div class="seg-ctl" role="radiogroup" aria-label="Measure">
        <button type="button" role="radio" data-measure="rate" id="ctl-m-rate">Rate</button>
        <button type="button" role="radio" data-measure="share" id="ctl-m-share">Share of total</button>
      </div>
      <label class="search"><span class="visually-hidden">Find an industry</span>
        <input type="search" id="ctl-q" placeholder="Find an industry" autocomplete="off" />
      </label>
      <label class="check"><input type="checkbox" id="ctl-low" /> Include ${lowCount} low-volume industries</label>
    </div>
    <p class="explain" id="ind-explain"></p>
    <ul class="legend" id="ind-legend" aria-hidden="true"></ul>
    <div class="ind-table" role="table" aria-label="Industries">
      <div class="ind-row ind-headrow" role="row" id="ind-head"></div>
      <div id="ind-body" role="rowgroup"></div>
    </div>
    <div class="ind-foot" id="ind-foot"></div>`;

  const $ = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)!;
  const body = $("#ind-body");

  host.querySelectorAll<HTMLButtonElement>("[data-code]").forEach((b) =>
    b.addEventListener("click", () => {
      state.code = b.dataset.code as CodeSel;
      render();
    }),
  );
  host.querySelectorAll<HTMLButtonElement>("[data-measure]").forEach((b) =>
    b.addEventListener("click", () => {
      state.measure = b.dataset.measure as Measure;
      render();
    }),
  );
  $<HTMLInputElement>("#ctl-q").addEventListener("input", (e) => {
    state.q = (e.target as HTMLInputElement).value.trim().toLowerCase();
    render();
  });
  $<HTMLInputElement>("#ctl-low").addEventListener("change", (e) => {
    state.includeLow = (e.target as HTMLInputElement).checked;
    render();
  });
  // Arrow keys move between options inside each radio group.
  host.querySelectorAll<HTMLElement>(".seg-ctl").forEach((grp) =>
    grp.addEventListener("keydown", (e) => {
      if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
      const btns = [...grp.querySelectorAll<HTMLButtonElement>("button")];
      const i = btns.indexOf(document.activeElement as HTMLButtonElement);
      const next = btns[(i + (e.key === "ArrowRight" ? 1 : btns.length - 1)) % btns.length];
      next.click();
      next.focus();
    }),
  );

  function rows(): Row[] {
    const c = state.code;
    return d.industries
      .filter((i) => state.includeLow || !i.lowVolume)
      .filter((i) => !state.q || i.name.toLowerCase().includes(state.q))
      .map((ind) => {
        const value = state.measure === "rate" ? ind.agents[c] : c === "403" ? ind.shareOfAgent403 : ind.shareOfAgent402;
        const compare = state.measure === "rate" ? (ind.trainers ? ind.trainers[c] : null) : ind.agentTrafficShare;
        const r = compare != null && compare > 0 ? value / compare : null;
        return { ind, value, compare, ratio: r };
      });
  }

  function sorted(list: Row[]): Row[] {
    const k = state.sort;
    const dir = state.dir;
    const get = (r: Row): number | string | null => (k === "name" ? r.ind.name.toLowerCase() : r[k]);
    return [...list].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1; // missing values always sink
      if (vb == null) return -1;
      if (typeof va === "string") return va.localeCompare(vb as string) * -dir;
      return ((va as number) - (vb as number)) * dir;
    });
  }

  function headCell(key: SortKey, label: string, cls: string) {
    const on = state.sort === key;
    const aria = on ? (state.dir === -1 ? "descending" : "ascending") : "none";
    const arrow = on ? (state.dir === -1 ? "↓" : "↑") : "";
    return `<div class="${cls}" role="columnheader" aria-sort="${aria}"><button type="button" class="sort" data-sort="${key}">${label}<span class="arrow" aria-hidden="true">${arrow}</span></button></div>`;
  }

  function render() {
    const c = state.code;
    const copy = COPY[state.measure];
    host.querySelectorAll<HTMLButtonElement>("[data-code]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.code === c)));
    host.querySelectorAll<HTMLButtonElement>("[data-measure]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.measure === state.measure)));
    host.querySelectorAll<HTMLButtonElement>(".seg-ctl button").forEach((b) => (b.tabIndex = b.getAttribute("aria-checked") === "true" ? 0 : -1));
    $("#ind-explain").textContent = copy.explain(c);
    $("#ind-legend").innerHTML =
      `<li><span class="dot-key" style="background:var(--c${c})"></span>Agents</li>` +
      `<li><span class="dot-key" style="background:var(--cmp)"></span>${copy.cmpLegend}</li>`;

    const all = sorted(rows());
    const shown = state.showAll || state.q ? all : all.slice(0, PAGE);
    const max = niceMax(Math.max(0.01, ...all.map((r) => Math.max(r.value, r.compare ?? 0))));
    const ticks = [0, max / 2, max];

    $("#ind-head").innerHTML =
      headCell("name", "Industry", "c-name") +
      `<div class="c-bar axis-head" role="columnheader"><span class="visually-hidden">Comparison chart</span>${ticks
        .map((t, i) => `<span class="axis-tick" style="left:${(t / max) * 100}%" data-edge="${i === 0 ? "start" : i === 2 ? "end" : "mid"}" aria-hidden="true">${t}%</span>`)
        .join("")}</div>` +
      headCell("value", state.measure === "share" ? `Share of ${c}s` : copy.value, "c-num c-val") +
      headCell("compare", copy.compare, "c-num c-cmp") +
      headCell("ratio", copy.ratio, "c-num c-ratio");
    $("#ind-head")
      .querySelectorAll<HTMLButtonElement>("[data-sort]")
      .forEach((b) =>
        b.addEventListener("click", () => {
          const k = b.dataset.sort as SortKey;
          if (state.sort === k) state.dir *= -1;
          else {
            state.sort = k;
            state.dir = k === "name" ? 1 : -1;
          }
          render();
        }),
      );

    if (!shown.length) {
      body.innerHTML = `<p class="empty">No industry matches "${esc(state.q)}". ${state.includeLow ? "" : "It may be a low-volume industry; tick the box above to include those."}</p>`;
    } else {
      body.innerHTML = shown.map((r) => rowHtml(r, max)).join("");
    }

    body.querySelectorAll<HTMLElement>(".trend-host").forEach(mountTrend);

    body.querySelectorAll<HTMLButtonElement>(".name-btn").forEach((b) =>
      b.addEventListener("click", () => {
        const n = b.dataset.name!;
        if (state.open.has(n)) state.open.delete(n);
        else state.open.add(n);
        render();
        body.querySelector<HTMLButtonElement>(`.name-btn[data-name="${CSS.escape(n)}"]`)?.focus();
      }),
    );

    const foot = $("#ind-foot");
    if (!state.q && all.length > PAGE) {
      foot.innerHTML = `<button type="button" class="more" id="ctl-more">${state.showAll ? `Show top ${PAGE}` : `Show all ${all.length} industries`}</button>`;
      foot.querySelector("button")!.addEventListener("click", () => {
        state.showAll = !state.showAll;
        render();
      });
    } else foot.innerHTML = "";
  }

  function rowHtml(r: Row, max: number): string {
    const c = state.code;
    const x = (v: number) => Math.min(100, (v / max) * 100);
    const vx = x(r.value);
    const cx = r.compare != null ? x(r.compare) : null;
    const lo = cx == null ? vx : Math.min(vx, cx);
    const hi = cx == null ? vx : Math.max(vx, cx);
    const open = state.open.has(r.ind.name);
    const flag = r.ind.lowVolume ? `<span class="flag">Low volume</span>` : "";
    const noteFlag = r.ind.note ? `<span class="flag flag-note" title="${esc(r.ind.note)}">Note</span>` : "";
    const ratioTitle = r.ratio == null ? (state.measure === "rate" ? "No training-crawler data" : "Traffic share not published") : "";
    const label = `${r.ind.name}: agents ${pct(r.value)}, ${COPY[state.measure].cmpLegend.toLowerCase()} ${pct(r.compare)}`;

    return `<div class="ind-row${open ? " is-open" : ""}" role="row">
      <div class="c-name" role="rowheader"><button type="button" class="name-btn" data-name="${esc(r.ind.name)}" aria-expanded="${open}">${esc(r.ind.name)}</button>${flag}${noteFlag}</div>
      <div class="c-bar" role="cell"><div class="track" role="img" aria-label="${esc(label)}">
        <span class="link" style="left:${lo}%;width:${hi - lo}%"></span>
        ${cx != null ? `<span class="dot dot-cmp" style="left:${cx}%"></span>` : ""}
        <span class="dot" style="left:${vx}%;background:var(--c${c})"></span>
      </div></div>
      <div class="c-num c-val" role="cell">${pct(r.value)}</div>
      <div class="c-num c-cmp" role="cell">${pct(r.compare)}</div>
      <div class="c-num c-ratio" role="cell" title="${ratioTitle}">${ratio(r.ratio)}</div>
    </div>${open ? detailHtml(r.ind) : ""}`;
  }

  function detailHtml(i: Industry): string {
    const bars = [{ label: "Agents", groups: i.agentGroups }];
    if (i.trainerGroups) bars.push({ label: "Training crawlers", groups: i.trainerGroups });
    return `<div class="ind-detail" role="row"><div role="cell">
      <div class="facts">
        <div><span class="k">Share of agent traffic</span><span class="v">${i.agentTrafficShare == null ? "Under 0.03%" : pct(i.agentTrafficShare)}</span></div>
        <div><span class="k">Share of all agent <code class="code c403">403</code>s</span><span class="v">${pct(i.shareOfAgent403)}</span></div>
        <div><span class="k">Share of all agent <code class="code c402">402</code>s</span><span class="v">${pct(i.shareOfAgent402)}</span></div>
      </div>
      ${mixLegend()}
      <div class="mix-cols" aria-hidden="true"><span></span><span></span><span class="code-head"><span class="c403">403</span><span class="c402">402</span></span></div>
      ${mixBars(bars)}
      ${i.trainerGroups ? "" : `<p class="muted">Training-crawler data is not available for this industry.</p>`}
      ${trendHtml(i)}
      ${i.note ? `<p class="note">${esc(i.note)}</p>` : ""}
    </div></div>`;
  }

  const allAgents = new Map(d.monthly.map((m) => [m.month, m.agents]));

  function trendHtml(i: Industry): string {
    if (!i.monthly?.length) {
      return d.meta.hasIndustryTrends
        ? `<p class="muted">Monthly trends cover the 30 industries with the most agent traffic.</p>`
        : "";
    }
    const first = monthLabel(i.monthly[0].month);
    const last = monthLabel(i.monthly[i.monthly.length - 1].month);
    return `<div class="trend">
      <h4>Month by month, ${first} to ${last}</h4>
      <div class="trend-grid">
        ${(["403", "402"] as const)
          .map(
            (c) => `<div class="trend-cell">
              <p class="trend-title"><code class="code c${c}">${c}</code> rate for agents</p>
              <ul class="legend" aria-hidden="true">
                <li><span class="swatch" style="background:var(--c${c})"></span>${esc(i.name)}</li>
                <li><span class="swatch" style="background:var(--cmp)"></span>All industries</li>
              </ul>
              <div class="trend-host" data-name="${esc(i.name)}" data-code="${c}"></div>
            </div>`,
          )
          .join("")}
      </div>
    </div>`;
  }

  function mountTrend(host: HTMLElement) {
    const ind = d.industries.find((x) => x.name === host.dataset.name);
    const c = host.dataset.code as CodeSel;
    if (!ind?.monthly) return;
    const series = ind.monthly.filter((m) => allAgents.has(m.month));
    const months = series.map((m) => m.month);
    const mine = series.map((m) => m[c]);
    const all = months.map((m) => allAgents.get(m)![c]);
    const { yMax, yTicks } = niceScale(Math.max(...mine, ...all));
    lineChart(host, {
      months,
      yMax,
      yTicks,
      compact: true,
      series: [
        { label: ind.name.length > 14 ? "Industry" : ind.name, values: mine, color: `var(--c${c})` },
        { label: "All", values: all, color: "var(--cmp)" },
      ],
      ariaLabel: `${ind.name}: agent ${c} rate by month, ${pct(mine[0])} in ${monthLabel(months[0])} to ${pct(mine[mine.length - 1])} in ${monthLabel(months[months.length - 1])}. All industries: ${pct(all[0])} to ${pct(all[all.length - 1])}.`,
    });
  }

  render();
}
