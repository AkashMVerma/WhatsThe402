# Saved versions

Rollback points for the live site. Each row is the exact commit that was live at
that time. Data commits keep landing daily, so to roll back the site's code while
keeping the latest data, restore only the code paths from the saved commit:

```
git checkout <commit> -- index.html src seo.plugin.ts vite.config.ts public/favicon.svg public/favicon-32.png public/apple-touch-icon.png public/og.png
git commit -m "Roll back site code to <name>"
git push
```

| Name | Saved (UTC) | Commit | What it is |
|---|---|---|---|
| live-2026-10-26T1150Z | 2026-10-26 11:50 | f75ccd9 | The 402 Index overview with question labels, agent findings, month-on-month lines, favicon and SEO metadata; before the Play time-lapse, the grid sort and the industry ranking switch. |
| live-2026-10-26T1153Z | 2026-10-26 11:53 | 8ee8310 | Adds the Play time-lapse on the 403 section, the one-time 1,000-request grid sort and the industry ranking switch (agent traffic, 403 rate, 402 rate). |
| live-2026-10-26T1204Z | 2026-10-26 12:04 | 5454628 | Adds a Play button to the 402 section, sharing one playback with the 403 section. |
| live-2026-10-29T0731Z | 2026-10-29 07:31 | c87ebed | Fixes cramped links and cut-off industry names, and rewrites copy that read as machine-written. |
| live-2026-10-29T0741Z | 2026-10-29 07:41 | 349ff5a | Scrolling through the 403 and 402 sections moves through the months, with Skip, Turn off and hand-over by picking a month. |
