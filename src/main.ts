import "./styles.css";
import { dateLabel, esc, monthLabel, pct } from "./format";
import { initIndustries } from "./industries";
import type { Dataset, Verification } from "./types";

type View = "overview" | "industries" | "agents" | "method";
const VIEWS: View[] = ["overview", "industries", "agents", "method"];
const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function monthLong(ym: string): string {
  const [y, m] = ym.split("-");
  return `${LONG[+m - 1]} ${y}`;
}

function mix(a: string, b: string, t: number): string {
  const h = (s: string, i: number) => parseInt(s.slice(i, i + 2), 16);
  return "#" + [1, 3, 5].map((i) => Math.round(h(a, i) + (h(b, i) - h(a, i)) * t).toString(16).padStart(2, "0")).join("");
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function load(): Promise<{ d: Dataset; v: Verification | null }> {
  const res = await fetch("data/index.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`data/index.json returned ${res.status}`);
  const d = (await res.json()) as Dataset;
  let v: Verification | null = null;
  try {
    const r = await fetch("data/verification.json", { cache: "no-cache" });
    if (r.ok) v = await r.json();
  } catch {
    v = null;
  }
  return { d, v };
}

function main(d: Dataset, v: Verification | null) {
  const months = d.monthly.map((m) => m.month);
  const a403 = d.monthly.map((m) => m.agents["403"]);
  const a402 = d.monthly.map((m) => m.agents["402"]);
  const lo403 = Math.min(...a403);
  const hi403 = Math.max(...a403);
  const hi402 = Math.max(...a402);
  const t3 = (x: number) => Math.max(0, Math.min(1, (x - lo403) / (hi403 - lo403 || 1)));
  const t2 = (x: number) => Math.max(0, Math.min(1, x / (hi402 || 1)));
  const red = (x: number) => mix("#FFF4F2", "#FF3B2F", t3(x));
  const blue = (x: number) => mix("#EEF3FF", "#1E40FF", t2(x));
  const peak = (vals: number[]) => vals.indexOf(Math.max(...vals));

  const params = new URLSearchParams(location.search);
  const fromUrl = months.indexOf(params.get("m") ?? "");
  const state = { idx: fromUrl >= 0 ? fromUrl : months.length - 1, view: "overview" as View };

  // ---- Overview markup (built once, updated on month change) ----
  const ov = $("view-overview");
  ov.innerHTML = `
    <section class="field" id="f403">
      <div>
        <p class="field-code">403 Forbidden</p>
        <p class="field-num" id="n403"></p>
        <p class="field-text">of AI agent requests were refused in <span data-month></span>.</p>
      </div>
      <div class="field-side">
        <span class="cap">403 rate by month. Highest ${pct(a403[peak(a403)])} in ${monthLabel(months[peak(a403)])}.</span>
        <div class="cells" id="cells403"></div>
        <div class="cell-axis"><span>${monthLabel(months[0])}</span><span>${monthLabel(months[months.length - 1])}</span></div>
      </div>
    </section>
    <section class="field" id="f402">
      <div>
        <p class="field-code">402 Payment Required</p>
        <p class="field-num" id="n402"></p>
        <p class="field-text">of AI agent requests were asked to pay in <span data-month></span>.</p>
      </div>
      <div class="field-side">
        <span class="cap">402 rate by month. Highest ${pct(a402[peak(a402)])} in ${monthLabel(months[peak(a402)])}.</span>
        <div class="cells" id="cells402"></div>
        <div class="cell-axis"><span>${monthLabel(months[0])}</span><span>${monthLabel(months[months.length - 1])}</span></div>
      </div>
    </section>
    <section class="thousand">
      <div>
        <h2>Out of every 1,000 agent requests in <span data-month></span></h2>
        <p class="count"><span class="swatch" style="background:var(--red)"></span><b id="c403"></b> were refused</p>
        <p class="count"><span class="swatch" style="background:var(--blue)"></span><b id="c402"></b> were asked to pay</p>
        <p class="count"><span class="swatch" style="background:var(--other)"></span><b id="cRest"></b> got any other answer</p>
      </div>
      <div class="dots" id="dots" role="img"></div>
    </section>`;

  const cells403 = $("cells403");
  const cells402 = $("cells402");
  months.forEach((m, k) => {
    for (const [host, code, vals, color] of [[cells403, "403", a403, red], [cells402, "402", a402, blue]] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cell";
      b.style.background = color(vals[k]);
      b.setAttribute("aria-label", `${monthLabel(m)}: ${code} rate ${pct(vals[k])}`);
      b.title = `${monthLabel(m)}: ${pct(vals[k])}`;
      b.addEventListener("click", () => setMonth(k));
      host.appendChild(b);
    }
  });
  const dots = $("dots");
  const dotEls: HTMLSpanElement[] = [];
  for (let k = 0; k < 1000; k++) {
    const s = document.createElement("span");
    dots.appendChild(s);
    dotEls.push(s);
  }

  // ---- Static views ----
  renderAgents(d);
  renderMethod(d, v);
  const industries = initIndustries($("view-industries"), d, () => state.idx);

  // ---- Month control ----
  const slider = $<HTMLInputElement>("month");
  slider.max = String(months.length - 1);
  slider.addEventListener("input", () => setMonth(+slider.value));

  function setMonth(k: number) {
    state.idx = k;
    const m = months[k];
    slider.value = String(k);
    $("month-label").textContent = monthLong(m);
    document.querySelectorAll("[data-month]").forEach((el) => (el.textContent = monthLong(m)));

    const f3 = $("f403");
    const f2 = $("f402");
    f3.style.background = red(a403[k]);
    f3.style.color = "#111111";
    f2.style.background = blue(a402[k]);
    f2.style.color = t2(a402[k]) > 0.5 ? "#FFFFFF" : "#111111";
    $("n403").textContent = pct(a403[k]);
    $("n402").textContent = pct(a402[k]);
    cells403.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === k)));
    cells402.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === k)));

    const n3 = Math.round(a403[k] * 10);
    const n2 = Math.round(a402[k] * 10);
    $("c403").textContent = String(n3);
    $("c402").textContent = n2 === 0 && a402[k] > 0 ? "<1" : String(n2);
    $("cRest").textContent = String(1000 - n3 - n2);
    dotEls.forEach((s, i) => (s.className = i < n3 ? "r" : i < n3 + n2 ? "b" : ""));
    dots.setAttribute("aria-label", `Of 1,000 agent requests in ${monthLong(m)}, ${n3} refused and ${n2} asked to pay`);

    industries.update();
    const url = new URL(location.href);
    if (k === months.length - 1) url.searchParams.delete("m");
    else url.searchParams.set("m", m);
    history.replaceState(null, "", url);
  }

  // ---- Views ----
  function showView(view: View) {
    state.view = view;
    VIEWS.forEach((x) => ($(`view-${x}`).hidden = x !== view));
    document.querySelectorAll<HTMLAnchorElement>(".tabs a").forEach((a) => {
      if (a.dataset.view === view) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
  }
  const fromHash = () => {
    const h = location.hash.replace("#", "") as View;
    showView(VIEWS.includes(h) ? h : "overview");
  };
  window.addEventListener("hashchange", fromHash);
  document.querySelectorAll<HTMLAnchorElement>("[data-view]").forEach((a) =>
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const view = a.dataset.view as View;
      const url = new URL(location.href);
      url.hash = view === "overview" ? "" : view;
      history.pushState(null, "", url);
      showView(view);
      window.scrollTo({ top: 0 });
    }),
  );

  // ---- Footer ----
  $("foot-source").innerHTML =
    `Source: <a href="${d.meta.sourceUrl}" rel="noopener">Cloudflare Radar</a>, AI Bots &amp; Crawlers. ` +
    `Shares of requests, not counts. Updated ${dateLabel(d.meta.updated)}.`;
  $("cite").addEventListener("click", async () => {
    const m = months[state.idx];
    const url = new URL(location.href);
    url.hash = "";
    url.searchParams.set("m", m);
    const text = `WhatsThe402, Agent Access Index, ${monthLong(m)}. Data from Cloudflare Radar. Accessed ${dateLabel(new Date().toISOString().slice(0, 10))}. ${url.toString()}`;
    const btn = $("cite");
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = "Citation copied";
    } catch {
      window.prompt("Copy this citation", text);
    }
    setTimeout(() => (btn.textContent = "Copy citation"), 2400);
  });
  $("dl-csv").addEventListener("click", () => {
    const rows = [["month", "agents_403_pct", "agents_402_pct", "all_ai_bots_403_pct", "all_ai_bots_402_pct"]];
    d.monthly.forEach((m) => rows.push([m.month, String(m.agents["403"]), String(m.agents["402"]), String(m.allBots["403"]), String(m.allBots["402"])]));
    rows.push([]);
    rows.push(["industry", "agent_traffic_share_pct", "agents_403_pct_ytd", "agents_402_pct_ytd", "share_of_agent_403s_pct", "share_of_agent_402s_pct"]);
    d.industries.forEach((i) =>
      rows.push([i.name, String(i.agentTrafficShare ?? ""), String(i.agents["403"]), String(i.agents["402"]), String(i.shareOfAgent403), String(i.shareOfAgent402)]),
    );
    const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `whatsthe402-${d.meta.updated}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  fromHash();
  setMonth(state.idx);
}

function renderAgents(d: Dataset) {
  const top = [...d.bots].filter((b) => b.shareOfAgent402 != null).sort((a, b) => b.shareOfAgent402! - a.shareOfAgent402!)[0];
  const rows = d.bots
    .map(
      (b) => `<div class="atr">
        <span style="font-weight:500">${esc(b.name)}</span>
        <span class="num">${pct(b.trafficShare)}</span>
        <span class="num" style="color:var(--red);font-weight:600">${pct(b.rates?.["403"])}</span>
        <span class="num" style="color:var(--blue);font-weight:600">${pct(b.rates?.["402"])}</span>
        <span class="num">${pct(b.shareOfAgent402)}</span>
      </div>`,
    )
    .join("");
  $("view-agents").innerHTML = `<div class="page">
    <h1>Agents, ${esc(d.meta.windows.ytd.label)}</h1>
    <p class="sub">Each rate is the share of that agent's own requests.</p>
    <div class="scroll"><div class="atbl">
      <div class="atr head"><span>Agent</span><span class="num">Share of agent traffic</span><span class="num">403 rate</span><span class="num">402 rate</span><span class="num">Share of all agent 402s</span></div>
      ${rows}
    </div></div>
    <ul class="facts-list">
      ${top ? `<li>${esc(top.name)} receives ${pct(top.shareOfAgent402)} of all agent 402s, so the 402 trend mostly reflects how sites treat that one agent.</li>` : ""}
      <li>Across all agents, ${pct(d.overall.agents["403"])} of requests got a 403 this year, against ${pct(d.overall.trainers["403"])} of requests from training crawlers.</li>
    </ul>
  </div>`;
}

function renderMethod(d: Dataset, v: Verification | null) {
  const m = d.meta;
  const sites = d.overall.industrySites;
  const cc = v?.crossChecks ?? {};
  const live = v?.liveCheck?.results ?? [];
  const checks = v
    ? `<h2>Checks on this data</h2>
      <div class="checks">
        <div class="check-card"><b>${v.recompute.mismatches === 0 ? "0" : v.recompute.mismatches} mismatches</b><span>${v.recompute.checked.toLocaleString("en")} published figures recomputed from the raw Radar responses.</span></div>
        <div class="check-card"><b>${v.sanity.failures} failures</b><span>${v.sanity.checked} sanity checks: totals near 100%, complete and contiguous months, no failed requests.</span></div>
        ${cc.industries_403_snapshot?.n ? `<div class="check-card"><b>${cc.industries_403_snapshot.medianAbsDiffPP} pts</b><span>Median gap between each industry's 403 rate and the rate implied by Radar's separate traffic and 403 breakdowns.</span></div>` : ""}
        ${live.length ? `<div class="check-card"><b>${Math.max(...live.map((r) => Math.abs(r.diffPP ?? 0))).toFixed(2)} pts</b><span>Largest gap when the headline rates are re-measured from Radar by a different route, ${dateLabel(v.liveCheck!.checkedAt.slice(0, 10))}.</span></div>` : ""}
      </div>
      <p class="small">Full results: <a href="data/verification.json">verification.json</a>, checked ${dateLabel(v.verifiedAt.slice(0, 10))} against ${esc(v.pull)}.</p>`
    : "";
  const gaps: string[] = [];
  if (m.monthsPending.length) gaps.push(`${m.monthsPending.map((x) => monthLabel(x)).join(", ")} could not be pulled and is not shown.`);
  gaps.push("Training-crawler rates are missing for a few industries whose training traffic Radar does not report.");
  gaps.push("Monthly figures by industry cover the 30 industries with the most agent traffic.");
  gaps.push("Radar can revise recent months. We re-pull every month each day, so revisions show up within a day.");
  $("view-method").innerHTML = `<div class="page">
    <h1>Method</h1>
    <dl class="defs">
      <dt>Agents</dt><dd>Bots that fetch a page because a person asked, such as ChatGPT-User and Claude-User. Cloudflare calls this crawl purpose User Action.</dd>
      <dt>403 rate</dt><dd>Of the agent requests in a month or industry, the share answered with 403 Forbidden.</dd>
      <dt>402 rate</dt><dd>The same for 402 Payment Required.</dd>
      <dt>Out of 1,000</dt><dd>The month's 403 and 402 rates times 1,000, rounded. Fewer than one in 1,000 shows as &lt;1.</dd>
      <dt>Industries</dt><dd>Cloudflare assigns sites to industries by the business that owns them. Radar's industry figures cover only sites that have an industry${sites?.["403"] != null ? `: across those sites, ${pct(sites["403"])} of agent requests got a 403 this year, against ${pct(d.overall.agents["403"])} across all agent traffic` : ""}. Most labels match LinkedIn's industry list; the info icon says what each covers.</dd>
      <dt>Traffic share</dt><dd>An industry's share of agent requests to sites that have an industry.</dd>
      <dt>Small industries</dt><dd>Industries with under ${m.lowVolumeThresholdPct}% of agent traffic are hidden by default. A few sites can swing their rates.</dd>
      <dt>Updates</dt><dd>Pulled daily from the Cloudflare Radar API. A month appears once it is complete. Last updated ${dateLabel(m.updated)}.</dd>
    </dl>
    ${checks}
    <h2>Sources</h2>
    <ul class="facts-list">${m.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    ${m.radarNotes.length ? `<h2>Cloudflare's notes on this period</h2><ul class="facts-list">${m.radarNotes.map((n) => `<li>${esc(n.description)}${n.start ? ` (${dateLabel(n.start)}${n.end && n.end !== n.start ? ` to ${dateLabel(n.end)}` : ""})` : ""}</li>`).join("")}</ul>` : ""}
    <h2>Known gaps</h2>
    <ul class="facts-list">${gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
  </div>`;
}

load()
  .then(({ d, v }) => main(d, v))
  .catch((err) => {
    const el = $("load-error");
    el.textContent = `The data file could not be loaded (${(err as Error).message}). Reload the page to try again.`;
    el.hidden = false;
  });
