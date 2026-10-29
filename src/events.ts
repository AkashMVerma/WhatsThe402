// Dated platform changes that can move the series, and months we treat as under
// review. Shown on the Method page. Each event links to Cloudflare's own post.
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

export const REVIEW = [
  {
    month: "2026-08",
    text: 'Refusals jumped for every kind of AI bot in August 2026, and so did "page not found" answers. That looks more like a change on Cloudflare\'s side than thousands of site owners deciding at once, so we treat the month as under review.',
  },
];

export const CAVEATS = [
  ["Counts", "Every figure is a share of requests. A rising rate can mean more refusals or fewer requests overall."],
  ["The whole web", "Cloudflare Radar only sees websites that use Cloudflare."],
  ["Who counts as an agent", "Cloudflare decides which bots act for a person, and its list includes bots such as TikTokSpider."],
  ["Whether anyone paid", "A 402 is a request to pay. We can't see payments, and for an agent that can't pay, a 402 works like a refusal."],
  ["Why", "We see what websites answered, not their reasons. Cloudflare's default settings, changes in which agents are active, and revisions to Radar's data can all move the numbers."],
  ["Cloudflare's labels", "Which bots count as agents and which industry a website belongs to are Cloudflare's classifications. We can't check them site by site."],
  ["Revisions", "Radar can revise recent months. We rebuild the whole series every day, so a published figure can change."],
  ["Robots.txt", "Bots that follow robots.txt never ask for pages they're told to skip, so they don't show up as refused."],
];
