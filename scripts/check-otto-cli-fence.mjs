#!/usr/bin/env node

/**
 * Fail when production source names a Flight Simulator / subscription CLI driver.
 *
 * Scan boundary (deliberately explicit): every production JS/TS source below
 * `apps/**` and `packages/**`; tests, build output, coverage, and dependencies are
 * excluded. The rule is conservative: a decoded forbidden string literal is
 * rejected even when it is first assigned to a variable and imported later. This
 * closes comment/formatting, template-literal, variable-dynamic-import, and escaped
 * Unicode specifier bypasses without pretending to be a complete JS evaluator.
 * Fully computed specifiers assembled without any forbidden literal, and sources
 * outside apps/packages, are outside this static fence's proof boundary.
 *
 * Phase 1 intentionally does not wire this into package.json or CI: those files are
 * owned by the global control plane. Run directly with:
 *
 *   node scripts/check-otto-cli-fence.mjs
 *   node scripts/check-otto-cli-fence.mjs --self-test
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_ROOTS = ["apps", "packages"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".next", ".turbo", "dist", "coverage", "__tests__"]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Names intentionally describe the isolated simulator edge, never production code. */
const FORBIDDEN_DRIVER = /(?:^|[/@._-])(?:otto[-_]?cli|otto[-_]?flight|flight[-_]?simulator|cli[-_]?driver|subscription[-_]?cli|codex[-_]?cli|claude[-_]?cli|gemini[-_]?cli)(?:$|[/@._-])/i;
const GENERIC_CLI_DRIVER_PATH = /(?:^|\/)cli\/[^"']*(?:driver|model-provider)(?:$|[/._-])/i;

function isForbiddenSpecifier(specifier) {
  return FORBIDDEN_DRIVER.test(specifier) || GENERIC_CLI_DRIVER_PATH.test(specifier);
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function decodeJsEscapes(value) {
  const simple = {
    "0": "\0",
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    "\\": "\\",
    "'": "'",
    '"': '"',
    "`": "`",
  };
  return value
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/g, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_match, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\([0bfnrtv\\'"`])/g, (_match, escaped) => simple[escaped] ?? escaped);
}

/**
 * Small lexical pass: skip comments, then collect quoted/template literal values.
 * It is intentionally not an import-regex; import formatting and variable aliases
 * therefore cannot hide a forbidden literal from the fence.
 */
function stringLiterals(source) {
  const literals = [];
  let index = 0;
  while (index < source.length) {
    if (source[index] === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (source[index] === "/" && source[index + 1] === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
      index = Math.min(source.length, index + 2);
      continue;
    }

    const quote = source[index];
    if (quote !== "'" && quote !== '"' && quote !== "`") {
      index += 1;
      continue;
    }

    const start = index;
    index += 1;
    let raw = "";
    while (index < source.length) {
      const char = source[index];
      if (char === "\\") {
        raw += char;
        if (index + 1 < source.length) raw += source[index + 1];
        index += 2;
        continue;
      }
      if (char === quote) {
        index += 1;
        break;
      }
      raw += char;
      index += 1;
    }
    literals.push({ index: start, value: decodeJsEscapes(raw) });
  }
  return literals;
}

export function findForbiddenCliImports(source, file = "<source>") {
  const findings = [];
  for (const literal of stringLiterals(source)) {
    if (!isForbiddenSpecifier(literal.value)) continue;
    findings.push({ file, line: lineOf(source, literal.index), specifier: literal.value });
  }
  return findings;
}

function isProductionSource(path) {
  const parts = path.split(sep);
  const base = parts.at(-1) ?? "";
  return SOURCE_EXTENSIONS.has(extname(path)) && !parts.some((part) => SKIP_DIRECTORIES.has(part)) && !TEST_FILE.test(base);
}

async function walk(path) {
  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) files.push(...await walk(child));
    else if (entry.isFile() && isProductionSource(child)) files.push(child);
  }
  return files;
}

async function checkRepository() {
  const findings = [];
  for (const root of PRODUCTION_ROOTS) {
    for (const file of await walk(resolve(REPO_ROOT, root))) {
      const repoPath = relative(REPO_ROOT, file);
      findings.push(...findForbiddenCliImports(await readFile(file, "utf8"), repoPath));
    }
  }
  if (findings.length > 0) {
    console.error("OTTO CLI import fence: FAIL");
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line} names ${JSON.stringify(finding.specifier)}`);
    }
    console.error("Production source must never name Flight Simulator or subscription CLI drivers.");
    process.exitCode = 1;
    return;
  }
  console.log(`OTTO CLI import fence: PASS (${PRODUCTION_ROOTS.join(", ")}; decoded production literals)`);
}

function selfTest() {
  const green = [
    '// docs may say "codex-cli" without creating a production import',
    'import { runOttoTurn } from "@fikirtive/otto";',
    'const adapter = await import("./api-model-runtime.js");',
  ].join("\n");
  const redFixtures = [
    ["inline-comment-static", 'import/* hidden */{ CodexDriver }from"../../../tools/otto-flight/codex-cli-driver.js";'],
    ["same-line-directive-static", '"use strict"; import { CodexDriver } from "codex-cli";'],
    ["template-dynamic", "const driver = await import(`codex-cli`);"],
    ["variable-dynamic", 'const driverName = "codex-cli"; const driver = await import(driverName);'],
    ["unicode-escaped", String.raw`import { CodexDriver } from "codex-\u0063li";`],
  ];

  const greenFindings = findForbiddenCliImports(green, "apps/web/green.ts");
  const failedRed = redFixtures.filter(([, source]) => findForbiddenCliImports(source, "apps/web/red.ts").length !== 1);
  if (greenFindings.length !== 0 || failedRed.length !== 0) {
    console.error(`OTTO CLI import fence self-test: FAIL (green=${greenFindings.length}, missed=${failedRed.map(([name]) => name).join(",") || "none"})`);
    process.exitCode = 1;
    return;
  }
  console.log(`OTTO CLI import fence self-test: PASS (green accepted; ${redFixtures.length} named bypass fixtures rejected)`);
}

if (process.argv.includes("--self-test")) selfTest();
else await checkRepository();
