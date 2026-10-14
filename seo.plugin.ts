// Build-time discoverability for search engines and AI agents. Reads the current
// public/data/index.json and writes, so everything matches the data being shipped:
//   - <head> metadata: description, canonical, Open Graph, Twitter, JSON-LD (Dataset)
//   - a plain-HTML summary inside <main> for clients that don't run JavaScript
//   - llms.txt, sitemap.xml, feed.xml (one entry per monthly edition) and a CSV
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

export const SITE = "https://akashmverma.github.io/WhatsThe402/";
const ORG = { "@type": "Organization", name: "4Mica", url: "https://4mica.io" };
const RADAR = "https://radar.cloudflare.com/ai-insights";
const LICENSE = "https://creativecommons.org/licenses/by-nc/4.0/";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

type Rates = Record<string, number>;
interface Data {
  meta: { updated: string; windows: { ytd: { label: string }; monthly: { start: string; end: string } } };
  overall: { agents: Rates; trainers: Rates; industrySites?: Rates };
  monthly: { month: string; agents: Rates; allBots: Rates }[];
  industries: { name: string; lowVolume: boolean; agentTrafficShare: number | null; agents: Rates; shareOfAgent403: number; shareOfAgent402: number; label: { desc: string } | null }[];
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const pct = (v: number | null | undefined) => (v == null ? "n/a" : v === 0 ? "0%" : v < 0.01 ? "<0.01%" : v < 1 ? `${v.toFixed(2)}%` : `${v.toFixed(1)}%`);
const monthLong = (ym: string) => `${MONTHS[+ym.slice(5) - 1]} ${ym.slice(0, 4)}`;

function load(): Data {
  return JSON.parse(readFileSync(new URL("./public/data/index.json", import.meta.url), "utf8"));
}

const DESCRIPTION =
  "The 402 Index: a monthly measure of how often websites refuse AI agents (HTTP 403 Forbidden) or ask them to pay (HTTP 402 Payment Required), overall and by industry, built from Cloudflare Radar data with the method and every caveat shown.";

function head(d: Data): string {
  const last = d.monthly[d.monthly.length - 1];
  const lead = `${monthLong(last.month)}: ${pct(last.agents["403"])} of AI agent requests were refused (403) and ${pct(last.agents["402"])} were asked to pay (402).`;
  const dataset = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${SITE}#site`, url: SITE, name: "WhatsThe402", description: DESCRIPTION, publisher: ORG, inLanguage: "en" },
      {
        "@type": "Dataset",
        "@id": `${SITE}#dataset`,
        name: "The 402 Index: how websites answer AI agents",
        alternateName: "WhatsThe402",
        description: `${DESCRIPTION} ${lead} Agents are bots Cloudflare classifies as acting for a person (crawl purpose "User Action"). Values are shares of requests, not counts. Industry figures cover sites Cloudflare has assigned an industry.`,
        url: SITE,
        keywords: ["HTTP 402", "Payment Required", "HTTP 403", "AI agents", "AI crawlers", "pay per crawl", "x402", "agent payments", "Cloudflare Radar", "bot blocking", "industry"],
        creator: ORG,
        publisher: ORG,
        isBasedOn: { "@type": "Dataset", name: "Cloudflare Radar AI Insights", url: RADAR, license: LICENSE },
        license: LICENSE,
        isAccessibleForFree: true,
        dateModified: d.meta.updated,
        temporalCoverage: `${d.meta.windows.monthly.start}/${d.meta.windows.monthly.end}`,
        spatialCoverage: "Worldwide, websites on Cloudflare's network",
        measurementTechnique: "Cloudflare Radar API, /radar/ai/bots/summary, response status shares filtered by crawl purpose and industry",
        variableMeasured: [
          { "@type": "PropertyValue", name: "Agent 403 rate", description: "Share of AI agent requests answered 403 Forbidden", unitText: "percent" },
          { "@type": "PropertyValue", name: "Agent 402 rate", description: "Share of AI agent requests answered 402 Payment Required", unitText: "percent" },
          { "@type": "PropertyValue", name: "Agent traffic share", description: "An industry's share of AI agent requests to sites with an industry", unitText: "percent" },
        ],
        distribution: [
          { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}data/index.json` },
          { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}data/whatsthe402-monthly.csv` },
        ],
      },
    ],
  };
  const title = "WhatsThe402 | The 402 Index of how websites refuse or charge AI agents";
  return [
    `<meta name="description" content="${esc(DESCRIPTION)}" />`,
    `<link rel="canonical" href="${SITE}" />`,
    `<meta name="robots" content="index, follow, max-image-preview:large" />`,
    `<meta name="author" content="4Mica" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="WhatsThe402" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(lead)} ${esc("Monthly, by industry, from Cloudflare Radar data.")}" />`,
    `<meta property="og:url" content="${SITE}" />`,
    `<meta property="og:image" content="${SITE}og.png" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="WhatsThe402: the monthly index of 403 refusals and 402 payment requests to AI agents" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(lead)}" />`,
    `<meta name="twitter:image" content="${SITE}og.png" />`,
    `<meta property="article:modified_time" content="${d.meta.updated}" />`,
    `<link rel="alternate" type="application/json" title="The 402 Index dataset (JSON)" href="data/index.json" />`,
    `<link rel="alternate" type="text/csv" title="The 402 Index monthly series (CSV)" href="data/whatsthe402-monthly.csv" />`,
    `<link rel="alternate" type="application/atom+xml" title="The 402 Index, monthly editions" href="feed.xml" />`,
    `<link rel="alternate" type="text/plain" title="Summary for language models" href="llms.txt" />`,
    `<link rel="sitemap" type="application/xml" href="sitemap.xml" />`,
    `<script type="application/ld+json">${JSON.stringify(dataset).replace(/</g, "\\u003c")}</script>`,
  ].join("\n    ");
}

function topIndustries(d: Data) {
  return d.industries.filter((i) => !i.lowVolume && i.agentTrafficShare != null).sort((a, b) => b.agentTrafficShare! - a.agentTrafficShare!).slice(0, 30);
}

function summary(d: Data): string {
  const last = d.monthly[d.monthly.length - 1];
  const sites = d.overall.industrySites;
  const rows = [...d.monthly].reverse().map((m) => `<tr><td>${monthLong(m.month)}</td><td>${pct(m.agents["403"])}</td><td>${pct(m.agents["402"])}</td></tr>`).join("");
  const inds = topIndustries(d)
    .map((i) => `<tr><td>${esc(i.name)}</td><td>${pct(i.agentTrafficShare)}</td><td>${pct(i.agents["403"])}</td><td>${pct(i.agents["402"])}</td></tr>`)
    .join("");
  return `<section id="static-summary">
        <h1>The 402 Index: how websites answer AI agents</h1>
        <p>${esc(DESCRIPTION)} Published by <a href="https://4mica.io">4Mica</a>. Updated ${d.meta.updated}.</p>
        <h2>${monthLong(last.month)}</h2>
        <ul>
          <li>${pct(last.agents["403"])} of AI agent requests were refused (HTTP 403).</li>
          <li>${pct(last.agents["402"])} were asked to pay (HTTP 402).</li>
        </ul>
        <h2>Monthly series, AI agents</h2>
        <table><thead><tr><th>Month</th><th>403 rate</th><th>402 rate</th></tr></thead><tbody>${rows}</tbody></table>
        <h2>Industries, ${esc(d.meta.windows.ytd.label)}</h2>
        <p>The 30 industries with the most agent traffic. ${sites ? `Across all sites with an industry, ${pct(sites["403"])} of agent requests were refused and ${pct(sites["402"])} asked to pay.` : ""}</p>
        <table><thead><tr><th>Industry</th><th>Share of agent traffic</th><th>403 rate</th><th>402 rate</th></tr></thead><tbody>${inds}</tbody></table>
        <h2>Method</h2>
        <p>Agents are bots Cloudflare classifies as acting for a person (crawl purpose "User Action"), such as ChatGPT-User and Claude-User. Every figure is a share of requests, not a count, and covers websites on Cloudflare's network. A 402 is a request to pay, not proof of payment. Data from <a href="${RADAR}">Cloudflare Radar</a>, licensed <a href="${LICENSE}">CC BY-NC 4.0</a>.</p>
        <p>Data: <a href="data/index.json">JSON</a>, <a href="data/whatsthe402-monthly.csv">CSV</a>, <a href="data/verification.json">verification results</a>, <a href="llms.txt">llms.txt</a>, <a href="feed.xml">monthly feed</a>.</p>
      </section>`;
}

function llms(d: Data): string {
  const last = d.monthly[d.monthly.length - 1];
  const sites = d.overall.industrySites;
  const inds = topIndustries(d)
    .slice(0, 15)
    .map((i) => `- ${i.name}: ${pct(i.agentTrafficShare)} of agent traffic, ${pct(i.agents["403"])} refused, ${pct(i.agents["402"])} asked to pay`)
    .join("\n");
  return `# WhatsThe402

> ${DESCRIPTION} Published by 4Mica (https://4mica.io).

Latest month, ${monthLong(last.month)}: ${pct(last.agents["403"])} of AI agent requests were refused (HTTP 403) and ${pct(last.agents["402"])} were asked to pay (HTTP 402). Year to date (${d.meta.windows.ytd.label}): ${pct(d.overall.agents["403"])} refused and ${pct(d.overall.agents["402"])} asked to pay, against ${pct(d.overall.trainers["403"])} of AI training-crawler requests refused. Updated ${d.meta.updated}.

## Data
- [Full dataset, JSON](${SITE}data/index.json): monthly series, industries, agents, definitions
- [Monthly series, CSV](${SITE}data/whatsthe402-monthly.csv)
- [Verification results, JSON](${SITE}data/verification.json): every published figure recomputed from the raw Radar responses
- [Monthly editions, Atom feed](${SITE}feed.xml)

## Definitions
- Agent: a bot Cloudflare classifies as acting for a person (crawl purpose "User Action"), such as ChatGPT-User or Claude-User.
- 403 rate: share of agent requests answered 403 Forbidden (refused).
- 402 rate: share of agent requests answered 402 Payment Required (asked to pay). A 402 is not proof that anyone paid.
- Industry figures cover only sites Cloudflare has assigned an industry${sites ? `; across those sites ${pct(sites["403"])} of agent requests were refused and ${pct(sites["402"])} asked to pay, year to date` : ""}.

## Industries with the most agent traffic, year to date
${inds}

## Caveats
- Shares of requests, not counts. Only websites on Cloudflare's network.
- Cloudflare's default settings and data revisions can move the series; August 2026 is under review.

## Licence
Derived from Cloudflare Radar data (${RADAR}), licensed CC BY-NC 4.0 (${LICENSE}). Credit Cloudflare Radar and WhatsThe402.
`;
}

function feed(d: Data): string {
  const entries = [...d.monthly]
    .reverse()
    .map((m) => {
      const title = `The 402 Index, ${monthLong(m.month)}: ${pct(m.agents["403"])} refused, ${pct(m.agents["402"])} asked to pay`;
      const url = `${SITE}?m=${m.month}`;
      return `  <entry>
    <title>${esc(title)}</title>
    <id>${esc(url)}</id>
    <link href="${esc(url)}" />
    <updated>${d.meta.updated}T00:00:00Z</updated>
    <summary>${esc(`In ${monthLong(m.month)}, ${pct(m.agents["403"])} of AI agent requests were refused (HTTP 403) and ${pct(m.agents["402"])} were asked to pay (HTTP 402). Data from Cloudflare Radar.`)}</summary>
  </entry>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>The 402 Index by WhatsThe402</title>
  <subtitle>${esc(DESCRIPTION)}</subtitle>
  <id>${SITE}</id>
  <link href="${SITE}" />
  <link rel="self" href="${SITE}feed.xml" />
  <updated>${d.meta.updated}T00:00:00Z</updated>
  <author><name>4Mica</name><uri>https://4mica.io</uri></author>
${entries}
</feed>
`;
}

function csv(d: Data): string {
  const rows = [["month", "agents_403_pct", "agents_402_pct", "all_ai_bots_403_pct", "all_ai_bots_402_pct"]];
  d.monthly.forEach((m) => rows.push([m.month, String(m.agents["403"]), String(m.agents["402"]), String(m.allBots["403"]), String(m.allBots["402"])]));
  return rows.map((r) => r.join(",")).join("\n") + "\n";
}

function sitemap(d: Data): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}</loc><lastmod>${d.meta.updated}</lastmod><changefreq>daily</changefreq></url>
  <url><loc>${SITE}llms.txt</loc><lastmod>${d.meta.updated}</lastmod></url>
  <url><loc>${SITE}data/index.json</loc><lastmod>${d.meta.updated}</lastmod></url>
  <url><loc>${SITE}data/whatsthe402-monthly.csv</loc><lastmod>${d.meta.updated}</lastmod></url>
</urlset>
`;
}

export function seo(): Plugin {
  return {
    name: "whatsthe402-seo",
    transformIndexHtml(html) {
      const d = load();
      return html.replace("<!--seo-head-->", head(d)).replace("<!--static-summary-->", summary(d));
    },
    generateBundle() {
      const d = load();
      const emit = (fileName: string, source: string) => this.emitFile({ type: "asset", fileName, source });
      emit("llms.txt", llms(d));
      emit("feed.xml", feed(d));
      emit("sitemap.xml", sitemap(d));
      emit("data/whatsthe402-monthly.csv", csv(d));
    },
  };
}
