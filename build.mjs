// Bundles App.source.jsx (with React) and writes it into the inline <script> of index.html,
// so the page stays a single self-contained file. Run with `npm run build`.
import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const result = await build({
  entryPoints: ["App.source.jsx"],
  bundle: true,
  minify: true,
  format: "iife",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  write: false,
});
const js = result.outputFiles[0].text.replace(/\n$/, "");
if (js.includes("</script")) throw new Error("Bundle contains </script — can't inline it safely.");

const html = readFileSync("index.html", "utf8");
const open = html.match(/<script>\r?\n/);
const close = html.lastIndexOf("</script>");
if (!open || close < open.index) throw new Error("Couldn't find the inline <script> block in index.html.");
const start = open.index + open[0].length;
const nl = html.slice(start, close).match(/\r?\n$/)?.[0] ?? "\n";
writeFileSync("index.html", html.slice(0, start) + js + nl + html.slice(close));
console.log(`index.html updated (${(js.length / 1024).toFixed(0)} KB bundle)`);
