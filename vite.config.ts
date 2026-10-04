import { defineConfig, type Plugin } from "vite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pkg from "./package.json" with { type: "json" };
import { cloudflare } from "@cloudflare/vite-plugin";

function htmlInclude(): Plugin {
  return {
    name: "html-include",
    transformIndexHtml: {
      order: "pre",
      handler: (html) => html.replace(/<!--@include\s+(.+?)\s*-->/g, (_, p) => readFileSync(resolve(process.cwd(), p), "utf-8"))
    },
    // 部分ファイルを編集したときに自動で再読み込み
    handleHotUpdate({ file, server }) {
      if (file.endsWith(".html") && file.includes("/screens/")) server.ws.send({ type: "full-reload" });
    }
  };
}

export default defineConfig({ base: "./", build: { outDir: "dist", emptyOutDir: true }, define: { __APP_VERSION__: JSON.stringify(pkg.version) }, plugins: [htmlInclude(), cloudflare()] });
