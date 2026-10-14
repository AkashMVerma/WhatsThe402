// "4Mica's read": our interpretation, kept on its own tab and labelled as such so
// the other tabs stay neutral. Group membership is computed from the data; the
// commentary is fixed text written as hypotheses.
import { esc, pct } from "./format";
import type { Dataset, Industry } from "./types";

interface Group {
  title: string;
  body: string;
  rows: { i: Industry; note: string }[];
}

export function renderRead(host: HTMLElement, d: Dataset) {
  const sites = d.overall.industrySites;
  const b403 = sites?.["403"] ?? d.overall.agents["403"];
  const solid = d.industries.filter((i) => !i.lowVolume && i.agentTrafficShare != null);
  const busy = solid.filter((i) => i.agentTrafficShare! >= 1);
  const top402 = [...d.bots].filter((b) => b.shareOfAgent402 != null).sort((a, b) => b.shareOfAgent402! - a.shareOfAgent402!)[0];
  const months = d.monthly.map((m) => m.month);

  const refused = busy
    .filter((i) => i.agents["403"] > b403 + 2 && i.agents["402"] < 1)
    .sort((a, b) => b.agents["403"] - a.agents["403"]);

  const asking = solid
    .filter((i) => i.agents["402"] >= 1)
    .sort((a, b) => b.shareOfAgent402 - a.shareOfAgent402)
    .slice(0, 6);

  // Busy, mostly open, and asking to pay more in the latest three months than in
  // the three months half a year earlier.
  const L = months.length - 1;
  const rising = busy
    .filter((i) => i.agents["403"] < b403 - 2 && i.monthly?.length && L >= 8 && !asking.includes(i))
    .map((i) => {
      const get = (ms: string[]) => {
        const v = i.monthly!.filter((x) => ms.includes(x.month)).map((x) => x["402"]);
        return v.reduce((s, x) => s + x, 0) / (v.length || 1);
      };
      return { i, a: get(months.slice(L - 8, L - 5)), b: get(months.slice(L - 2)) };
    })
    .filter((r) => r.b >= 0.3 && r.b > r.a * 2)
    .sort((a, b) => b.i.agentTrafficShare! - a.i.agentTrafficShare!);

  const selective = solid
    .filter((i) => i.trainers && i.agents["403"] - i.trainers["403"] >= 20)
    .sort((a, b) => b.agents["403"] - b.trainers!["403"] - (a.agents["403"] - a.trainers!["403"]))
    .slice(0, 6);

  const groups: Group[] = [
    {
      title: "Refused, with no price named",
      body: "These busy industries turn agents away more often than average but almost never ask to be paid. If an agent could prove who it is and pay, some of these refusals might become paid visits. The data can't show that; it's a question to put to site owners in these industries.",
      rows: refused.map((i) => ({ i, note: `${pct(i.agents["403"])} refused, ${pct(i.agents["402"])} asked to pay` })),
    },
    {
      title: "Already asking to pay",
      body: `These industries send the most requests to pay. What we don't know is whether any of them turn into payments.${top402 ? ` The agent on the other side is mostly ${top402.name}, which receives ${pct(top402.shareOfAgent402)} of all requests to pay sent to agents.` : ""}`,
      rows: asking.map((i) => ({ i, note: `${pct(i.agents["402"])} asked to pay, ${pct(i.shareOfAgent402)} of all agent 402s` })),
    },
    {
      title: "Busy, open and starting to ask",
      body: "Lots of agents visit these industries and few are turned away, but requests to pay are climbing. Here the need is more likely agents that can identify themselves and pay at checkout than a fee for each page.",
      rows: rising.map((r) => ({ i: r.i, note: `asked to pay on ${pct(r.a)} of agent requests, now ${pct(r.b)} (three-month averages)` })),
    },
    {
      title: "Different rules for different bots",
      body: "These industries refuse agents far more often than training crawlers, so they already treat bots differently depending on what the bot is for. Pricing by purpose would be a small step from there. Of the four, this is the most speculative.",
      rows: selective.map((i) => ({ i, note: `${pct(i.agents["403"])} of agent requests refused, ${pct(i.trainers!["403"])} of training-crawler requests` })),
    },
  ];

  host.innerHTML = `<div class="page read">
    <h1>4Mica's read</h1>
    <p class="disclose">This page is our interpretation of the data. WhatsThe402 is run by <a href="https://4mica.io" rel="noopener">4Mica</a>, which builds payment infrastructure for AI agents, so we have a stake in where payments go. The Overview, Industries and Agents tabs show the data without our opinion.</p>
    <p class="sub">We group industries by what their numbers suggest about paid access for agents. Groups use year-to-date figures and leave out industries with under 0.1% of agent traffic. Membership updates with the data.</p>
    ${groups
      .map(
        (g) => `<section class="read-group">
        <h2>${esc(g.title)}</h2>
        <p>${esc(g.body)}</p>
        ${
          g.rows.length
            ? `<ul class="read-list">${g.rows.map((r) => `<li><b>${esc(r.i.name)}</b><span>${esc(r.note)}</span></li>`).join("")}</ul>`
            : `<p class="small">No industry fits this group in the current data.</p>`
        }
      </section>`,
      )
      .join("")}
    <p class="small">Being on one of these lists doesn't mean an industry will pay for agent access. Benchmark for refusals: ${pct(b403)} of agent requests across ${sites ? "all sites with a known industry" : "all agent traffic"}.</p>
  </div>`;
}
