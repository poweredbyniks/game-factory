/**
 * Builds a single self-contained HTML page of one game's web build (JS inlined, fonts and sounds as
 * data URIs, no network access). Used to share playable builds as a link.
 * Usage: tsx tools/src/scripts/build-artifact.ts <gameId>   ->  build/artifacts/<gameId>.html
 */
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { GameBundle } from "@gf/schemas";
import { compileGame, writeCompiled } from "../compile";
import { readJson, rootPath, writeText } from "../paths";

const gameId = process.argv[2];
if (!gameId) throw new Error("usage: build-artifact.ts <gameId>");

const compiled = compileGame(gameId);
if (!compiled.bundle || !compiled.issues.ok) throw new Error(compiled.issues.format());
writeCompiled(compiled, { app: true, inlineAssets: true });

const out = rootPath("build", "artifact-web", gameId);
rmSync(out, { recursive: true, force: true });
try {
  execFileSync("npx", ["expo", "export", "--platform", "web", "--output-dir", out], { cwd: rootPath("engine", "app"), stdio: "inherit" });
} finally {
  writeCompiled(compiled, { app: true }); // restore the normal development registry
}

const html = readFileSync(join(out, "index.html"), "utf8");
const scriptSrc = html.match(/<script src="([^"]+)"/)?.[1];
if (!scriptSrc) throw new Error("no bundle script in index.html");
const js = readFileSync(join(out, scriptSrc), "utf8");
const leftovers = js.match(/["']\/assets\/[^"']+["']/g) ?? [];
if (leftovers.length > 0) throw new Error(`bundle still references served assets: ${leftovers.slice(0, 3).join(", ")}`);
const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
const bundle = GameBundle.parse(readJson(rootPath("build", "bundles", gameId, "bundle.json")));
const background = bundle.theme.palette.background;

// Keep the player's save across viewer updates: snapshot the game's storage keys, restore them on load.
const hot = `(function () {
  var hot = window.claude && window.claude.hot;
  if (!hot) return;
  function collect() {
    var out = {};
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf("gf.") === 0) out[k] = localStorage.getItem(k);
      }
    } catch (e) {}
    return out;
  }
  function restore(data) {
    try {
      Object.keys(data || {}).forEach(function (k) { if (localStorage.getItem(k) === null) localStorage.setItem(k, data[k]); });
    } catch (e) {}
  }
  if (hot.snapshot) hot.snapshot(collect);
  restore(hot.data);
})();`;

const page = `<title>${bundle.game.name}</title>
<meta name="description" content="${bundle.game.name}: playable web build from the Game Factory vertical slice.">
<style>
${styles}
html, body { height: 100%; }
body { margin: 0; overflow: hidden; background: ${background}; }
#root { display: flex; height: 100%; flex: 1; }
</style>
<div id="root"></div>
<script>${hot}</script>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>
`;
const file = rootPath("build", "artifacts", `${gameId}.html`);
writeText(file, page);
console.log(`wrote build/artifacts/${gameId}.html (${(page.length / 1024 / 1024).toFixed(2)} MB)`);
