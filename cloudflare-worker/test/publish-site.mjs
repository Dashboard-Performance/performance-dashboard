import fs from "fs";
const s = fs.readFileSync(new URL("../worker.js", import.meta.url), "utf8");
const pick = (a, b) => s.slice(s.indexOf(a), s.indexOf(b, s.indexOf(a)));
const code = [pick("const SITE_SKIP_PREFIXES", "\n", ), pick("function ghHeaders", "function ghBranch"), "function ghBranch(env) { return env.GITHUB_BRANCH || 'main'; }\n", pick("function bytesToB64", "\n}\n") + "\n}\n",
  pick("async function inflateRaw", "async function unzipEntries"), pick("async function unzipEntries", "async function ghApi"), pick("async function ghApi", "async function publishSiteFromZip"), pick("async function publishSiteFromZip", "async function handleReleaseUpload")].join("\n");
const sha = async (t) => { const b = new TextEncoder().encode(t), h = new TextEncoder().encode("blob " + b.length + "\0"), a = new Uint8Array(h.length + b.length); a.set(h); a.set(b, h.length); return Buffer.from(await crypto.subtle.digest("SHA-1", a)).toString("hex"); };
const existing = { "index.html": await sha("<html>same</html>"), "js/app.js": await sha("console.log(1)"), ".vercelignore": await sha("releases/\nbackend/\ncloudflare-worker/\n*.zip\n") };
let calls = [], fails = 2;
globalThis.fetch = async (url, o) => { const path = url.replace(/^.*\/repos\/[^/]+\/[^/]+/, ""); calls.push((o.method || "GET") + " " + path.split("?")[0]);
  const J = (x, st = 200) => new Response(JSON.stringify(x), { status: st });
  if (path.startsWith("/git/ref/")) return J({ object: { sha: "p1" } });
  if (path.startsWith("/git/commits/") && o.method === "GET") return J({ tree: { sha: "t1" } });
  if (path.startsWith("/git/trees/t1")) return J({ tree: Object.keys(existing).map((p) => ({ path: p, type: "blob", sha: existing[p] })) });
  if (path === "/git/blobs") { if (fails-- > 0) return new Response("oops", { status: 500 }); return J({ sha: "b" + calls.length }); }
  if (path === "/git/trees") return J({ sha: "t2" });
  if (path === "/git/commits") return J({ sha: "c2abcdef" });
  if (path.startsWith("/git/refs/")) return J({});
  return J({}, 404); };
const env = { GITHUB_REPO: "o/r", GITHUB_TOKEN: "x" };
const fn = new Function("env", "bytes", code + "\nreturn publishSiteFromZip(env, bytes, '1.18.0');");
const out = await fn(env, new Uint8Array(fs.readFileSync(new URL("./site-sample.zip", import.meta.url))));
console.log(JSON.stringify(out), calls.filter((c) => c.includes("blobs")).length, "blob calls");
if (out.changed !== 1 || calls.filter((c) => c === "POST /git/blobs").length !== 3) { console.error("FAIL"); process.exit(1); }
console.log("ok");
