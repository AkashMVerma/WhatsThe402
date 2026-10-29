// Scroll-through months for the 403 and 402 sections.
//
// Each section sits in a taller wrapper and stays pinned below the header while
// the reader scrolls through that extra length; the scroll position picks the
// month, January 2025 first and the latest month last. Outside the wrappers the
// page shows the latest month, so a glance at the top is unchanged.
//
// Ways out: "Skip" jumps past both sections; "Turn off" collapses them for this
// reader from then on (a link next to Play turns it back on); picking a month by
// hand (slider, arrows, month squares) also hands control back for the visit.
// Never on when the reader prefers reduced motion.

const KEY = "wt402-scroll-months";

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (v: string) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* storage can be unavailable; the setting then lasts for this visit only */
  }
};

export interface ScrubHost {
  last: number;
  getIdx: () => number;
  setMonth: (k: number) => void;
  isPlaying: () => boolean;
}

export function initScrub(host: ScrubHost, opts: { startManual: boolean }) {
  const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const scenes = [...document.querySelectorAll<HTMLElement>("[data-scrub]")];
  const header = document.querySelector<HTMLElement>(".top")!;
  const phone = window.matchMedia("(max-width: 640px)");
  const onLinks = [...document.querySelectorAll<HTMLButtonElement>("[data-scrub-on]")];
  if (!scenes.length) return { handOver() {}, relayout() {} };

  let enabled = !calm && read() !== "off" && !opts.startManual;
  let active: HTMLElement | null = null;
  let skipping = false;

  const field = (sc: HTMLElement) => sc.firstElementChild as HTMLElement;
  const bar = (sc: HTMLElement) => sc.querySelector<HTMLElement>(".scrub-bar")!;
  // On phones the header slides away while scrolling down, so pin to the very top.
  const stickTop = () => (phone.matches ? 0 : header.offsetHeight);
  const extra = () => Math.round(window.innerHeight * 0.9);
  const visible = () => scenes[0].offsetParent !== null;

  function layout() {
    document.documentElement.style.setProperty("--stick-top", `${stickTop()}px`);
    for (const sc of scenes) {
      sc.classList.toggle("on", enabled);
      sc.style.height = enabled ? `${field(sc).offsetHeight + extra()}px` : "";
      if (!enabled) bar(sc).hidden = true;
    }
    onLinks.forEach((b) => (b.hidden = enabled || calm));
  }

  // Change the layout without the page jumping under the reader.
  function relayout() {
    const anchor = field(active ?? scenes[0]);
    const before = anchor.getBoundingClientRect().top;
    layout();
    const after = anchor.getBoundingClientRect().top;
    if (visible()) window.scrollBy(0, after - before);
  }

  const progress = (sc: HTMLElement) => {
    const span = sc.offsetHeight - field(sc).offsetHeight;
    return span > 0 ? (stickTop() - sc.getBoundingClientRect().top) / span : -1;
  };

  function onScroll() {
    if (!enabled || skipping || !visible()) return;
    let now: HTMLElement | null = null;
    let p = 0;
    for (const sc of scenes) {
      const q = progress(sc);
      if (q >= 0 && q < 1) {
        now = sc;
        p = q;
        break;
      }
    }
    if (now !== active) {
      scenes.forEach((sc) => (bar(sc).hidden = sc !== now));
      // Leaving the sections either way returns the page to the latest month.
      if (!now && host.getIdx() !== host.last) host.setMonth(host.last);
      active = now;
    }
    if (now && !host.isPlaying()) {
      const k = Math.min(host.last, Math.floor(p * (host.last + 1)));
      if (k !== host.getIdx()) host.setMonth(k);
    }
  }

  function disable(remember: boolean) {
    if (!enabled) return;
    if (remember) write("off");
    enabled = false;
    relayout();
    active = null;
    if (host.getIdx() !== host.last && remember) host.setMonth(host.last);
  }

  scenes.forEach((sc) => {
    sc.querySelector<HTMLButtonElement>("[data-skip]")!.addEventListener("click", () => {
      // Skip past both sections, to where the second one comes unpinned. Months
      // don't run while skipping, and the landing spot is re-checked at the end.
      const target = () => {
        const end = scenes[scenes.length - 1];
        return end.getBoundingClientRect().top + window.scrollY + end.offsetHeight - field(end).offsetHeight - stickTop() + 2;
      };
      skipping = true;
      scenes.forEach((x) => (bar(x).hidden = true));
      host.setMonth(host.last);
      window.scrollTo({ top: target(), behavior: calm ? "auto" : "smooth" });
      let settle = 0;
      const done = () => {
        window.removeEventListener("scroll", wait);
        window.scrollTo({ top: target(), behavior: "auto" });
        skipping = false;
        active = null;
      };
      const wait = () => {
        clearTimeout(settle);
        settle = window.setTimeout(done, 160);
      };
      window.addEventListener("scroll", wait, { passive: true });
      settle = window.setTimeout(done, 900);
    });
    sc.querySelector<HTMLButtonElement>("[data-scrub-off]")!.addEventListener("click", () => disable(true));
  });
  onLinks.forEach((b) =>
    b.addEventListener("click", () => {
      write("on");
      enabled = true;
      relayout();
      onScroll();
    }),
  );

  layout();
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        onScroll();
      });
    },
    { passive: true },
  );
  let lastW = window.innerWidth;
  window.addEventListener("resize", () => {
    // Phone browsers resize the viewport as their toolbars show and hide; only
    // re-measure when the width changes.
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    relayout();
  });
  // Re-measure when the overview tab is shown again.
  window.addEventListener("hashchange", () => requestAnimationFrame(layout));

  return {
    /** The reader picked a month by hand: stop driving the month from scroll for this visit. */
    handOver() {
      disable(false);
    },
    relayout: layout,
  };
}
