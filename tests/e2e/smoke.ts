/**
 * End-to-end smoke test against the exported web build of a game:
 *   boot -> story -> map -> start level 1 -> play the solver's solution through real taps -> win -> map.
 * Usage: tsx tests/e2e/smoke.ts <gameId>   (expects build/web/<gameId>, see `npm run export:web`)
 */
import { mkdirSync } from "node:fs";
import { chromium, type Page } from "playwright";
import { GameBundle } from "@gf/schemas";
import { TOOLING } from "../../tools/src/mechanics";
import { readJson, rootPath } from "../../tools/src/paths";
import { serveDir } from "../../tools/src/scripts/serve";
import { playLevelAssociations } from "./play-associations";

const gameId = process.argv[2] ?? "maplebrook";
// WEB_DIR serves another build (e.g. a single-file artifact preview); OFFLINE=1 blocks every request but the page.
const webDir = process.env.WEB_DIR ?? rootPath("build", "web", gameId);
const offline = process.env.OFFLINE === "1";
const shots = rootPath("build", "screenshots", process.env.WEB_DIR ? `${gameId}-artifact` : gameId);
mkdirSync(shots, { recursive: true });
const bundle = GameBundle.parse(readJson(rootPath("build", "bundles", gameId, "bundle.json")));

const { server, url } = await serveDir(webDir);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const blocked: string[] = [];
if (offline) {
  await page.route("**/*", (route) => {
    if (route.request().resourceType() === "document") return route.continue();
    blocked.push(route.request().url());
    return route.abort();
  });
}
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const shot = async (name: string) => {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${shots}/${name}.png` });
  console.log(`  📸 ${name}`);
};
const tap = (testId: string) => page.getByTestId(testId).first().click({ force: true });
const visible = (testId: string, timeout = 8000) => page.getByTestId(testId).first().waitFor({ state: "visible", timeout });

async function dismissStory(p: Page) {
  for (let i = 0; i < 12; i++) {
    if (!(await p.getByTestId("story-popup").count())) return;
    await tap("story-next");
    await p.waitForTimeout(150);
  }
}

try {
  await page.goto(url);
  await visible("hud-coins", 20000);
  if (await page.getByTestId("story-popup").count()) {
    await shot("01-story");
    await dismissStory(page);
  }
  await shot("02-map");
  const coinsBefore = await page.getByTestId("hud-coins").innerText();

  await tap("map-play");
  await visible("start-popup");
  await shot("03-start-level");
  await tap("start-play");
  await visible("budget-left");
  await shot("04-level-start");

  const level = bundle.levels[0]!;
  const tooling = TOOLING[level.mechanic]!;
  const data = tooling.mechanic.levelDataSchema.parse(level.data);
  if (level.mechanic === "associations") {
    await playLevelAssociations(page, data, tap, async (i) => (i === 3 ? shot("05-level-midway") : undefined));
  } else {
    const { playLevelTriPeaks } = await import("./play-tripeaks");
    await playLevelTriPeaks(page, data, tap, async (i) => (i === 3 ? shot("05-level-midway") : undefined));
  }
  await visible("win-popup", 10000);
  await shot("06-win");
  await tap("win-continue");
  await visible("map-play");
  await dismissStory(page);
  await page.waitForTimeout(400);
  await shot("07-map-after-win");
  const coinsAfter = await page.getByTestId("hud-coins").innerText();
  const playLabel = await page.getByTestId("map-play").innerText();
  console.log(`coins ${coinsBefore.trim()} -> ${coinsAfter.trim()}, next button: ${playLabel.trim()}`);
  if (!/2/.test(playLabel)) throw new Error(`expected level 2 to be next, got "${playLabel}"`);

  await tap("hud-coins");
  await visible("shop-popup");
  await shot("08-shop");
  await tap("shop-close");
  await tap("hud-settings");
  await visible("settings-popup");
  await tap("debug-events");
  await shot("09-settings-analytics");
  console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "✔ no console errors");
  if (offline) console.log(blocked.length ? `blocked requests:\n${blocked.join("\n")}` : "✔ no network requests");
  console.log(`✔ smoke passed for ${gameId}`);
} catch (error) {
  await page.screenshot({ path: `${shots}/failure.png` });
  console.error(`✖ smoke failed: ${String(error)}`);
  if (errors.length) console.error(errors.join("\n"));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
