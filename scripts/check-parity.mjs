#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distManifest = path.join(root, "packages/otto/dist/parity-manifest.js");
const distRegistry = path.join(root, "packages/otto/dist/registry.js");
const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]);

function fail(message) {
  console.error(`[parity] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(distManifest) || !fs.existsSync(distRegistry)) {
  fail("packages/otto must be built first. Run `pnpm --filter @fikirtive/otto build`.");
}

const { PARITY_EXEMPTIONS, PARITY_MANIFEST, PARITY_READ_SURFACES } = await import(
  pathToFileURL(distManifest).href
);
const { skillCatalog } = await import(pathToFileURL(distRegistry).href);

function walk(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

function slash(p) {
  return p.split(path.sep).join("/");
}

function exportedAsyncFunctions(file) {
  const source = fs.readFileSync(file, "utf8");
  const names = [];
  for (const match of source.matchAll(/^export\s+async\s+function\s+([A-Za-z0-9_]+)\b/gm)) {
    names.push(match[1]);
  }
  return names;
}

function hasUseServer(file) {
  return /['"]use server['"]/.test(fs.readFileSync(file, "utf8"));
}

function actionModuleKey(file) {
  return path.basename(file).replace(/\.tsx?$/, "");
}

function discoverActionSurfaces() {
  const libDir = path.join(root, "apps/web/lib");
  const libFiles = walk(libDir)
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !slash(file).includes("/__tests__/"));

  const actionFiles = libFiles.filter((file) => {
    const base = path.basename(file);
    return base === "actions.ts" || /-actions\.tsx?$/.test(base) || hasUseServer(file);
  });

  const keys = new Set();
  for (const file of actionFiles) {
    const moduleKey = actionModuleKey(file);
    for (const name of exportedAsyncFunctions(file)) keys.add(`${moduleKey}.${name}`);
  }
  return keys;
}

function discoverApiSurfaces() {
  const apiRoot = path.join(root, "apps/web/app/api");
  const keys = new Set();
  for (const file of walk(apiRoot).filter((candidate) => candidate.endsWith(`${path.sep}route.ts`))) {
    const route = slash(path.relative(apiRoot, path.dirname(file)));
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/^export\s+async\s+function\s+([A-Z]+)\b/gm)) {
      if (allowedMethods.has(match[1])) keys.add(`api:${route}.${match[1]}`);
    }
    for (const match of source.matchAll(/^export\s+const\s+\{([^}]+)\}/gm)) {
      for (const raw of match[1].split(",")) {
        const name = raw.trim();
        if (allowedMethods.has(name)) keys.add(`api:${route}.${name}`);
      }
    }
  }
  return keys;
}

function discoverReadSurfaces() {
  const keys = new Set();
  for (const surface of PARITY_READ_SURFACES) {
    const file = path.join(root, surface.file);
    if (!fs.existsSync(file)) {
      fail(`read surface ${surface.key} points to missing file ${surface.file}`);
    }
    const source = fs.readFileSync(file, "utf8");
    const exportPattern = new RegExp(`^export\\s+(?:async\\s+)?function\\s+${surface.exportName}\\b`, "m");
    if (!exportPattern.test(source)) {
      fail(`read surface ${surface.key} does not export ${surface.exportName} from ${surface.file}`);
    }
    keys.add(surface.key);
  }
  return keys;
}

const actionKeys = discoverActionSurfaces();
const apiKeys = discoverApiSurfaces();
const readKeys = discoverReadSurfaces();
const requiredKeys = new Set([...actionKeys, ...apiKeys, ...readKeys]);
const manifestKeys = new Set(Object.keys(PARITY_MANIFEST));
const skillNames = new Set(skillCatalog.map((skill) => skill.name));
const exemptions = new Set(PARITY_EXEMPTIONS);
const errors = [];

for (const key of [...requiredKeys].sort()) {
  if (!manifestKeys.has(key)) errors.push(`missing manifest entry: ${key}`);
}

for (const key of [...manifestKeys].sort()) {
  if (!requiredKeys.has(key)) errors.push(`stale manifest entry: ${key}`);
}

let todoCount = 0;
for (const [key, entry] of Object.entries(PARITY_MANIFEST)) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    errors.push(`${key}: entry must be an object`);
    continue;
  }
  const modes = ["skill" in entry, "exempt" in entry, "todoSkill" in entry].filter(Boolean).length;
  if (modes !== 1) {
    errors.push(`${key}: entry must declare exactly one of skill, exempt, or todoSkill`);
    continue;
  }
  if ("skill" in entry && !skillNames.has(entry.skill)) {
    errors.push(`${key}: unknown skill ${entry.skill}`);
  }
  if ("exempt" in entry) {
    if (!exemptions.has(entry.exempt)) errors.push(`${key}: invalid exemption ${entry.exempt}`);
    if (typeof entry.reason !== "string" || !entry.reason.trim()) errors.push(`${key}: exemption reason is required`);
  }
  if ("todoSkill" in entry) {
    todoCount += 1;
    if (entry.todoSkill !== true) errors.push(`${key}: todoSkill must be true`);
    if (typeof entry.reason !== "string" || !entry.reason.trim()) errors.push(`${key}: todoSkill reason is required`);
  }
}

if (errors.length) {
  console.error(`[parity] found ${errors.length} issue(s):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

// Debt ratchet: TODO_SKILL count may only go down. The baseline is a checked-in
// literal; lower it in the same PR that clears debt.
const { maxTodoSkill } = JSON.parse(
  fs.readFileSync(path.join(root, "scripts/parity-debt-baseline.json"), "utf8"),
);
if (todoCount > maxTodoSkill) {
  fail(
    `TODO_SKILL debt grew: ${todoCount} > baseline ${maxTodoSkill} (+${todoCount - maxTodoSkill}). ` +
      `New surfaces need a real skill entry or an exemption — not more todoSkill debt.`,
  );
}

console.log(
  `[parity] OK: ${manifestKeys.size} entries cover ${actionKeys.size} action exports, ${apiKeys.size} API exports, ${readKeys.size} registered read surface(s).`,
);
if (todoCount > 0) {
  console.warn(`[parity] TODO_SKILL entries remain: ${todoCount}. They are registered debt, not exemptions.`);
}
if (todoCount < maxTodoSkill) {
  console.warn(
    `[parity] TODO_SKILL count (${todoCount}) is below the baseline (${maxTodoSkill}) — lower maxTodoSkill in scripts/parity-debt-baseline.json in this same PR to lock in the cleared debt.`,
  );
}
