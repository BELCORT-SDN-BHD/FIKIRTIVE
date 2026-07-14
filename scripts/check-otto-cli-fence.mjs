#!/usr/bin/env node

/**
 * Fail when production source imports a Flight Simulator / subscription CLI driver.
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
const PRODUCTION_ROOTS = ["apps/web", "apps/worker", "packages/otto/src"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SKIP_DIRECTORIES = new Set(["node_modules", ".next", "dist", "coverage", "__tests__"]);
const TEST_FILE = /(?:^|\.)\b(?:test|spec)\.[cm]?[jt]sx?$/;

const IMPORT_PATTERNS = [
  /(?:^|\n)\s*import\s+(?:type\s+)?(?:[^"'`;]*?\s+from\s+)?["']([^"']+)["']/g,
  /(?:^|\n)\s*export\s+(?:type\s+)?[^"'`;]*?\s+from\s+["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
];

/** Names intentionally describe the isolated simulator edge, never production code. */
const FORBIDDEN_DRIVER = /(?:^|[/@._-])(?:otto[-_]?cli|otto[-_]?flight|flight[-_]?simulator|cli[-_]?driver|subscription[-_]?cli|codex[-_]?cli|claude[-_]?cli|gemini[-_]?cli)(?:$|[/@._-])/i;
const GENERIC_CLI_DRIVER_PATH = /(?:^|\/)cli\/[^"']*(?:driver|model-provider)(?:$|[/._-])/i;

function isForbiddenSpecifier(specifier) {
  return FORBIDDEN_DRIVER.test(specifier) || GENERIC_CLI_DRIVER_PATH.test(specifier);
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

export function findForbiddenCliImports(source, file = "<source>") {
  const findings = [];
  const seen = new Set();
  for (const pattern of IMPORT_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1];
      if (!specifier || !isForbiddenSpecifier(specifier)) continue;
      const line = lineOf(source, match.index ?? 0);
      const key = `${line}:${specifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({ file, line, specifier });
    }
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
      console.error(`  ${finding.file}:${finding.line} imports ${JSON.stringify(finding.specifier)}`);
    }
    console.error("Production source must never import Flight Simulator or subscription CLI drivers.");
    process.exitCode = 1;
    return;
  }
  console.log(`OTTO CLI import fence: PASS (${PRODUCTION_ROOTS.join(", ")})`);
}

function selfTest() {
  const green = [
    'import { runOttoTurn } from "@fikirtive/otto";',
    'const adapter = await import("./api-model-runtime.js");',
  ].join("\n");
  const redStatic = 'import { CodexDriver } from "../../../tools/otto-flight/codex-cli-driver.js";';
  const redDynamic = 'const driver = await import("./cli/model-provider.js");';

  const greenFindings = findForbiddenCliImports(green, "apps/web/green.ts");
  const redFindings = [
    ...findForbiddenCliImports(redStatic, "apps/web/red-static.ts"),
    ...findForbiddenCliImports(redDynamic, "apps/worker/red-dynamic.ts"),
  ];
  if (greenFindings.length !== 0 || redFindings.length !== 2) {
    console.error(`OTTO CLI import fence self-test: FAIL (green=${greenFindings.length}, red=${redFindings.length})`);
    process.exitCode = 1;
    return;
  }
  console.log("OTTO CLI import fence self-test: PASS (green fixture accepted; 2 red fixtures rejected)");
}

if (process.argv.includes("--self-test")) selfTest();
else await checkRepository();
