import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root: the directory whose package.json is named "game-factory". */
export function findRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  let dir = resolve(start);
  for (;;) {
    const pkg = join(dir, "package.json");
    if (existsSync(pkg) && JSON.parse(readFileSync(pkg, "utf8")).name === "game-factory") return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("could not find the game-factory repository root");
    dir = parent;
  }
}

export const ROOT = findRoot();
export const rootPath = (...parts: string[]) => join(ROOT, ...parts);

export function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function writeText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

export function writeJson(path: string, value: unknown, compact = true): void {
  writeText(path, (compact ? formatJson(value) : JSON.stringify(value, null, 2)) + "\n");
}

/** Pretty JSON that keeps short arrays of primitives on one line, so generated content diffs well. */
export function formatJson(value: unknown, indent = ""): string {
  const next = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every((v) => v === null || typeof v !== "object")) {
      const inline = `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
      if (inline.length + indent.length <= 120) return inline;
    }
    return `[\n${value.map((v) => next + formatJson(v, next)).join(",\n")}\n${indent}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return "{}";
    const inline = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
    if (inline.length + indent.length <= 120 && entries.every(([, v]) => v === null || typeof v !== "object" || (Array.isArray(v) ? v.length <= 4 : Object.keys(v).length <= 3))) {
      return inline;
    }
    return `{\n${entries.map(([k, v]) => `${next}${JSON.stringify(k)}: ${formatJson(v, next)}`).join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value);
}
