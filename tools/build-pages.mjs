// Builds the page files from index.html — run after every change to index.html:
//     node tools/build-pages.mjs
// Each tab has its own file name (inventory.html, target-acm.html, …) so a reload opens the same tab.
// Those files are full copies of index.html with the tab preselected. Older file names only redirect.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url"; // Windows-safe (C:\ paths, spaces)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tower = fs.readFileSync(path.join(root, "js/tower.js"), "utf8");
const grab = (name) => { const i = tower.indexOf("var " + name + " = {"); const j = tower.indexOf("};", i); return Function("return (" + tower.slice(i + ("var " + name + " = ").length, j + 1) + ")")(); };
const VIEW_NAV = grab("VIEW_NAV"), VIEW_SLUG = grab("VIEW_SLUG");
const kebab = (v) => v.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
if (index.includes("__ENTRY_VIEW")) throw new Error("index.html must not contain __ENTRY_VIEW");
let pages = 0, stubs = 0;
const canonical = {};
for (const view of Object.keys(VIEW_NAV)) {
  if (view === "overview") continue;
  const file = (VIEW_SLUG[view] || kebab(view)) + ".html";
  canonical[view] = file;
  fs.writeFileSync(path.join(root, file), index.replace("<head>", "<head>\n<script>window.__ENTRY_VIEW=" + JSON.stringify(view) + ";</script>"));
  pages++;
}
for (const view of Object.keys(canonical)) {
  const legacy = kebab(view) + ".html", to = canonical[view];
  if (legacy === to) continue;
  fs.writeFileSync(path.join(root, legacy), `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Opening…</title>
<meta http-equiv="refresh" content="0; url=${to}">
<script>location.replace(${JSON.stringify(to)} + location.search + location.hash);</script>
</head><body><a href="${to}">Open the dashboard</a></body></html>
`);
  stubs++;
}
console.log("built " + pages + " tab pages + " + stubs + " redirects from index.html");
