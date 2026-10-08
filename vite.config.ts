import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` -> dist/ for Cloudflare Pages (data/index.json served alongside).
// `npm run build:preview` -> one inlined HTML file for quick shareable previews.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: mode === "singlefile" ? [viteSingleFile()] : [],
  build: { target: "es2020" },
}));
