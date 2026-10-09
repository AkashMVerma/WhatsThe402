import "./styles.css";
import { bindMixFigures, lineChart, mixFigure } from "./charts";
import { dateLabel, esc, monthLabel, pct, ratio } from "./format";
import { initIndustries } from "./industries";
import type { Dataset } from "./types";

async function load(): Promise<Dataset> {
  const res = await fetch("data/index.json", { cache: "no-cache" });
  if (!res.ok) throw new Error(`data/index.json returned ${res.status}`);
  return res.json();
}

function sourceLine(d: Dataset) {
  const { monthly, ytd } = d.meta.windows;
  document.getElementById("source-line")!.innerHTML =
    `Source: <a href="${d.meta.sourceUrl}" rel="noopener">Cloudflare Radar</a>, AI Bots &amp; Crawlers. ` +
    `Monthly data ${monthLabel(monthly.start)} to ${monthLabel(monthly.end)}; industry and agent data ${esc(ytd.label)}. ` +
    `All figures are shares of requests, not counts. Updated ${dateLabel(d.meta.updated)}.`;
}

/** Compare the latest month with the same month a year earlier, in the right direction. */
function yearOnYear(now: number, then: number | null, thenMonth: string | null): string {
  if (then == null || thenMonth == null) return "";
  const when = monthLabel(thenMonth);
  if (then === 0) return now > 0 ? `Up from 0% in ${when}.` : `Unchanged from ${when}.`;
  const mult = now / then;
  if (mult >= 3) return `${ratio(mult)} the ${when} rate of ${pct(then)}.`;
  if (mult <= 1 / 3) return `Down from ${pct(then)} in ${when}, a ${ratio(1 / mult)} fall.`;
  if (pct(now) === pct(then)) return `Unchanged from ${when}.`;
  return `${now > then ? "Up" : "Down"} from ${pct(then)} in ${when}.`;
}

/** If the latest month sits well below the past year's peak, say where the peak was. */
function peakNote(values: number[], months: string[]): string {
  const last = values.length - 1;
  const from = Math.max(0, last - 12);
  let peak = from;
  for (let i = from; i < last; i++) if (values[i] > values[peak]) peak = i;
  if (peak === last || values[last] >= values[peak] * 0.6) return "";
  return `Peak: ${pct(values[peak])} in ${monthLabel(months[peak])}.`;
}

function trendPanel(d: Dataset, code: "403" | "402") {
  const el = document.getElementById(`panel-${code}`)!;
  const months = d.monthly.map((m) => m.month);
  const agents = d.monthly.map((m) => m.agents[code]);
  const all = d.monthly.map((m) => m.allBots[code]);
  const last = d.monthly.length - 1;
  const lastMonth = d.monthly[last].month;
  const yearAgoIdx = months.indexOf(`${Number(lastMonth.slice(0, 4)) - 1}${lastMonth.slice(4)}`);
  const now = agents[last];
  const then = yearAgoIdx >= 0 ? agents[yearAgoIdx] : null;

  const name = code === "403" ? "Forbidden" : "Payment Required";
  const verb = code === "403" ? "refused" : "asked to pay";
  const change = [yearOnYear(now, then, yearAgoIdx >= 0 ? months[yearAgoIdx] : null), peakNote(agents, months)].join(" ").trim();

  el.innerHTML = `
    <header class="panel-head">
      <h3 class="status"><code class="code c${code}">${code}</code> ${name}</h3>
      <p class="figure"><span class="figure-num">${pct(now)}</span> of agent requests ${verb} in ${monthLabel(lastMonth)}</p>
      <p class="figure-sub">${change} All AI bots: ${pct(all[last])}.</p>
    </header>
    <ul class="legend" aria-hidden="true">
      <li><span class="swatch" style="background:var(--c${code})"></span>Agents</li>
      <li><span class="swatch" style="background:var(--cmp)"></span>All AI bots</li>
    </ul>
    <div class="chart-host"></div>`;

  // Annotate the single largest month-on-month jump in the agent series when it is a step change.
  let annotation: { index: number; text: string } | undefined;
  let bestI = -1;
  let best = 0;
  for (let i = 1; i < agents.length; i++) {
    const r = agents[i - 1] > 0 ? agents[i] / agents[i - 1] : 0;
    if (r > best) {
      best = r;
      bestI = i;
    }
  }
  if (best >= 5) annotation = { index: bestI, text: `${monthLabel(months[bestI], true)}: ${Math.round(best)}× in a month` };

  const yMax = code === "403" ? 30 : 1.6;
  const yTicks = code === "403" ? [0, 10, 20, 30] : [0, 0.4, 0.8, 1.2, 1.6];
  lineChart(el.querySelector(".chart-host")!, {
    months,
    yMax: Math.max(yMax, Math.max(...agents, ...all) * 1.05),
    yTicks,
    annotation,
    series: [
      { label: "Agents", values: agents, color: `var(--c${code})` },
      { label: "All AI bots", values: all, color: "var(--cmp)" },
    ],
    ariaLabel: `${code} ${name}: share of agent requests by month, ${monthLabel(months[0])} to ${monthLabel(lastMonth)}. Agents ${pct(agents[0])} to ${pct(now)}; all AI bots ${pct(all[0])} to ${pct(all[last])}.`,
  });
}

function mixBlock(d: Dataset) {
  const a = d.overall.agents["403"];
  const t = d.overall.trainers["403"];
  const times = a / t;
  const headline =
    times >= 1.8 && times < 2.05
      ? "Agents are refused about twice as often as training crawlers"
      : `Agents are refused ${ratio(times)} as often as training crawlers`;
  document.getElementById("mix-block")!.innerHTML = `
    <div class="mix-head">
      <h3>${headline}</h3>
      <p class="muted">Where requests ended up, ${esc(d.meta.windows.ytd.label)}. ${pct(a)} of agent requests got a 403, against ${pct(t)} for training crawlers.</p>
    </div>
    ${mixFigure([
      { label: "Agents", groups: d.overall.agentGroups },
      { label: "Training crawlers", groups: d.overall.trainerGroups },
    ])}`;
  bindMixFigures(document.getElementById("mix-block")!);
}

function agentsSection(d: Dataset) {
  const top402 = [...d.bots].filter((b) => b.shareOfAgent402 != null).sort((a, b) => b.shareOfAgent402! - a.shareOfAgent402!)[0];
  document.getElementById("agents-lede")!.textContent =
    `Which assistants get refused, and which get asked to pay. ${d.meta.windows.ytd.label}.`;

  const rows = d.bots
    .map((b) => {
      const r = b.rates;
      return `<tr>
        <th scope="row">${esc(b.name)}</th>
        <td>${pct(b.trafficShare)}</td>
        <td>${r?.["403"] != null ? `<span class="cell-bar"><span class="cell-fill f403" style="width:${r["403"]}%"></span></span>` : ""}${pct(r?.["403"])}</td>
        <td>${pct(r?.["402"])}</td>
        <td>${pct(b.shareOfAgent402)}</td>
      </tr>`;
    })
    .join("");

  const v = d.verticals402.slice(0, 8);
  const vMax = Math.max(...v.map((x) => x.shareOfAgent402));
  const vRows = v
    .map(
      (x) => `<li><span class="bl-name">${esc(x.name)}</span><span class="bl-track"><span class="bl-fill" style="width:${(x.shareOfAgent402 / vMax) * 100}%"></span></span><span class="bl-val">${pct(x.shareOfAgent402)}</span></li>`,
    )
    .join("");
  const top2 = d.verticals402[0].shareOfAgent402 + d.verticals402[1].shareOfAgent402;
  const gaming = d.industries.find((i) => i.name === "Gaming");

  document.getElementById("agents-body")!.innerHTML = `
    <div class="table-scroll">
      <table class="data">
        <thead><tr>
          <th scope="col">Agent</th>
          <th scope="col">Share of agent traffic</th>
          <th scope="col"><code class="code c403">403</code> rate</th>
          <th scope="col"><code class="code c402">402</code> rate</th>
          <th scope="col">Share of all agent 402s</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <p class="table-note">Rates are the share of that agent's own requests. Cloudflare does not publish response rates for TikTokSpider, Google-NotebookLM or Meta-ExternalFetcher in this view.</p>

    <div class="two-col">
      <div>
        <h3>Where agent 402s land, by vertical</h3>
        <p class="muted">Share of all agent 402 responses, ${esc(d.meta.windows.ytd.label)}.</p>
        <ul class="barlist">${vRows}</ul>
      </div>
      <div>
        <h3>Read the 402 numbers with care</h3>
        <ul class="caveats">
          <li>${esc(top402.name)} receives ${pct(top402.shareOfAgent402)} of all agent 402s, so the 402 trend mostly reflects how sites respond to that one agent.</li>
          <li>Two verticals, ${esc(d.verticals402[0].name)} and ${esc(d.verticals402[1].name)}, account for ${pct(top2)} of agent 402s.</li>
          ${gaming?.note ? `<li>Gaming: ${esc(gaming.note)}</li>` : ""}
          <li>402 is still rare. Across all agent traffic it was ${pct(d.overall.agents["402"])} of responses this year, against ${pct(d.overall.agents["403"])} for 403.</li>
        </ul>
      </div>
    </div>`;
}

function methodSection(d: Dataset) {
  const m = d.meta;
  const gaps: string[] = [];
  if (m.monthsPending.length) gaps.push(`${m.monthsPending.map((x) => monthLabel(x)).join(", ")} could not be pulled and is not shown.`);
  if (d.industries.some((i) => !i.trainers))
    gaps.push("Training-crawler rates are missing for some industries whose names contain commas or whose training traffic is too small to report.");
  const withTrends = d.industries.filter((i) => i.monthly?.length).length;
  if (withTrends) gaps.push(`Monthly industry trends cover the ${withTrends} industries with the most agent traffic.`);
  if (m.failedRequests) gaps.push(`${m.failedRequests} Radar requests failed in the latest pull; affected figures are left out rather than estimated.`);
  gaps.push("Radar can revise recent data. Two pulls of the same month a week apart have differed by up to 0.2 percentage points.");

  const notes = m.radarNotes.length
    ? `<h3>Cloudflare's data notes for this period</h3><ul class="radar-notes">${m.radarNotes
        .map((n) => `<li>${esc(n.description)}${n.start ? ` (${dateLabel(n.start)}${n.end && n.end !== n.start ? ` to ${dateLabel(n.end)}` : ""})` : ""}</li>`)
        .join("")}</ul>`
    : "";

  document.getElementById("method-body")!.innerHTML = `
    <dl class="defs">
      <dt>Agents</dt><dd>${esc(m.definitions.agents)}</dd>
      <dt>Training crawlers</dt><dd>${esc(m.definitions.trainers)}</dd>
      <dt>All AI bots</dt><dd>${esc(m.definitions.allBots)}</dd>
      <dt>Rate</dt><dd>Of the agent requests to an industry, the percent answered with a given code.</dd>
      <dt>Share of total</dt><dd>Of all agent responses with a given code, the percent that came from an industry. Compared against the industry's share of agent traffic: a share above its traffic share means the industry refuses or charges more than its size suggests.</dd>
      <dt>Low-volume industries</dt><dd>Industries with under ${m.lowVolumeThresholdPct}% of agent traffic are hidden by default. A few sites can swing their rates.</dd>
      <dt>Industry labels</dt><dd>Cloudflare's own taxonomy, kept as published, including its duplicates (for example "software" and "Computer Software").</dd>
      <dt>Updates</dt><dd>Refreshed daily from the Radar API. Monthly figures appear once a month is complete. Last updated ${dateLabel(m.updated)}.</dd>
    </dl>
    <h3>Sources</h3>
    <ul class="sources">${m.sources.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    ${notes}
    <h3>Known gaps</h3>
    <ul class="sources">${gaps.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
}

async function main() {
  try {
    const d = await load();
    sourceLine(d);
    trendPanel(d, "403");
    trendPanel(d, "402");
    mixBlock(d);
    initIndustries(document.getElementById("industry-explorer")!, d);
    agentsSection(d);
    methodSection(d);
  } catch (err) {
    const el = document.getElementById("load-error")!;
    el.textContent = `The data file could not be loaded (${(err as Error).message}). Reload the page; if it persists, data/index.json is missing from the deployment.`;
    el.hidden = false;
  }
}

main();
