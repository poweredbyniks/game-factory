/** Wraps build/artifacts/<game>.html in a minimal document skeleton for local checks. */
import { readFileSync } from "node:fs";
import { rootPath, writeText } from "../paths";

const gameId = process.argv[2] ?? "maplebrook";
const content = readFileSync(rootPath("build", "artifacts", `${gameId}.html`), "utf8");
const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}[hidden]{display:none!important}</style></head><body>${content}</body></html>`;
writeText(rootPath("build", "artifact-preview", gameId, "index.html"), doc);
console.log(`build/artifact-preview/${gameId}/index.html`);
