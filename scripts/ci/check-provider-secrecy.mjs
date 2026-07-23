#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const allowlistPath = join(repoRoot, "scripts/ci/provider-secrecy-allowlist.txt");
const scanRoots = [
  "apps/web/app",
  "apps/web/components",
  "apps/web/lib",
  "apps/worker/src",
];
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);
const providerNameRe =
  /(?:(?:seedance|seedream|byteplus|bytedance|jimeng|anthropic|claude)|\bfal(?:provider|client|error|[./:_-])?\b|即梦)/iu;

function excluded(path) {
  return (
    path.includes("/__tests__/") ||
    path.includes("/test/") ||
    path.includes("/tests/") ||
    /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path) ||
    extname(path) === ".md"
  );
}

function sourceFiles(root) {
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (excluded(path)) continue;
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (sourceExtensions.has(extname(path))) files.push(path);
  }
  return files;
}

/** Remove comments without treating // or /* inside strings/template copy as comments. */
function withoutComments(source) {
  const lines = source.split(/\r?\n/u);
  let blockComment = false;
  let quote = null;
  let escaped = false;
  return lines.map((line) => {
    let clean = "";
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      const next = line[index + 1];
      if (blockComment) {
        if (char === "*" && next === "/") {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        clean += char;
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "/" && next === "*") {
        blockComment = true;
        index += 1;
        continue;
      }
      if (char === "/" && next === "/") break;
      if (char === "'" || char === '"' || char === "`") quote = char;
      clean += char;
    }
    if (quote !== "`") {
      quote = null;
      escaped = false;
    }
    return clean;
  });
}

function foundSet() {
  const found = new Set();
  for (const root of scanRoots) {
    const absoluteRoot = join(repoRoot, root);
    for (const file of sourceFiles(absoluteRoot)) {
      const relativePath = relative(repoRoot, file);
      for (const line of withoutComments(readFileSync(file, "utf8"))) {
        const sourceLine = line.trim();
        if (sourceLine && providerNameRe.test(sourceLine)) {
          found.add(`${relativePath}\t${sourceLine}`);
        }
      }
    }
  }
  return [...found].sort();
}

function allowedSet() {
  if (!existsSync(allowlistPath)) return [];
  return readFileSync(allowlistPath, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line && !line.startsWith("#"))
    .sort();
}

const found = foundSet();
if (process.argv.includes("--print-found")) {
  process.stdout.write(`${found.join("\n")}${found.length ? "\n" : ""}`);
  process.exit(0);
}

const allowed = allowedSet();
const foundLookup = new Set(found);
const allowedLookup = new Set(allowed);
const unexpected = found.filter((entry) => !allowedLookup.has(entry));
const stale = allowed.filter((entry) => !foundLookup.has(entry));

if (unexpected.length || stale.length) {
  console.error("provider-secrecy: FAIL");
  if (unexpected.length) {
    console.error("\nUnexpected provider-name occurrences:");
    for (const entry of unexpected) console.error(`+ ${entry}`);
  }
  if (stale.length) {
    console.error("\nStale allowlist entries:");
    for (const entry of stale) console.error(`- ${entry}`);
  }
  process.exit(1);
}

console.log(
  `provider-secrecy: PASS (${found.length} exact internal occurrence${found.length === 1 ? "" : "s"} allowlisted)`,
);
