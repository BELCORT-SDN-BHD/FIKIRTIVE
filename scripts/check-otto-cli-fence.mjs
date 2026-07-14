#!/usr/bin/env node

/**
 * Best-effort static check for accidental production imports of a Flight Simulator /
 * subscription CLI driver. This is a guard against ordinary mistakes, not a security
 * boundary, and it does not claim to detect deliberate or arbitrary dynamic loading.
 *
 * Scan boundary: production JS/TS sources below `apps/**` and `packages/**`.
 * Test directories/files, generated output, coverage, and dependencies are excluded.
 * TypeScript parses each source; the check examines recognized import/export forms,
 * dynamic `import(...)`, and bare `require(...)`, then resolves only static strings
 * (literal/template, concatenation, or an unambiguous local binding).
 *
 * Known, non-exhaustive blind spots include inline `createRequire(...)` calls; a
 * `createRequire(...)` loader stored in a local binding and later invoked; aliased
 * `require`; `module.require`; conditional, `join(...)`, or `String.raw` specifiers;
 * `eval`; `Function`; and `Worker(..., { eval: true })`. Even a literal forbidden
 * specifier is not checked when its loader/callee form is not recognized above.
 * Exit 0 therefore means only that this recognized static surface is clear; it does
 * not prove that dynamic loading is absent.
 *
 * Stronger enforcement is tracked, but not implemented, in #322: dependency-manifest
 * controls, a production image without CLI binaries, and production environments
 * without subscription credentials. Phase 1 also intentionally leaves package.json
 * and CI wiring to the global control plane. Run directly with:
 *
 *   node scripts/check-otto-cli-fence.mjs
 *   node scripts/check-otto-cli-fence.mjs --self-test
 */
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const requireFromOtto = createRequire(new URL("../packages/otto/package.json", import.meta.url));
const ts = requireFromOtto("typescript");

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PRODUCTION_ROOTS = ["apps", "packages"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]);
const SKIP_DIRECTORIES = new Set([
  "node_modules",
  ".next",
  ".turbo",
  "dist",
  "build",
  "out",
  "coverage",
  "test",
  "tests",
  "__tests__",
]);
const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;

/** Names intentionally describe the isolated simulator edge, never production code. */
const FORBIDDEN_DRIVER = /(?:^|[/@._-])(?:otto[-_]?cli|otto[-_]?flight|flight[-_]?simulator|cli[-_]?driver|subscription[-_]?cli|codex[-_]?cli|claude[-_]?cli|gemini[-_]?cli)(?:$|[/@._-])/i;
const GENERIC_CLI_DRIVER_PATH = /(?:^|\/)cli\/[^"']*(?:driver|model-provider)(?:$|[/._-])/i;

function isForbiddenSpecifier(specifier) {
  return FORBIDDEN_DRIVER.test(specifier) || GENERIC_CLI_DRIVER_PATH.test(specifier);
}

function unwrapExpression(node) {
  while (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isNonNullExpression(node)
    || ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  return node;
}

function collectBindings(sourceFile) {
  const bindings = new Map();
  const ambiguous = new Set();
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const name = node.name.text;
      if (bindings.has(name)) ambiguous.add(name);
      else bindings.set(name, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  for (const name of ambiguous) bindings.delete(name);
  return bindings;
}

function staticString(node, bindings, resolving = new Set()) {
  node = unwrapExpression(node);
  if (ts.isStringLiteralLike(node)) return node.text;

  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left, bindings, resolving);
    const right = staticString(node.right, bindings, resolving);
    return left === null || right === null ? null : left + right;
  }

  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = staticString(span.expression, bindings, resolving);
      if (expression === null) return null;
      value += expression + span.literal.text;
    }
    return value;
  }

  if (ts.isIdentifier(node) && bindings.has(node.text) && !resolving.has(node.text)) {
    const nextResolving = new Set(resolving).add(node.text);
    return staticString(bindings.get(node.text), bindings, nextResolving);
  }

  return null;
}

function moduleSpecifierExpression(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return node.moduleSpecifier ?? null;
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return node.moduleReference.expression ?? null;
  }
  if (ts.isCallExpression(node) && node.arguments.length === 1) {
    if (node.expression.kind === ts.SyntaxKind.ImportKeyword) return node.arguments[0];
    if (ts.isIdentifier(node.expression) && node.expression.text === "require") return node.arguments[0];
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return node.argument.literal;
  return null;
}

export function findForbiddenCliImports(source, file = "<source>") {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.getScriptKindFromFileName(file),
  );
  const bindings = collectBindings(sourceFile);
  const findings = [];

  const visit = (node) => {
    const expression = moduleSpecifierExpression(node);
    if (expression) {
      const specifier = staticString(expression, bindings);
      if (specifier !== null && isForbiddenSpecifier(specifier)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(expression.getStart(sourceFile));
        findings.push({ file, line: line + 1, specifier });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return findings;
}

function isProductionSource(path) {
  const parts = path.split(sep);
  const base = parts.at(-1) ?? "";
  return SOURCE_EXTENSIONS.has(extname(path))
    && !parts.some((part) => SKIP_DIRECTORIES.has(part))
    && !TEST_FILE.test(base);
}

async function walk(path, seenDirectories = new Set()) {
  const canonicalDirectory = await realpath(path);
  if (seenDirectories.has(canonicalDirectory)) return [];
  seenDirectories.add(canonicalDirectory);

  const files = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walk(child, seenDirectories));
      continue;
    }
    if (entry.isSymbolicLink()) {
      const target = await stat(child);
      if (target.isDirectory()) files.push(...await walk(child, seenDirectories));
      else if (target.isFile() && isProductionSource(child)) files.push(child);
      continue;
    }
    if (entry.isFile() && isProductionSource(child)) files.push(child);
  }
  return files;
}

async function findingsForFiles(files) {
  const findings = [];
  for (const file of files) {
    const displayPath = relative(REPO_ROOT, file) || file;
    findings.push(...findForbiddenCliImports(await readFile(file, "utf8"), displayPath));
  }
  return findings;
}

async function checkRepository() {
  const files = [];
  for (const root of PRODUCTION_ROOTS) files.push(...await walk(resolve(REPO_ROOT, root)));
  const findings = await findingsForFiles(files);
  if (findings.length > 0) {
    console.error("OTTO CLI import fence: FAIL");
    for (const finding of findings) {
      console.error(`  ${finding.file}:${finding.line} imports ${JSON.stringify(finding.specifier)}`);
    }
    console.error("Production source must never import Flight Simulator or subscription CLI drivers.");
    process.exitCode = 1;
    return;
  }
  console.log(`OTTO CLI import fence: PASS (${PRODUCTION_ROOTS.join(", ")}; AST-resolved production imports)`);
}

async function selfTest() {
  const green = [
    'const documentation = "codex-cli";',
    'const regex = /[///*]/;',
    'import { runOttoTurn } from "@fikirtive/otto";',
    'const adapter = await import("./api-model-runtime.js");',
    'const runtimeName = getRuntimeName(); await import(runtimeName);',
  ].join("\n");
  const redFixtures = [
    ["regex-line-comment-shape", 'const re = /[//]/; import "codex-cli";'],
    ["regex-block-comment-shape", 'const re = /[/*]/; import "codex-cli";'],
    ["line-continuation", 'require("codex-\\\ncli");'],
    ["hex-escape", String.raw`require("codex-\x63li");`],
    ["unicode-escape", String.raw`import "codex-\u0063li";`],
    ["non-escape", String.raw`require("codex-\cli");`],
    ["legacy-octal", String.raw`require("codex-\143li");`],
    ["computed-concatenation", 'import("codex-" + "cli");'],
    ["variable-dynamic", 'const driverName = "codex-cli"; import(driverName);'],
    ["template-expression", 'const suffix = "cli"; import(`codex-${suffix}`);'],
    ["export-from", 'export { driver } from "codex-cli";'],
    ["import-equals", 'import driver = require("codex-cli");'],
  ];

  const failures = [];
  const greenFindings = findForbiddenCliImports(green, "apps/web/green.ts");
  if (greenFindings.length !== 0) failures.push(`green(${greenFindings.length})`);
  for (const [name, source] of redFixtures) {
    if (findForbiddenCliImports(source, `apps/web/${name}.ts`).length !== 1) failures.push(name);
  }

  const fixtureRoot = await mkdtemp(join(tmpdir(), "otto-cli-fence-"));
  try {
    const scanRoot = join(fixtureRoot, "apps");
    const targetRoot = join(fixtureRoot, "targets");
    await mkdir(join(scanRoot, "test"), { recursive: true });
    await mkdir(targetRoot, { recursive: true });
    const targetFile = join(targetRoot, "driver.ts");
    await writeFile(targetFile, 'import "codex-cli";\n');
    await symlink(targetFile, join(scanRoot, "linked-driver.ts"));
    await writeFile(join(scanRoot, "test", "setup.ts"), 'import "codex-cli";\n');

    const files = await walk(scanRoot);
    const symlinkFindings = await findingsForFiles(files);
    if (symlinkFindings.length !== 1) failures.push(`symlink-source(${symlinkFindings.length})`);
    if (files.some((file) => file.includes(`${sep}test${sep}`))) failures.push("test-directory-exclusion");
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`OTTO CLI import fence self-test: FAIL (${failures.join(",")})`);
    process.exitCode = 1;
    return;
  }
  console.log(`OTTO CLI import fence self-test: PASS (${redFixtures.length} AST bypass fixtures; symlink scanned; test directory excluded)`);
}

if (process.argv.includes("--self-test")) await selfTest();
else await checkRepository();
