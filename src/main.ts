import "./styles.css";
import { dateLabel, esc, monthLabel, pct } from "./format";
import { CAVEATS, EVENTS, REVIEW } from "./events";
import { initIndustries } from "./industries";
import { CONTACT_EMAIL } from "./config";
import { initRankSwitch, rankSwitchHtml } from "./rankswitch";
import { agentFindings, compareLine, refusedDemand, rising402, spark } from "./lines";
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
  const rise = rising402(d);
  const refused = refusedDemand(d);
  const refMax = Math.max(...refused.map((i) => i.shareOfAgent403), 0.01);
  const af = agentFindings(d);
  const afMax = Math.max(...af.rows.map((r) => r.rate), 1);
  ov.innerHTML = `
    <div class="edition reveal">
      <p class="edition-name"><b>The 402 Index</b>, <span data-month></span> <span class="edition-latest" id="ed-latest">latest complete month</span></p>
      <p class="edition-note">A monthly measure of how websites answer AI agents. The figures are estimates from the requests Cloudflare sees, not every AI agent request on the web. <a href="#method" data-view="method">How we measure</a></p>
    </div>
    <div class="kinds reveal" aria-label="Who we count">
      <p><b>AI bots</b>Any automated visitor run by an AI company.</p>
      <p><b>Crawlers</b>Bots that collect pages in bulk, mostly to train models or build search indexes.</p>
      <p class="kinds-us"><b>AI agents</b>Bots fetching a page right now because a person asked, like ChatGPT-User. This index counts these.</p>
    </div>
    <section class="field" id="f403">
      <div>
        <p class="q-label">How often are AI agents turned away?</p>
        <p class="field-code">403 Forbidden</p>
        <p class="field-num" id="n403"></p>
        <p class="field-text">of AI agent requests seen by Cloudflare were refused in <span data-month></span>.</p>
        <p class="field-delta" id="d403"></p>
      </div>
      <div class="field-side">
        <div class="side-top">
          <span class="cap">403 rate by month. Highest ${pct(a403[peak(a403)])} in ${monthLabel(months[peak(a403)])}.</span>
          <button type="button" class="play" id="play" aria-label="Play every month"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 1.2v9.6L10.4 6z" fill="currentColor"/></svg><span>Play</span></button>
        </div>
        <div class="cells" id="cells403"></div>
        <div class="cell-axis"><span>${monthLabel(months[0])}</span><span>${monthLabel(months[months.length - 1])}</span></div>
      </div>
    </section>
    <section class="field" id="f402">
      <div>
        <p class="q-label">How often are they asked to pay?</p>
        <p class="field-code">402 Payment Required</p>
        <p class="field-num" id="n402"></p>
        <p class="field-text">of AI agent requests seen by Cloudflare were asked to pay in <span data-month></span>.</p>
        <p class="field-delta" id="d402"></p>
      </div>
      <div class="field-side">
        <span class="cap">402 rate by month. Highest ${pct(a402[peak(a402)])} in ${monthLabel(months[peak(a402)])}.</span>
        <div class="cells" id="cells402"></div>
        <div class="cell-axis"><span>${monthLabel(months[0])}</span><span>${monthLabel(months[months.length - 1])}</span></div>
      </div>
    </section>
    <section class="thousand reveal">
      <div>
        <p class="q-label">What happens to 1,000 agent requests?</p>
        <h2>Out of every 1,000 agent requests in <span data-month></span></h2>
        <p class="count"><span class="swatch" style="background:var(--red)"></span><b id="c403"></b><span>were refused<em>Demand a price could open</em></span></p>
        <p class="count"><span class="swatch" style="background:var(--blue)"></span><b id="c402"></b><span>were asked to pay<em>Already priced</em></span></p>
        <p class="count"><span class="swatch" style="background:var(--other)"></span><b id="cRest"></b><span>got any other answer</span></p>
        <p class="thousand-note">We count each refusal as potential market: a request the website could price instead of block.</p>
        <button type="button" class="link-btn replay" id="dots-replay">Replay</button>
      </div>
      <div class="dots" id="dots" role="img"></div>
    </section>
    <section class="who reveal">
      <div>
        <p class="q-label">Which agents get turned away?</p>
        ${af.lines.map((l) => `<p class="who-line">${esc(l)}</p>`).join("")}
      </div>
      <div>
        <p class="small">Share of each agent's requests refused, ${esc(d.meta.windows.ytd.label)}</p>
        <ol class="mlist">${af.rows
          .map((r) => `<li><span class="m-name">${esc(r.name)}</span><span class="m-bar"><span style="width:${((r.rate / afMax) * 100).toFixed(1)}%"></span></span><span class="m-val"><b>${pct(r.rate)}</b></span></li>`)
          .join("")}</ol>
        <a class="m-more" href="#agents" data-view="agents">Every agent</a>
      </div>
    </section>
    ${rankSwitchHtml()}
    <section class="market reveal">
      <p class="q-label market-q">Where is the opportunity?</p>
      ${
        rise && rise.rows.length
          ? `<div class="market-col">
        <h2>Where asks to pay are rising</h2>
        <p class="small">Agent 402 rate, ${rise.before} against ${rise.after}</p>
        <ol class="mlist">${rise.rows
          .map((r) => `<li><span class="m-name">${esc(r.ind.name)}</span>${spark(r.series, "var(--blue)")}<span class="m-val">${pct(r.before)} <span aria-hidden="true">&rarr;</span><span class="sr"> to </span> <b>${pct(r.after)}</b></span></li>`)
          .join("")}</ol>
      </div>`
          : ""
      }
      <div class="market-col">
        <h2>Where refused demand is largest</h2>
        <p class="small">Share of all refused agent requests, ${esc(d.meta.windows.ytd.label)}</p>
        <ol class="mlist">${refused
          .map((i) => `<li><span class="m-name">${esc(i.name)}</span><span class="m-bar"><span style="width:${((i.shareOfAgent403 / refMax) * 100).toFixed(1)}%"></span></span><span class="m-val"><b>${pct(i.shareOfAgent403)}</b></span></li>`)
          .join("")}</ol>
      </div>
      <a class="m-more" href="#industries" data-view="industries">Every industry</a>
    </section>
    <p class="limits-line reveal">Shares of requests, not counts. Only websites on Cloudflare. A 402 is a request to pay, not proof of payment. <a href="#method" data-view="method">Every caveat</a></p>
    ${
      CONTACT_EMAIL
        ? `<section class="cta reveal">
      <div>
        <h2>Selling to agents, or building them?</h2>
        <p>4Mica builds payment infrastructure for AI agents. Tell us what you're seeing.</p>
      </div>
      <a class="btn cta-btn" href="mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent("The 402 Index")}">Talk to 4Mica</a>
    </section>`
        : ""
    }`;

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
      b.addEventListener("click", () => {
        stopPlay();
        setMonth(k);
      });
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

  // ---- Motion (subtle; skipped when the reader prefers reduced motion) ----
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const shown = new WeakMap<HTMLElement, number>();
  let playing = false;
  // Count a big number from its last value to the new one.
  function countTo(el: HTMLElement, to: number) {
    const from = shown.get(el) ?? 0;
    shown.set(el, to);
    if (calm || playing || from === to) {
      el.textContent = pct(to);
      return;
    }
    const t0 = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - t0) / 650);
      const e = 1 - Math.pow(1 - p, 3);
      el.textContent = pct(p < 1 ? from + (to - from) * e : to);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  // The 1,000-request grid. Squares start scattered, the way requests arrive, and
  // group by answer once, the first time the grid scrolls into view. Colour
  // follows the request; position follows the scattered or grouped layout.
  let seed = 402;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const order = [...Array(1000).keys()];
  for (let i = 999; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const scatter = new Array<number>(1000);
  order.forEach((id, slot) => (scatter[id] = slot));
  let grouped = calm;
  function placeDots(animate: boolean) {
    dots.classList.toggle("still", !animate || calm);
    const cell = dots.clientWidth / 50;
    dotEls.forEach((el, id) => {
      const slot = grouped ? id : scatter[id];
      el.style.transform = `translate(${(slot % 50) * cell}px, ${Math.floor(slot / 50) * cell}px)`;
    });
  }
  function paintDots(n3: number, n2: number) {
    dotEls.forEach((el, i) => (el.className = i < n3 ? "r" : i < n3 + n2 ? "b" : ""));
  }
  function groupDots() {
    grouped = false;
    placeDots(false);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        grouped = true;
        placeDots(true);
      }),
    );
  }
  placeDots(false);
  new ResizeObserver(() => placeDots(false)).observe(dots);
  if (!calm) {
    new IntersectionObserver(
      (entries, obs) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        obs.disconnect();
        setTimeout(() => {
          grouped = true;
          placeDots(true);
        }, 250);
      },
      { threshold: 0.4 },
    ).observe(dots);
  }
  $("dots-replay").addEventListener("click", groupDots);
  if (calm) document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in"));
  else {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          e.target.classList.add("in");
          io.unobserve(e.target);
        }
      },
      { threshold: 0.15 },
    );
    document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
  }

  // ---- Static views ----
  renderAgents(d);
  renderMethod(d, v);
  initRankSwitch(d);
  const industries = initIndustries($("view-industries"), d, () => state.idx);

  // ---- Month control ----
  const slider = $<HTMLInputElement>("month");
  const last = months.length - 1;
  slider.max = String(last);
  slider.addEventListener("input", () => {
    stopPlay();
    setMonth(+slider.value);
  });
  const prev = $<HTMLButtonElement>("m-prev");
  const next = $<HTMLButtonElement>("m-next");
  prev.addEventListener("click", () => {
    stopPlay();
    if (state.idx > 0) setMonth(state.idx - 1);
  });
  next.addEventListener("click", () => {
    stopPlay();
    if (state.idx < last) setMonth(state.idx + 1);
  });
  // Play: step through every month in about four seconds, then rest on the latest.
  const playBtn = $<HTMLButtonElement>("play");
  let playTimer = 0;
  function stopPlay() {
    if (!playing) return;
    playing = false;
    clearInterval(playTimer);
    playBtn.querySelector("span")!.textContent = "Play";
    playBtn.setAttribute("aria-label", "Play every month");
  }
  playBtn.addEventListener("click", () => {
    if (playing) {
      stopPlay();
      setMonth(last);
      return;
    }
    playing = true;
    playBtn.querySelector("span")!.textContent = "Stop";
    playBtn.setAttribute("aria-label", "Stop and show the latest month");
    let k = 0;
    setMonth(0);
    playTimer = window.setInterval(() => {
      k += 1;
      setMonth(k);
      if (k >= last) stopPlay();
    }, 4000 / Math.max(1, last));
  });
  // One tick per month under the track; January ticks are taller and carry the year.
  $("month-ticks").innerHTML = months
    .map((m) => {
      const jan = m.endsWith("-01");
      return `<span class="tick${jan ? " jan" : ""}">${jan ? `<i>${m.slice(0, 4)}</i>` : ""}</span>`;
    })
    .join("");
  // A short pulse on the handle the first time the page opens, so it reads as draggable.
  // Stops at the first touch of the control; CSS skips it under reduced motion.
  const ctl = $("month-ctl");
  ctl.classList.add("hint");
  const stopHint = () => ctl.classList.remove("hint");
  ctl.addEventListener("pointerdown", stopHint, { once: true });
  ctl.addEventListener("keydown", stopHint, { once: true });
  setTimeout(stopHint, 4200);

  function setMonth(k: number) {
    state.idx = k;
    const m = months[k];
    slider.value = String(k);
    slider.setAttribute("aria-valuetext", monthLong(m));
    slider.style.setProperty("--f", String(last ? k / last : 0));
    prev.disabled = k === 0;
    next.disabled = k === last;
    $("month-label").textContent = monthLong(m);
    document.querySelectorAll("[data-month]").forEach((el) => (el.textContent = monthLong(m)));

    const f3 = $("f403");
    const f2 = $("f402");
    f3.style.background = red(a403[k]);
    f3.style.color = "#111111";
    f2.style.background = blue(a402[k]);
    f2.style.color = t2(a402[k]) > 0.5 ? "#FFFFFF" : "#111111";
    $("ed-latest").hidden = k !== months.length - 1;
    $("d403").textContent = compareLine(months, a403, k);
    $("d402").textContent = compareLine(months, a402, k, { peakFirst: true });
    countTo($("n403"), a403[k]);
    countTo($("n402"), a402[k]);
    cells403.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === k)));
    cells402.querySelectorAll("button").forEach((b, i) => b.setAttribute("aria-pressed", String(i === k)));

    const n3 = Math.round(a403[k] * 10);
    const n2 = Math.round(a402[k] * 10);
    $("c403").textContent = String(n3);
    $("c402").textContent = n2 === 0 && a402[k] > 0 ? "<1" : String(n2);
    $("cRest").textContent = String(1000 - n3 - n2);
    paintDots(n3, n2);
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
    const text = `WhatsThe402, The 402 Index, ${monthLong(m)}. Data from Cloudflare Radar (CC BY-NC 4.0). Accessed ${dateLabel(new Date().toISOString().slice(0, 10))}. ${url.toString()}`;
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

  // Phones: the header (brand, tabs, month) takes a big share of a small screen, so it
  // slides away while scrolling down and comes back on any scroll up.
  const top = document.querySelector<HTMLElement>(".top")!;
  const phone = window.matchMedia("(max-width: 640px)");
  let lastY = window.scrollY;
  window.addEventListener(
    "scroll",
    () => {
      const y = window.scrollY;
      const tuck = phone.matches && y > top.offsetHeight && y > lastY + 4 && !top.contains(document.activeElement);
      if (tuck) top.classList.add("tucked");
      else if (y < lastY - 4 || y <= top.offsetHeight) top.classList.remove("tucked");
      lastY = y;
    },
    { passive: true },
  );
  top.addEventListener("focusin", () => top.classList.remove("tucked"));

  fromHash();
  setMonth(state.idx);
}

function renderAgents(d: Dataset) {
  const top = [...d.bots].filter((b) => b.shareOfAgent402 != null).sort((a, b) => b.shareOfAgent402! - a.shareOfAgent402!)[0];
  const rows = d.bots
    .map(
      (b) => `<div class="atr">
        <span style="font-weight:500">${esc(b.name)}</span>
        <span class="num" data-label="Share of agent traffic">${pct(b.trafficShare)}</span>
        <span class="num" data-label="403 rate" style="color:var(--red);font-weight:600">${pct(b.rates?.["403"])}</span>
        <span class="num" data-label="402 rate" style="color:var(--blue);font-weight:600">${pct(b.rates?.["402"])}</span>
        <span class="num" data-label="Share of all agent 402s">${pct(b.shareOfAgent402)}</span>
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
    <h1>How we measure</h1>
    <p class="sub">The 402 Index is one fixed series, rebuilt from the Cloudflare Radar API every day and checked figure by figure. A month joins the index once it is complete.</p>
    <dl class="defs">
      <dt>AI bots</dt><dd>Any automated visitor run by an AI company. Cloudflare sorts them by what they are for: training, search, user action (agents), mixed purpose or undeclared.</dd>
      <dt>Crawlers</dt><dd>Bots that collect pages in bulk with no person waiting, mostly to train models (training crawlers) or build search indexes.</dd>
      <dt>Agents</dt><dd>Bots that fetch a page because a person asked, such as ChatGPT-User and Claude-User. Cloudflare calls this crawl purpose User Action. Every headline figure on this site is about agents.</dd>
      <dt>Estimates</dt><dd>Every figure is a share of the requests Cloudflare sees on websites that use it, as reported by Cloudflare Radar. It is not a count, and it does not cover websites that don't use Cloudflare.</dd>
      <dt>403 rate</dt><dd>Of the agent requests in a month or industry, the share answered with 403 Forbidden.</dd>
      <dt>402 rate</dt><dd>The same for 402 Payment Required.</dd>
      <dt>Out of 1,000</dt><dd>The month's 403 and 402 rates times 1,000, rounded. Fewer than one in 1,000 shows as &lt;1.</dd>
      <dt>Industries</dt><dd>Cloudflare assigns sites to industries by the business that owns them. Radar's industry figures cover only sites that have an industry${sites?.["403"] != null ? `: across those sites, ${pct(sites["403"])} of agent requests got a 403 this year, against ${pct(d.overall.agents["403"])} across all agent traffic` : ""}. Most labels match LinkedIn's industry list; the info icon says what each covers.</dd>
      <dt>Traffic share</dt><dd>An industry's share of agent requests to sites that have an industry.</dd>
      <dt>Small industries</dt><dd>Industries with under ${m.lowVolumeThresholdPct}% of agent traffic are hidden by default. A few sites can swing their rates.</dd>
      <dt>Updates</dt><dd>Pulled daily from the Cloudflare Radar API. A month appears once it is complete. Last updated ${dateLabel(m.updated)}.</dd>
    </dl>
    ${checks}
    <h2>Events that can move the series</h2>
    <ul class="facts-list">${EVENTS.map((e) => `<li><b>${esc(e.date)}.</b> ${esc(e.text)} <a href="${e.url}" rel="noopener">Source</a></li>`).join("")}</ul>
    ${REVIEW.length ? `<h2>Under review</h2><ul class="facts-list">${REVIEW.map((r) => `<li>${esc(r.text)}</li>`).join("")}</ul>` : ""}
    <h2>What this data can't tell you</h2>
    <ul class="facts-list">${CAVEATS.map(([k, t]) => `<li><b>${esc(k)}.</b> ${esc(t)}</li>`).join("")}</ul>
    <h2>Licence</h2>
    <p class="sub">Cloudflare publishes Radar data under <a href="https://creativecommons.org/licenses/by-nc/4.0/" rel="noopener">CC BY-NC 4.0</a>. Our figures are derived from it and carry the same licence. Please credit Cloudflare Radar and WhatsThe402.</p>
    <h2>Sources</h2>
    <ul class="facts-list">${m.sources.map((s) => `<li>${esc(s)}</li>`).join("")}</ul>
    ${m.radarNotes.length ? `<h2>Cloudflare's notes on this period</h2><ul class="facts-list">${m.radarNotes.map((n) => `<li>${esc(n.description)}${n.start ? ` (${dateLabel(n.start)}${n.end && n.end !== n.start ? ` to ${dateLabel(n.end)}` : ""})` : ""}</li>`).join("")}</ul>` : ""}
    <h2>Known gaps</h2>
    <ul class="facts-list">${gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
  </div>`;
}

load()
  .then(({ d, v }) => {
    main(d, v);
    // The build puts a plain-HTML summary in the page for crawlers and agents that
    // don't run JavaScript; once the app has rendered it is no longer needed.
    document.getElementById("static-summary")?.remove();
  })
  .catch((err) => {
    // Show the static summary instead of an empty page.
    document.documentElement.classList.remove("js");
    const el = $("load-error");
    el.textContent = `The data file could not be loaded (${(err as Error).message}). Reload the page to try again.`;
    el.hidden = false;
  });
