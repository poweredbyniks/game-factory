/** Screenshots an exported web build: tsx tools/src/scripts/shot.ts <dir> <out.png> [waitForText] */
import { chromium } from "playwright";
import { serveDir } from "./serve";

const [dir, out, waitFor] = process.argv.slice(2);
const { server, url } = await serveDir(dir!);
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(url);
if (waitFor) await page.getByText(waitFor).first().waitFor({ timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: out! });
console.log(errors.length ? `console errors:\n${errors.join("\n")}` : "no console errors");
await browser.close();
server.close();
