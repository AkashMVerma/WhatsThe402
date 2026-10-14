import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { seo } from "./seo.plugin";

// `npm run build` -> dist/ for GitHub Pages (data/index.json served alongside).
// seo() writes metadata, a no-JS summary, llms.txt, sitemap, feed and CSV from the data.
// `npm run build:preview` -> one inlined HTML file for quick shareable previews.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: mode === "singlefile" ? [seo(), viteSingleFile()] : [seo()],
  build: { target: "es2020" },
}));
