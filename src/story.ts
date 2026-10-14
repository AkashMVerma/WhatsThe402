// The question-led overview: each card asks a reader's question, answers it in
// one heading and one sentence computed from the data, shows one chart, and says
// why it matters. All wording is generated from index.json so it stays true as
// the data refreshes; only the dated events and the outlook copy are fixed text.
import { lineChart, niceScale, scatterChart } from "./charts";
import { esc, monthLabel, pct } from "./format";
import type { Dataset, Industry } from "./types";

const LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const monthLong = (ym: string) => `${LONG[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;

/** Dated platform changes marked on the monthly charts. */
export const EVENTS = [
  {
    month: "2025-07",
    date: "1 Jul 2025",
    text: "Cloudflare starts blocking AI crawlers by default, asks every new domain whether to allow them, and begins testing pay per crawl, which answers with a 402 and a price.",
    url: "https://www.cloudflare.com/press/press-releases/2025/cloudflare-just-changed-how-ai-crawlers-scrape-the-internet-at-large/",
  },
  {
    month: "2025-08",
    date: "28 Aug 2025",
    text: "Every paying Cloudflare customer can send a custom 402 to the bots they choose.",
    url: "https://blog.cloudflare.com/introducing-ai-crawl-control/",
  },
  {
    month: "2026-07",
    date: "1 Jul 2026",
    text: "Cloudflare gives every plan, free ones included, separate switches for search, agent and training bots.",
    url: "https://blog.cloudflare.com/content-independence-day-ai-options/",
  },
  {
    month: "2026-09",
    date: "15 Sep 2026",
    text: "New domains on Cloudflare block agent and training bots by default on pages that show ads.",
    url: "https://blog.cloudflare.com/content-independence-day-ai-options/",
  },
];

/** Months whose figures we don't yet trust, shaded on the charts. */
export const REVIEW = [
  {
    month: "2026-08",
    text: "Refusals jumped for every kind of AI bot in August 2026, and so did “page not found” answers. That looks more like a change on Cloudflare’s side than thousands of site owners deciding at once, so we treat the month as under review.",
  },
];

// ---- Plain-number helpers ----
const in100 = (v: number) => (Math.round(v) === 0 ? "fewer than 1" : String(Math.round(v)));
const of100 = (v: number) => (Math.round(v) === 0 ? "fewer than 1 in 100" : `${Math.round(v)} of every 100`);
const n1000 = (v: number) => Math.round(v * 10);
const of1000 = (v: number) => (n1000(v) === 0 ? "fewer than 1 in 1,000" : `${n1000(v)} of every 1,000`);
const pts = (v: number) => `${Math.round(Math.abs(v))} point${Math.round(Math.abs(v)) === 1 ? "" : "s"}`;

/** "about twice as often as", "more often than", ... for a ratio a/b. */
function often(r: number): string {
  if (!Number.isFinite(r)) return "more often than";
  if (r >= 2.75) return `about ${Math.round(r)} times as often as`;
  if (r >= 1.75) return "about twice as often as";
  if (r >= 1.15) return "more often than";
  if (r > 0.87) return "about as often as";
  if (r > 0.55) return "less often than";
  return "far less often than";
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  // Names like "Leisure, Travel & Tourism" contain commas, so separate with semicolons then.
  if (names.some((n) => n.includes(","))) return `${names.slice(0, -1).join("; ")}; and ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function rangeLabel(a: string, b: string): string {
  return a.slice(0, 4) === b.slice(0, 4)
    ? `${LONG[+a.slice(5) - 1]} to ${LONG[+b.slice(5) - 1]} ${b.slice(0, 4)}`
    : `${monthLabel(a)} to ${monthLabel(b)}`;
}

const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / (xs.length || 1);

interface Card {
  id: string;
  ask: string;
  answer: string;
  text: string;
  why: string;
  more?: { view: string; label: string };
}

function cardHtml(c: Card, viz: string): string {
  return `<article class="q" id="${c.id}">
    <p class="q-ask">${esc(c.ask)}</p>
    <h3 class="q-answer" data-slot="answer">${esc(c.answer)}</h3>
    <p class="q-text" data-slot="text">${esc(c.text)}</p>
    <div class="q-viz">${viz}</div>
    <p class="q-why"><span>Why it matters</span>${esc(c.why)}</p>
    ${c.more ? `<a class="q-more" href="#${c.more.view}" data-view="${c.more.view}">${esc(c.more.label)}</a>` : ""}
  </article>`;
}

function eventList(months: string[], withReview: boolean): string {
  const ev = EVENTS.filter((e) => months.includes(e.month));
  const rv = withReview ? REVIEW.filter((r) => months.includes(r.month)) : [];
  if (!ev.length && !rv.length) return "";
  return `<ol class="events">
    ${ev.map((e, i) => `<li><span class="ev-n">${i + 1}</span><span><b>${esc(e.date)}.</b> ${esc(e.text)} <a href="${e.url}" rel="noopener">Source</a></span></li>`).join("")}
    ${rv.map((r) => `<li><span class="ev-hatch" aria-hidden="true"></span><span>${esc(r.text)}</span></li>`).join("")}
  </ol>`;
}

export function initStory(host: HTMLElement, d: Dataset, getIdx: () => number) {
  const months = d.monthly.map((m) => m.month);
  const L = months.length - 1;
  const a403 = d.monthly.map((m) => m.agents["403"]);
  const a402 = d.monthly.map((m) => m.agents["402"]);
  const evIdx = EVENTS.filter((e) => months.includes(e.month)).map((e, i) => ({ index: months.indexOf(e.month), n: i + 1 }));
  const rvIdx = REVIEW.filter((r) => months.includes(r.month)).map((r) => months.indexOf(r.month));
  const peakOf = (vals: number[]) => vals.indexOf(Math.max(...vals));
  const sites = d.overall.industrySites;
  const bench403 = sites?.["403"] ?? d.overall.agents["403"];
  const bench402 = sites?.["402"] ?? d.overall.agents["402"];
  const benchName = sites ? "all sites with a known industry" : "all agent traffic";
  const solid = d.industries.filter((i) => !i.lowVolume && i.agentTrafficShare != null);

  // ---- Card 1: refusals, follows the month control ----
  function card1(k: number): Pick<Card, "answer" | "text"> {
    const v = a403[k];
    const j = k >= 12 ? k - 12 : 0;
    const p = peakOf(a403);
    const peakNote = ` The highest month was ${monthLong(months[p])}, at ${in100(a403[p])} in 100${rvIdx.includes(p) ? ", a month we treat as under review" : ""}.`;
    if (k === j) {
      return { answer: `In ${monthLong(months[k])}, websites refused ${of100(v)} agent requests`, text: `${cap(of100(v))} requests from AI agents got a 403 in ${monthLong(months[k])}.${peakNote}` };
    }
    const when = k >= 12 ? "a year earlier" : `in ${monthLong(months[j])}`;
    const dir = Math.round(v) > Math.round(a403[j]) ? "up from" : Math.round(v) < Math.round(a403[j]) ? "down from" : "the same as";
    return {
      answer: `In ${monthLong(months[k])}, websites refused AI agents ${often(v / a403[j])} ${when}`,
      text: `${cap(of100(v))} requests from AI agents got a 403 in ${monthLong(months[k])}, ${dir} ${in100(a403[j])} in 100 in ${monthLong(months[j])}.${peakNote}`,
    };
  }

  // ---- Card 2: asks to pay, follows the month control ----
  function card2(k: number): Pick<Card, "answer" | "text"> {
    const v = a402[k];
    const p = peakOf(a402);
    let answer: string;
    if (n1000(v) < 10) {
      answer = "Asking agents to pay is still rare";
      if (k > p && v < a402[p] * 0.5) answer += `, and it has fallen since ${monthLong(months[p])}`;
      else if (k === p) answer += `, though ${monthLong(months[k])} was the highest month so far`;
    } else {
      answer = `About ${n1000(v)} in 1,000 agent requests were asked to pay in ${monthLong(months[k])}`;
    }
    const first = a402.findIndex((x) => x >= 0.1);
    let text = `In ${monthLong(months[k])}, ${of1000(v)} agent requests got a 402, which means the site asked to be paid before serving the page.`;
    if (k !== p) text += ` The highest month was ${monthLong(months[p])}, at ${n1000(a402[p])} in 1,000.`;
    if (first > 0) text += ` Before ${monthLong(months[first])} it was under 1 in 1,000.`;
    return { answer, text };
  }

  const c1 = card1(getIdx());
  const c2 = card2(getIdx());

  // ---- Card 3: who gets asked to pay ----
  const bots = d.bots.filter((b) => b.shareOfAgent402 != null);
  const top = [...bots].sort((a, b) => b.shareOfAgent402! - a.shareOfAgent402!)[0];
  const others402 = bots.filter((b) => b !== top).map((b) => b.rates?.["402"] ?? 0);
  let card3: Card | null = null;
  let viz3 = "";
  if (top) {
    const concentrated = top.shareOfAgent402! >= 50;
    card3 = {
      id: "q-who-pays",
      ask: "Which agents get asked to pay?",
      answer: concentrated
        ? `One agent receives ${in100(top.shareOfAgent402!)} of every 100 requests to pay`
        : `${top.name} receives the most requests to pay`,
      text:
        `${top.name} makes ${of100(top.trafficShare)} agent requests but receives ${of100(top.shareOfAgent402!)} requests to pay sent to agents this year.` +
        (top.rates?.["402"] != null && others402.length ? ` Its own 402 rate is ${pct(top.rates["402"])}; no other named agent is above ${pct(Math.max(...others402))}.` : ""),
      why: concentrated
        ? "The 402 line mostly shows how websites treat this one agent. A change in how it behaves, or in how Cloudflare labels it, can move the whole trend."
        : "Requests to pay are spread across several agents, so the 402 trend reflects how websites treat agents in general.",
      more: { view: "agents", label: "See every agent" },
    };
    const max = Math.max(...bots.map((b) => Math.max(b.trafficShare, b.shareOfAgent402!)));
    viz3 = `<ul class="legend"><li><span class="swatch" style="background:#9a9a9a"></span>Share of agent traffic</li><li><span class="swatch" style="background:var(--blue)"></span>Share of requests to pay</li></ul>
      <div class="pairs">${bots
        .map(
          (b) => `<div class="pair">
          <span class="pair-name">${esc(b.name)}</span>
          <span class="hbar"><span style="width:${((b.trafficShare / max) * 100).toFixed(1)}%;background:#9a9a9a"></span></span><span class="hval">${pct(b.trafficShare)}</span>
          <span class="hbar"><span style="width:${((b.shareOfAgent402! / max) * 100).toFixed(1)}%;background:var(--blue)"></span></span><span class="hval">${pct(b.shareOfAgent402)}</span>
        </div>`,
        )
        .join("")}</div>
      <p class="q-note">Year to date. Agents below Cloudflare's reporting cutoff are not listed.</p>`;
  }

  // ---- Card 4: agents vs training crawlers ----
  const ag = d.overall.agents["403"];
  const tr = d.overall.trainers["403"];
  const withTr = solid.filter((i) => i.trainers);
  const worse = withTr.filter((i) => i.agents["403"] > i.trainers!["403"]).length;
  const trMonthly = d.monthly.map((m) => m.training?.["403"] ?? null);
  const hasTr = trMonthly.every((x) => x != null);
  const card4: Card = {
    id: "q-agents-vs-training",
    ask: "Are agents treated differently from AI training crawlers?",
    answer: `Websites refuse agents ${often(ag / tr)} training crawlers`,
    text: `This year, ${of100(ag)} agent requests were refused, against ${of100(tr)} requests from crawlers that collect pages to train AI models. Agents were refused more often in ${worse} of ${withTr.length} industries.`,
    why:
      ag / tr >= 1.15
        ? "Surveys of robots.txt files suggest websites mind training bots more, yet the refusals that actually happen land more often on agents working for a person. One possible reason is that crawlers that follow robots.txt never ask for the pages they're told to skip, so they are rarely refused."
        : "Websites treat the two kinds of bot about the same at the door, whatever their robots.txt files say.",
  };

  // ---- Card 5: demand and refusal by industry ----
  const big = [...solid].sort((a, b) => b.agentTrafficShare! - a.agentTrafficShare!)[0];
  const busy = solid.filter((i) => i.agentTrafficShare! >= 1);
  const topRef = [...busy].sort((a, b) => b.agents["403"] - a.agents["403"])[0];
  const rel = (v: number) => (v < bench403 * 0.5 ? "far fewer than average" : v < bench403 * 0.87 ? "fewer than average" : v <= bench403 * 1.15 ? "about an average share" : "more than average");
  const card5: Card | null =
    big && topRef
      ? {
          id: "q-industries",
          ask: "Which industries do agents visit most, and which turn them away?",
          answer:
            big === topRef
              ? `${big.name} gets the most agent visits and refuses the most`
              : `${big.name} gets the most agent visits and turns away ${rel(big.agents["403"])}; ${topRef.name} refuses the most`,
          text:
            `${big.name} receives ${of100(big.agentTrafficShare!)} agent requests to sites with a known industry and refuses ${in100(big.agents["403"])} in 100 of them.` +
            (big !== topRef ? ` Among industries with at least 1 in 100 agent visits, ${topRef.name} refuses the most, ${in100(topRef.agents["403"])} in 100.` : "") +
            ` Across ${benchName}, ${in100(bench403)} in 100 are refused.`,
          why: "Where many agents arrive and many are turned away, people are sending agents to places that won't serve them.",
          more: { view: "industries", label: "See every industry" },
        }
      : null;

  // ---- Card 6: who asks to pay ----
  const payers = [...solid].sort((a, b) => b.agents["402"] - a.agents["402"]);
  const swing = (i: Industry) => {
    const s = i.monthly?.map((x) => x["402"]) ?? [];
    return s.length ? Math.max(...s) - Math.min(...s) > 20 : false;
  };
  const [p1, p2] = payers;
  const card6: Card | null =
    p1 && p2
      ? {
          id: "q-industries-pay",
          ask: "Which industries ask agents to pay?",
          answer: `${p1.name} and ${p2.name} ask agents to pay most often`,
          text:
            `This year ${p1.name} asked for payment on ${of100(p1.agents["402"])} agent requests and ${p2.name} on ${in100(p2.agents["402"])} in 100, against ${in100(bench402)} in 100 across ${benchName}.` +
            (swing(p1) && swing(p2)
              ? " Both rates swing a lot from month to month."
              : [p1, p2].filter(swing).map((i) => ` ${i.name}'s rate swings a lot from month to month.`).join("")),
          why: "These websites already put a price on access. Whether agents pay is the next thing to watch, and this data can't show that yet.",
          more: { view: "industries", label: "Rank industries by 402" },
        }
      : null;
  const payTop = payers.slice(0, 6);
  const payMax = Math.max(bench402, ...payTop.map((i) => i.agents["402"]));
  const viz6 = `<div class="ranks">
    <div class="rank bench"><span>${esc(cap(benchName))}</span><span class="hbar"><span style="width:${((bench402 / payMax) * 100).toFixed(1)}%;background:#9a9a9a"></span></span><span class="hval">${pct(bench402)}</span></div>
    ${payTop
      .map(
        (i) => `<div class="rank"><span>${esc(i.name)}</span><span class="hbar"><span style="width:${((i.agents["402"] / payMax) * 100).toFixed(1)}%;background:var(--blue)"></span></span><span class="hval">${pct(i.agents["402"])}</span></div>`,
      )
      .join("")}
  </div>
  <p class="q-note">Share of agent requests answered with a 402, year to date. Industries with under 0.1% of agent traffic are left out.</p>`;

  // ---- Card 7: what changed ----
  const tracked = d.industries.filter((i) => i.monthly?.length);
  let card7: Card | null = null;
  let viz7 = "";
  if (L >= 8 && tracked.length >= 5) {
    const A = months.slice(L - 8, L - 5);
    const B = months.slice(L - 2);
    const mv = tracked
      .map((i) => {
        const get = (ms: string[]) => avg(i.monthly!.filter((x) => ms.includes(x.month)).map((x) => x["403"]));
        return { i, a: get(A), b: get(B) };
      })
      .map((r) => ({ ...r, dlt: r.b - r.a }));
    const up = mv.filter((r) => r.dlt > 0).sort((a, b) => b.dlt - a.dlt);
    const down = mv.filter((r) => r.dlt < 0).sort((a, b) => a.dlt - b.dlt);
    const N = mv.length;
    const share = up.length / N;
    card7 = {
      id: "q-change",
      ask: "What changed this year?",
      answer:
        share >= 0.6
          ? `Refusals rose in ${up.length} of the ${N} busiest industries`
          : share <= 0.4
            ? `Refusals fell in ${down.length} of the ${N} busiest industries`
            : "Refusals rose in some busy industries and fell in others",
      text:
        `Comparing ${rangeLabel(A[0], A[2])} with ${rangeLabel(B[0], B[2])}, the agent 403 rate went up in ${up.length} of the ${N} industries we track monthly.` +
        (up.length >= 2 ? ` The biggest rises were in ${up[0].i.name} (up ${pts(up[0].dlt)}) and ${up[1].i.name} (up ${pts(up[1].dlt)}).` : "") +
        (down.length && down.length <= 3 ? ` It fell in ${listNames(down.map((r) => r.i.name))}.` : down.length ? ` It fell most in ${down[0].i.name} (down ${pts(down[0].dlt)}).` : ""),
      why:
        share >= 0.75
          ? "When almost every industry moves the same way at the same time, a shared cause, such as a change in Cloudflare's settings, is more likely than separate decisions in each industry."
          : "Industries are moving in different directions, which points to choices made industry by industry more than to one shared cause.",
      more: { view: "industries", label: "See monthly trends by industry" },
    };
    const rows = [...up.slice(0, 5), ...down.slice(0, 3)];
    viz7 = `<ul class="legend"><li><span class="dot" style="background:#9a9a9a"></span>${esc(rangeLabel(A[0], A[2]))}</li><li><span class="dot" style="background:var(--red)"></span>${esc(rangeLabel(B[0], B[2]))}</li></ul>
      <div class="bells">${rows
        .map(
          (r) => `<div class="bell"><span class="bell-name">${esc(r.i.name)}</span>
          <span class="bell-track"><span class="bell-line" style="left:${Math.min(r.a, r.b).toFixed(1)}%;width:${Math.abs(r.dlt).toFixed(1)}%"></span>
          <span class="dot" style="left:${r.a.toFixed(1)}%;background:#9a9a9a"></span><span class="dot" style="left:${r.b.toFixed(1)}%;background:var(--red)"></span></span>
          <span class="hval">${r.dlt > 0 ? "+" : "−"}${Math.round(Math.abs(r.dlt))}</span></div>`,
        )
        .join("")}</div>
      <p class="q-note">Average agent 403 rate over each three-month window, on a 0 to 100% scale. The number on the right is the change in percentage points. Showing the biggest rises and falls.</p>`;
  }

  // ---- Markup ----
  const c1Card: Card = {
    id: "q-refused",
    ask: "How often do websites turn AI agents away?",
    ...c1,
    why: "Each refusal is a task someone gave an agent that the website wouldn't allow, so this rate shows how much of the web agents can actually use.",
  };
  const c2Card: Card = {
    id: "q-pay",
    ask: "How often are agents asked to pay?",
    ...c2,
    why: "A 402 shows where a website has put a price on access. It doesn't show that anyone paid, and an agent that can't pay is turned away just the same.",
  };

  host.innerHTML = `
    <div class="story-head">
      <h2>What the data says</h2>
      <p class="sub">Each answer below is written from the latest Cloudflare Radar data and changes when the data does. The first two follow the month picked at the top.</p>
    </div>
    ${cardHtml(c1Card, `<div id="ch-403"></div>${eventList(months, true)}`)}
    ${cardHtml(c2Card, `<div id="ch-402"></div><p class="q-note">Numbered marks are the same Cloudflare changes listed above.</p>`)}
    ${card3 ? cardHtml(card3, viz3) : ""}
    ${cardHtml(card4, hasTr ? `<div id="ch-train"></div>` : "")}
    ${card5 ? cardHtml(card5, `<ul class="legend"><li><span class="dot" style="background:var(--red)"></span>An industry</li><li><span class="dash"></span>${esc(cap(benchName))}, ${pct(bench403)} refused</li></ul><div id="ch-scatter"></div><p class="q-note">Each dot is an industry with at least 0.1% of agent traffic, year to date. Hover or tap a dot to see its name.</p>`) : ""}
    ${card6 ? cardHtml(card6, viz6) : ""}
    ${card7 ? cardHtml(card7, viz7) : ""}`;

  // ---- Charts ----
  const y3 = niceScale(Math.max(...a403));
  const o403 = { months, series: [{ label: "Agents", values: a403, color: "var(--red)" }], ...y3, events: evIdx, review: rvIdx, focus: getIdx(), ariaLabel: "Share of AI agent requests refused with a 403, by month" };
  const redraw403 = lineChart(host.querySelector<HTMLElement>("#ch-403")!, o403);
  const y2 = niceScale(Math.max(...a402));
  const o402 = { months, series: [{ label: "Agents", values: a402, color: "var(--blue)" }], ...y2, events: evIdx, review: rvIdx, focus: getIdx(), ariaLabel: "Share of AI agent requests asked to pay with a 402, by month" };
  const redraw402 = lineChart(host.querySelector<HTMLElement>("#ch-402")!, o402);
  if (hasTr) {
    lineChart(host.querySelector<HTMLElement>("#ch-train")!, {
      months,
      series: [
        { label: "Agents", values: a403, color: "var(--red)" },
        { label: "Training", values: trMonthly as number[], color: "#8a8a8a" },
      ],
      ...niceScale(Math.max(...a403, ...(trMonthly as number[]))),
      review: rvIdx,
      ariaLabel: "403 rate for AI agents and for training crawlers, by month",
    });
  }
  if (card5) {
    const labelSet = new Set<Industry>([big, topRef, ...[...busy].sort((a, b) => b.agentTrafficShare! - a.agentTrafficShare!).slice(1, 3), ...[...busy].sort((a, b) => b.agents["403"] - a.agents["403"]).slice(1, 2)]);
    scatterChart(host.querySelector<HTMLElement>("#ch-scatter")!, {
      points: solid.map((i) => ({ name: i.name, x: i.agentTrafficShare!, y: i.agents["403"], label: labelSet.has(i), keyLabel: i === big || i === topRef })),
      bench: bench403,
      benchLabel: `${cap(benchName)}, ${pct(bench403)}`,
      xLabel: "Share of agent traffic",
      yLabel: "Refused (403)",
      ariaLabel: "Industries by share of agent traffic and share of agent requests refused",
    });
  }

  return {
    update() {
      const k = getIdx();
      const set = (id: string, c: Pick<Card, "answer" | "text">) => {
        const el = host.querySelector(`#${id}`)!;
        el.querySelector('[data-slot="answer"]')!.textContent = c.answer;
        el.querySelector('[data-slot="text"]')!.textContent = c.text;
      };
      set("q-refused", card1(k));
      set("q-pay", card2(k));
      o403.focus = k;
      o402.focus = k;
      redraw403();
      redraw402();
    },
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Fixed, dated outlook copy plus the limits box (numbers computed). */
export function outlookHtml(d: Dataset): string {
  const tik = d.bots.find((b) => b.name === "TikTokSpider");
  const s403 = d.overall.industrySites?.["403"];
  return `
  <section class="outlook">
    <h2>Where this is heading</h2>
    <p>Refusals of AI agents rose through 2026, and Cloudflare keeps making refusing easier. In July 2026 it gave every plan, free ones included, separate switches for search, agent and training bots, and from 15 September 2026 new domains block agent and training bots by default on pages that show ads (<a href="https://blog.cloudflare.com/content-independence-day-ai-options/" rel="noopener">Cloudflare</a>). We expect refusal rates to stay high as more sites pick up these settings, though this data can't yet separate the effect of defaults from site owners' own choices.</p>
    <p>Asking agents to pay is growing more slowly. Cloudflare began testing pay per crawl, which answers with a 402 and a price, in July 2025 (<a href="https://blog.cloudflare.com/introducing-pay-per-crawl/" rel="noopener">Cloudflare</a>), and since August 2025 any paying Cloudflare customer can send a custom 402 to the bots they choose (<a href="https://blog.cloudflare.com/introducing-ai-crawl-control/" rel="noopener">Cloudflare</a>). The money that actually moves is still small. Visa's analysis put adjusted volume on x402, an open protocol for agent payments, at about $15.0M across 109.6M transactions as of 21 April 2026 (<a href="https://forkast.news/visa-artemis-the-0-14-reality-of-agent-commerce/" rel="noopener">Forkast</a>).</p>
    <p>Next we'll watch the 402 rate for agents other than ChatGPT-User, whether Cloudflare publishes what pay per crawl pays out, and the next adjusted x402 figures.</p>
  </section>
  <section class="limits">
    <h2>What this data can't tell you</h2>
    <ul>
      <li><b>Counts.</b> Every figure is a share of requests. A rising rate can mean more refusals or fewer requests overall.</li>
      <li><b>The whole web.</b> Cloudflare Radar only sees websites that use Cloudflare.</li>
      <li><b>Who counts as an agent.</b> Cloudflare decides which bots act for a person.${tik ? ` That includes TikTokSpider, which makes ${of100(tik.trafficShare)} agent requests.` : ""}</li>
      ${s403 != null ? `<li><b>Every site's industry.</b> Industry figures cover only sites Cloudflare has given an industry. Those sites refused ${in100(s403)} in 100 agent requests this year, against ${in100(d.overall.agents["403"])} in 100 overall.</li>` : ""}
      <li><b>Whether anyone paid.</b> A 402 is a request to pay. We can't see payments, and for an agent that can't pay, a 402 works like a refusal.</li>
      <li><b>Why.</b> We see what websites answered, not their reasons. Cloudflare's default settings, changes in which agents are active, and revisions to Radar's data can all move the numbers.</li>
      <li><b>Robots.txt.</b> Bots that follow robots.txt never ask for pages they're told to skip, so they don't show up as refused.</li>
    </ul>
  </section>`;
}
