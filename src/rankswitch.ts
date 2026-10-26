// "Where do agents go, and how are they answered?": the 10 industries with the
// most agent traffic, re-rankable by agent traffic, 403 rate or 402 rate. Rows
// slide into the new order only when the reader switches the ranking.
import { esc, pct } from "./format";
import type { Dataset, Industry } from "./types";

type Mode = "traffic" | "403" | "402";
const RH = 44;

export function rankSwitchHtml(): string {
  return `<section class="rank reveal">
      <div class="rank-head">
        <div>
          <p class="q-label">Where do agents go, and how are they answered?</p>
          <p class="rank-sub" id="rank-sub"></p>
        </div>
        <div class="rankby">
          <span>Rank by</span>
          <div class="seg" role="group" aria-label="Rank industries by">
            <button type="button" data-mode="traffic" aria-pressed="true">Agent traffic</button>
            <button type="button" data-mode="403" aria-pressed="false">403 rate</button>
            <button type="button" data-mode="402" aria-pressed="false">402 rate</button>
          </div>
        </div>
      </div>
      <div class="rank-table">
        <div class="rank-cols"><span>#</span><span>Industry</span><span></span><span>Share of agent traffic</span><span>403 rate<i>said no</i></span><span>402 rate<i>asked to pay</i></span></div>
        <div class="rank-rows" id="rank-rows"></div>
      </div>
    </section>`;
}

export function initRankSwitch(d: Dataset) {
  const host = document.getElementById("rank-rows");
  if (!host) return;
  const inds = d.industries
    .filter((i) => !i.lowVolume && i.agentTrafficShare != null)
    .sort((a, b) => b.agentTrafficShare! - a.agentTrafficShare!)
    .slice(0, 10);
  const sites = d.overall.industrySites;
  const ytd = d.meta.windows.ytd.label;
  const maxShare = Math.max(...inds.map((i) => i.agentTrafficShare!));
  // 402 bars use a rounded scale so small rates stay visible.
  const max402 = [1, 2, 5, 10, 20, 50, 100].find((s) => s >= Math.max(...inds.map((i) => i.agents["402"]))) ?? 100;
  const modes: Record<Mode, { val: (i: Industry) => number; cls: string; width: (i: Industry) => number; color: string; sub: string }> = {
    traffic: {
      val: (i) => i.agentTrafficShare!,
      cls: "vs",
      width: (i) => (i.agentTrafficShare! / maxShare) * 100,
      color: "#9a9a9a",
      sub: `The 10 industries with the most agent traffic: each one's share of all AI agent requests to sites with a known industry, ${ytd}.`,
    },
    "403": {
      val: (i) => i.agents["403"],
      cls: "vr",
      width: (i) => i.agents["403"],
      color: "var(--red)",
      sub: `The same 10, ranked by 403 rate: the share of each industry's agent requests the website refused. Bars run 0 to 100%.${sites?.["403"] != null ? ` Across all sites with a known industry: ${pct(sites["403"])}.` : ""}`,
    },
    "402": {
      val: (i) => i.agents["402"],
      cls: "vp",
      width: (i) => (i.agents["402"] / max402) * 100,
      color: "var(--blue)",
      sub: `The same 10, ranked by 402 rate: the share of each industry's agent requests the website asked to be paid for. Bars run 0 to ${max402}%.${sites?.["402"] != null ? ` Across all sites with a known industry: ${pct(sites["402"])}.` : ""}`,
    },
  };

  host.style.height = `${inds.length * RH}px`;
  host.innerHTML = inds
    .map(
      (i) => `<div class="rank-row"><span class="rk"></span><span class="nm">${esc(i.name)}</span><span class="rbar"><span></span></span><span class="v vs">${pct(i.agentTrafficShare)}</span><span class="v vr">${pct(i.agents["403"])}</span><span class="v vp">${pct(i.agents["402"])}</span></div>`,
    )
    .join("");
  const rows = [...host.children] as HTMLElement[];
  const buttons = document.querySelectorAll<HTMLButtonElement>(".rank .seg button");

  function rank(mode: Mode) {
    const m = modes[mode];
    const order = [...inds].sort((a, b) => m.val(b) - m.val(a));
    rows.forEach((r, j) => {
      const k = order.indexOf(inds[j]);
      r.style.transform = `translateY(${k * RH}px)`;
      r.querySelector(".rk")!.textContent = String(k + 1);
      const bar = r.querySelector<HTMLElement>(".rbar span")!;
      bar.style.width = `${m.width(inds[j]).toFixed(1)}%`;
      bar.style.background = m.color;
      r.querySelectorAll(".v").forEach((v) => v.classList.toggle("on", v.classList.contains(m.cls)));
    });
    buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.mode === mode)));
    document.getElementById("rank-sub")!.textContent = m.sub;
  }
  buttons.forEach((b) => b.addEventListener("click", () => rank(b.dataset.mode as Mode)));
  rank("traffic");
}
