#!/usr/bin/env node

/**
 * Auth-guard semantic fence.
 *
 * This checker uses TypeScript's parser and follows executable control-flow paths instead of
 * searching source text. It proves one of two bounded invariants for every exported callable:
 *
 *   ENTRY: every path reaching a configured sensitive operation first consumes the result of an
 *   authenticated-principal resolver.
 *
 *   INTERNAL: a non-entry callable has a required, configured principal parameter, and every
 *   sensitive operation's argument tree uses its owner identity (directly or through a derived
 *   local).
 *
 * Analysis follows local calls to arbitrary depth and same-package imports ONE module deep.
 * A deeper call is accepted only when a consumed principal already dominates its call boundary;
 * otherwise it is `unprovable`. Unresolved dynamic dispatch and computed sensitive calls are
 * always `unprovable`; they are never silently accepted. Reviewed exceptions live in
 * scripts/ci/auth-guard-exemptions.txt. Exact path/export/reason matches are required and stale
 * entries fail, so the exception ledger can only shrink intentionally.
 *
 * Run:
 *   node scripts/verify-auth-guards.mjs
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { createRequire } from "node:module";
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
const requireFromWeb = createRequire(join(REPO_ROOT, "apps/web/package.json"));
const ts = requireFromWeb("typescript");

export const MAX_SAME_PACKAGE_IMPORT_DEPTH = 1;
export const DEFAULT_SOURCE_ROOTS = ["apps/web/lib", "apps/web/app"];
export const DEFAULT_EXEMPTIONS_PATH = "scripts/ci/auth-guard-exemptions.txt";
export const DEFAULT_TRUSTED_AUTH_GUARD_PATHS = ["apps/web/lib/auth-guard.ts"];
export const DEFAULT_TRUSTED_STORAGE_PATHS = ["apps/web/lib/storage.ts"];

// Exact, audited idioms used by parameterized-principal internal modules in the live tree.
// Generic `args`/`input` names never qualify by themselves: their type must be listed or contain
// a required ownerId property. `gate`/`owner` likewise qualify only when structurally owner-bound.
export const INTERNAL_PRINCIPAL_PARAMETER_NAMES = Object.freeze([
  "ownerId",
  "principal",
  "gate",
  "owner",
  "context",
  "args",
  "input",
  "req",
]);

export const INTERNAL_PRINCIPAL_TYPE_NAMES = Object.freeze([
  "CanvasJobPlacementInput",
  "CustomerBroadcastPrincipal",
  "CustomerBroadcastReportPrincipal",
  "CustomerInboxPrincipal",
  "CustomerWorkflowPrincipal",
  "CustomerWorkflowWorkerContext",
  "DraftScheduledPostArgs",
  "MemberDirectoryPrincipal",
  "NormalizedInboundMessageInput",
  "OrchestrateArgs",
]);

// Names are explicit for auditability, but a matching token is never enough. Top-level auth
// functions are trusted only when imported from auth-guard; local wrappers are interpreted.
// `requireAdmin` is retained as the requested future-family name even though live main currently
// has no implementation.
export const PRINCIPAL_RESOLUTION_NAMES = Object.freeze([
  "requireSession",
  "requireRole",
  "requireAdmin",
  "requireOwner",
  "resolvePrincipal",
  "requireReadMembership",
  "requireWriteMembership",
  "requireOwnerMutationMembership",
  "requireOwnerMembership",
  "requireOwnerRead",
]);

export const AUTH_GUARD_EXPORTS = new Set([
  "requireSession",
  "requireRole",
  "requireAdmin",
  "requireOwner",
]);

// `requireRole` is the only live staff/admin RBAC boundary in auth-guard.ts. A name alone never
// qualifies: trustedImportedResolver still requires an exact value import from the audited module.
export const ADMIN_GUARD_EXPORTS = new Set(["requireRole"]);

export const LOCAL_PRINCIPAL_PRODUCERS = new Set(["resolvePrincipal"]);
export const RAW_SQL_MEMBERS = new Set([
  "$queryRaw",
  "$queryRawUnsafe",
  "$executeRaw",
  "$executeRawUnsafe",
]);
export const PRISMA_CALL_MEMBERS = new Set([
  "$transaction",
  "aggregate",
  "count",
  "create",
  "createMany",
  "delete",
  "deleteMany",
  "findFirst",
  "findMany",
  "findUnique",
  "groupBy",
  "update",
  "updateMany",
  "upsert",
]);
export const PRISMA_READ_MEMBERS = new Set([
  "aggregate",
  "count",
  "findFirst",
  "findMany",
  "findUnique",
  "groupBy",
]);
const READ_ONLY_SCALAR_MEMBER_CALLS = new Set([
  "toISOString",
  "toLowerCase",
  "trim",
]);
const CALLBACK_CONSUMER_ARGUMENT_INDEXES = new Map([
  ["catch", new Set([0])],
  ["every", new Set([0])],
  ["filter", new Set([0])],
  ["finally", new Set([0])],
  ["find", new Set([0])],
  ["findIndex", new Set([0])],
  ["flatMap", new Set([0])],
  ["forEach", new Set([0])],
  ["map", new Set([0])],
  ["reduce", new Set([0])],
  ["reduceRight", new Set([0])],
  ["some", new Set([0])],
  ["sort", new Set([0])],
  ["then", new Set([0, 1])],
]);
const MODELED_PURE_CALLBACK_GLOBALS = new Set(["Boolean", "Number", "String"]);
const DERIVED_COLLECTION_CALLBACK_MEMBERS = new Set(["map"]);
const DERIVED_COLLECTION_PRESERVING_MEMBERS = new Set(["slice"]);
// Allowlist (default-deny, Round 7 architecture): member calls that cannot insert a
// new element into the receiver collection. Everything else — unshift/splice/fill/
// copyWithin, Object.assign onto the receiver, and every unknown or dynamically named
// member — is treated as an inserting mutation and poisons the receiver alias group.
const PURE_COLLECTION_READ_MEMBERS = new Set([
  "at",
  "concat",
  "entries",
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "keys",
  "lastIndexOf",
  "map",
  "pop",
  "reduce",
  "reduceRight",
  "reverse",
  "shift",
  "slice",
  "some",
  "sort",
  "toString",
  "values",
]);
// Round 28: in these inserting mutators some positional slots address a range instead
// of supplying content, so an integer there can never become an element of the
// receiver. Only those slots are exempt from the derived-only argument requirement,
// and only when the argument is a plain numeric literal — a computed index is still an
// opaque escape and keeps failing closed.
const RANGE_ONLY_MUTATOR_SLOTS = new Map([
  // splice(start, deleteCount, ...items)
  ["splice", (index) => index < 2],
  // fill(value, start, end)
  ["fill", (index) => index >= 1],
  // copyWithin(target, start, end) — only moves elements the receiver already holds
  ["copyWithin", () => true],
]);
const STORAGE_OWNER_RELATION_MEMBERS = new Set(["asset"]);
const POSITIVE_PRISMA_IDENTITY_FILTER_OPERATORS = new Set([
  "equals",
  "has",
  "hasSome",
  "in",
]);
const NON_AUTHORITY_PRISMA_FILTER_OPERATORS = new Set([
  "every",
  "gt",
  "gte",
  "hasEvery",
  "isNot",
  "lt",
  "lte",
  "none",
  "not",
  "notIn",
]);
const PRISMA_PRINCIPAL_DERIVED_RESULT_MEMBERS = new Set([
  ...PRISMA_READ_MEMBERS,
  "create",
  "update",
  "upsert",
]);

// These are implementations of the trust primitive itself, not callers of the primitive.
// Tests/specs/fixtures in production roots are excluded separately by shape.
export const EXCLUDED_PRODUCTION_FILES = new Map([
  [
    "apps/web/lib/auth-guard.ts",
    "principal-resolution implementation: its own DB work necessarily occurs while resolving",
  ],
  [
    "apps/web/app/api/better-auth/[...all]/route.ts",
    "Better Auth protocol endpoint: this is part of principal establishment, not an authenticated caller",
  ],
  [
    "apps/web/lib/allowlist.ts",
    "principal-resolution dependency: requireSession/requireRole/requireOwner call this allowlist",
  ],
  [
    "apps/web/lib/better-auth/compat.ts",
    "principal-resolution compatibility implementation used by auth-guard",
  ],
  [
    "apps/web/lib/better-auth/converge.ts",
    "sign-in identity convergence implementation executed while establishing a principal",
  ],
  [
    "apps/web/lib/better-auth/gate.ts",
    "Better Auth allowlist gate executed while establishing a principal",
  ],
  [
    "apps/web/lib/better-auth/server.ts",
    "Better Auth server and adapter construction used to establish a principal",
  ],
  [
    "apps/web/lib/better-auth/session-role.ts",
    "principal role lookup implementation used during session establishment",
  ],
]);

// Transparent principal-frame runners (#463, packages/db/src/principal.ts).
//
// `runAsSystem` / `runAsTenant` / `runAsUser` are each exactly `store.run(frame, fn)`: they
// invoke `fn` SYNCHRONOUSLY, on the caller's own stack, and return its value. They read
// nothing, write nothing and decide nothing — #463 is a carrier with zero enforcement.
//
// Without this model the prover resolves the runner's body and analyses the callback INSIDE
// the runner's frame. `invokeFunction` clears the caller's principal bindings at a module
// boundary (they are the caller's locals, not the callee's), so the callback's captured
// principal — the one thing it exists to carry — reads as absent, and every sensitive
// operation it performs is reported `missing-principal-resolution` even though a resolver
// dominates the call. Modelling `run*(x, fn)` as `fn()` is what the source actually does.
//
// This ADDS precision, it does not relax the invariant: the callback body is still analysed
// in full, only against the CALLER's states — the exact states it executes under. A callback
// whose caller never resolved a principal still fails, and a sensitive operation that does not
// use the resolved principal still fails.
//
// The model is withdrawn automatically if the runner module ever grows a sensitive operation
// (see `isPrincipalFrameRunnerCall`), so it cannot become a hiding place.
export const PRINCIPAL_FRAME_RUNNERS = new Map([
  ["packages/db/src/principal.ts", new Set(["runAsSystem", "runAsTenant", "runAsUser"])],
]);

export const REASON = Object.freeze({
  MISSING: "missing-principal-resolution",
  AFTER: "principal-resolution-after-sensitive-operation",
  DISCARDED: "principal-result-discarded",
  UNUSED: "principal-result-unused",
  SHADOWED: "shadowed-principal-resolver",
  PARAM_UNUSED: "principal-parameter-unused-by-sensitive-operation",
  PARAM_OPTIONAL: "principal-parameter-optional",
  UNPROVABLE: "unprovable",
});

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];
const ROUTE_EXPORT_NAMES = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
]);

function slash(path) {
  return path.split(sep).join("/");
}

function pathIsContained(root, candidate) {
  const fromRoot = relative(root, candidate);
  return (
    fromRoot === "" ||
    (!isAbsolute(fromRoot) && fromRoot !== ".." && !fromRoot.startsWith(`..${sep}`))
  );
}

function trustedModuleRegistry(repoRoot, paths, label) {
  const realRoot = realpathSync(repoRoot);
  const registry = new Set();
  for (const configuredPath of paths) {
    if (typeof configuredPath !== "string" || configuredPath.length === 0) {
      throw new Error(`${label} trusted module path must be a non-empty string`);
    }
    const absolutePath = isAbsolute(configuredPath)
      ? resolve(configuredPath)
      : resolve(repoRoot, configuredPath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      throw new Error(`${label} trusted module does not exist as a file: ${configuredPath}`);
    }
    const realPath = realpathSync(absolutePath);
    if (!pathIsContained(realRoot, realPath)) {
      throw new Error(`${label} trusted module escapes the repository root: ${configuredPath}`);
    }
    registry.add(realPath);
  }
  return registry;
}

function conditionalPackageExportTarget(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const target = conditionalPackageExportTarget(candidate);
      if (target) return target;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const condition of ["source", "import", "default"]) {
    if (!Object.hasOwn(value, condition)) continue;
    const target = conditionalPackageExportTarget(value[condition]);
    if (target) return target;
  }
  return null;
}

function packageExportTarget(exportsField, subpath) {
  if (typeof exportsField === "string" || Array.isArray(exportsField)) {
    return subpath === "." ? conditionalPackageExportTarget(exportsField) : null;
  }
  if (!exportsField || typeof exportsField !== "object") return null;
  const subpathKeys = Object.keys(exportsField).filter((key) => key.startsWith("."));
  if (subpathKeys.length) {
    if (!Object.hasOwn(exportsField, subpath)) return null;
    return conditionalPackageExportTarget(exportsField[subpath]);
  }
  return subpath === "." ? conditionalPackageExportTarget(exportsField) : null;
}

function workspacePackageRegistry(repoRoot) {
  const realRoot = realpathSync(repoRoot);
  const packagesRoot = join(repoRoot, "packages");
  const registry = new Map();
  if (!existsSync(packagesRoot)) return registry;
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const packageDir = join(packagesRoot, entry.name);
    const manifestPath = join(packageDir, "package.json");
    if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) continue;
    const realPackageDir = realpathSync(packageDir);
    if (!pathIsContained(realRoot, realPackageDir)) {
      throw new Error(`workspace package escapes the repository root: packages/${entry.name}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (typeof manifest.name !== "string" || !manifest.exports) continue;
    if (registry.has(manifest.name)) {
      throw new Error(`duplicate workspace package name: ${manifest.name}`);
    }
    registry.set(manifest.name, {
      dir: resolve(packageDir),
      realDir: realPackageDir,
      exports: manifest.exports,
    });
  }
  return registry;
}

function sourcePathCandidates(base) {
  const extension = extname(base);
  if (SOURCE_EXTENSIONS.includes(extension)) return [base];
  if (extension === ".js") {
    const stem = base.slice(0, -extension.length);
    return [`${stem}.ts`, `${stem}.tsx`];
  }
  if (extension === ".mjs") return [`${base.slice(0, -extension.length)}.mts`];
  if (extension === ".cjs") return [`${base.slice(0, -extension.length)}.cts`];
  if (extension) return [];
  return [
    ...SOURCE_EXTENSIONS.map((candidate) => `${base}${candidate}`),
    ...SOURCE_EXTENSIONS.map((candidate) => join(base, `index${candidate}`)),
  ];
}

function memberPath(expression) {
  const members = [];
  let node = unwrapped(expression);
  while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    if (ts.isPropertyAccessExpression(node)) {
      members.unshift(node.name.text);
    } else if (node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) {
      members.unshift(node.argumentExpression.text);
    } else {
      members.unshift(null);
    }
    node = unwrapped(node.expression);
  }
  return {
    root: ts.isIdentifier(node) ? node.text : null,
    members,
  };
}

function hasModifier(node, kind) {
  return Boolean(node.modifiers?.some((modifier) => modifier.kind === kind));
}

function isFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function isTestOrFixturePath(path) {
  const normalized = slash(path);
  return (
    normalized.includes("/__tests__/") ||
    /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(normalized) ||
    normalized.endsWith(".d.ts")
  );
}

export function walkSourceFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkSourceFiles(path));
    else if (SOURCE_EXTENSIONS.includes(extname(path))) files.push(resolve(path));
  }
  return files;
}

function identifierNames(name, out = []) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const element of name.elements) {
      if (ts.isBindingElement(element)) identifierNames(element.name, out);
    }
  }
  return out;
}

function propertyNameText(name) {
  if (!name) return null;
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function rootIdentifierNode(expression) {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression?.(node)
  ) {
    node = node.expression;
  }
  while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    node = node.expression;
    while (
      ts.isParenthesizedExpression(node) ||
      ts.isAwaitExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isSatisfiesExpression?.(node)
    ) {
      node = node.expression;
    }
  }
  return ts.isIdentifier(node) ? node : null;
}

function rootIdentifier(expression) {
  return rootIdentifierNode(expression)?.text ?? null;
}

function unwrapped(expression) {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression?.(node)
  ) {
    node = node.expression;
  }
  return node;
}

function assignmentTargetRootNames(target, out = new Set()) {
  const node = unwrapped(target);
  if (ts.isIdentifier(node)) {
    out.add(node.text);
    return out;
  }
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const root = rootIdentifier(node);
    if (root) out.add(root);
    return out;
  }
  if (
    ts.isBinaryExpression(node) &&
    ts.isAssignmentOperator(node.operatorToken.kind)
  ) {
    return assignmentTargetRootNames(node.left, out);
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isShorthandPropertyAssignment(property)) {
        out.add(property.name.text);
      } else if (ts.isPropertyAssignment(property)) {
        assignmentTargetRootNames(property.initializer, out);
      } else if (ts.isSpreadAssignment(property)) {
        assignmentTargetRootNames(property.expression, out);
      }
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (ts.isSpreadElement(element)) {
        assignmentTargetRootNames(element.expression, out);
      } else if (
        ts.isBinaryExpression(element) &&
        ts.isAssignmentOperator(element.operatorToken.kind)
      ) {
        assignmentTargetRootNames(element.left, out);
      } else {
        assignmentTargetRootNames(element, out);
      }
    }
  }
  return out;
}

function assignmentTargetMemberRootNames(target, out = new Set()) {
  const node = unwrapped(target);
  if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    const root = rootIdentifier(node);
    if (root) out.add(root);
    return out;
  }
  if (
    ts.isBinaryExpression(node) &&
    ts.isAssignmentOperator(node.operatorToken.kind)
  ) {
    return assignmentTargetMemberRootNames(node.left, out);
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        assignmentTargetMemberRootNames(property.initializer, out);
      } else if (ts.isSpreadAssignment(property)) {
        assignmentTargetMemberRootNames(property.expression, out);
      }
    }
    return out;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (ts.isOmittedExpression(element)) continue;
      if (ts.isSpreadElement(element)) {
        assignmentTargetMemberRootNames(element.expression, out);
      } else if (
        ts.isBinaryExpression(element) &&
        ts.isAssignmentOperator(element.operatorToken.kind)
      ) {
        assignmentTargetMemberRootNames(element.left, out);
      } else {
        assignmentTargetMemberRootNames(element, out);
      }
    }
  }
  return out;
}

function isKnownReadOnlyPropertyMethodCall(call) {
  if (!ts.isCallExpression(call) || call.arguments.length !== 0) return false;
  const callee = unwrapped(call.expression);
  if (!ts.isPropertyAccessExpression(callee)) return false;
  if (!READ_ONLY_SCALAR_MEMBER_CALLS.has(callee.name.text)) return false;
  const receiver = unwrapped(callee.expression);
  return ts.isPropertyAccessExpression(receiver) || ts.isElementAccessExpression(receiver);
}

function dbPackageLoadCall(expression) {
  if (!expression) return null;
  const node = unwrapped(expression);
  if (!ts.isCallExpression(node) || node.arguments.length !== 1) return null;
  const specifier = unwrapped(node.arguments[0]);
  if (!ts.isStringLiteralLike(specifier) || specifier.text !== "@fikirtive/db") return null;
  const callee = unwrapped(node.expression);
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return node;
  if (ts.isIdentifier(callee) && callee.text === "require") return node;
  return null;
}

function dynamicDbBindingNames(name) {
  if (ts.isIdentifier(name)) return [name.text];
  if (!ts.isObjectBindingPattern(name)) return [];
  const names = [];
  for (const element of name.elements) {
    if (propertyNameText(element.propertyName ?? element.name) !== "prisma") continue;
    names.push(...identifierNames(element.name));
  }
  return names;
}

function initializerDeclarationFor(node) {
  let current = node;
  while (current.parent && !ts.isVariableDeclaration(current.parent)) {
    current = current.parent;
  }
  const declaration = current.parent;
  return declaration?.initializer && unwrapped(declaration.initializer) === node
    ? declaration
    : null;
}

function lineOf(info, node) {
  return info.sourceFile.getLineAndCharacterOfPosition(node.getStart(info.sourceFile)).line + 1;
}

function hasUseServerDirective(sourceFile) {
  for (const statement of sourceFile.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

function isEntryModule(info) {
  return (
    info.relPath.includes("/app/api/") ||
    info.relPath.endsWith("-gateway.ts") ||
    info.relPath.endsWith("-gateway.tsx") ||
    hasUseServerDirective(info.sourceFile)
  );
}

function clonePrincipalAliases(aliases) {
  return new Map(
    [...aliases].map(([name, members]) => [name, new Set(members)]),
  );
}

function principalAliasKey(aliases) {
  return [
    ...new Set(
      [...aliases.values()].map((members) => [...members].sort().join(",")),
    ),
  ]
    .sort()
    .join(";");
}

function principalAuthorityKey(authorities) {
  return [...authorities]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, kind]) => `${name}:${kind}`)
    .join(",");
}

function principalPropertyKey(root, property) {
  return `${root}\0${property}`;
}

function hasPrincipalProperties(bindings, root) {
  const prefix = `${root}\0`;
  return [...bindings.keys()].some((key) => key.startsWith(prefix));
}

function clearPrincipalProperties(bindings, root) {
  const prefix = `${root}\0`;
  for (const key of bindings.keys()) {
    if (key.startsWith(prefix)) bindings.delete(key);
  }
}

function principalPropertiesForRoot(bindings, root) {
  const prefix = `${root}\0`;
  const properties = new Map();
  for (const [key, kind] of bindings) {
    if (key.startsWith(prefix)) properties.set(key.slice(prefix.length), kind);
  }
  return properties;
}

function expressionIsOwnerNeutral(expression, neutralBindings) {
  const node = unwrapped(expression);
  if (ts.isIdentifier(node)) return neutralBindings.has(node.text);
  if (ts.isConditionalExpression(node)) {
    return (
      expressionIsOwnerNeutral(node.whenTrue, neutralBindings) &&
      expressionIsOwnerNeutral(node.whenFalse, neutralBindings)
    );
  }
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.every((property) => {
    if (ts.isSpreadAssignment(property)) {
      return expressionIsOwnerNeutral(property.expression, neutralBindings);
    }
    if (ts.isPropertyAssignment(property)) {
      return (
        !ts.isComputedPropertyName(property.name) &&
        propertyNameText(property.name) !== "ownerId"
      );
    }
    if (ts.isShorthandPropertyAssignment(property)) {
      return property.name.text !== "ownerId";
    }
    return false;
  });
}

// This is intentionally stricter than proving individual mutation forms: if the binding is ever
// used as anything except an exact object spread, it cannot receive the immutable-spread waiver.
function bindingIsOnlyObjectSpread(scope, declaration, name) {
  let spreadSeen = false;
  let otherReferenceSeen = false;
  const visit = (node) => {
    if (otherReferenceSeen) return;
    if (ts.isIdentifier(node) && node.text === name) {
      if (node === declaration.name) return;
      const parent = node.parent;
      if (
        parent &&
        ts.isSpreadAssignment(parent) &&
        unwrapped(parent.expression) === node
      ) {
        spreadSeen = true;
      } else {
        otherReferenceSeen = true;
      }
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  return spreadSeen && !otherReferenceSeen;
}

function moduleOwnerNeutralBindings(info) {
  const neutral = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, initializer] of info.localValues) {
      if (
        !neutral.has(name) &&
        initializer &&
        expressionIsOwnerNeutral(initializer, neutral)
      ) {
        neutral.add(name);
        changed = true;
      }
    }
  }
  return neutral;
}

function directAliasIdentifier(expression) {
  const node = unwrapped(expression);
  return ts.isIdentifier(node) ? node.text : null;
}

function escapedAliasIdentifiers(expression, out = new Set()) {
  const node = unwrapped(expression);
  if (ts.isIdentifier(node)) {
    out.add(node.text);
  } else if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        escapedAliasIdentifiers(property.initializer, out);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        out.add(property.name.text);
      } else if (ts.isSpreadAssignment(property)) {
        escapedAliasIdentifiers(property.expression, out);
      }
    }
  } else if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) escapedAliasIdentifiers(element, out);
  } else if (ts.isSpreadElement(node)) {
    escapedAliasIdentifiers(node.expression, out);
  }
  return out;
}

function escapedAliasIdentifierNodes(expression, out = []) {
  const node = unwrapped(expression);
  if (ts.isIdentifier(node)) {
    out.push(node);
  } else if (ts.isObjectLiteralExpression(node)) {
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        escapedAliasIdentifierNodes(property.initializer, out);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        out.push(property.name);
      } else if (ts.isSpreadAssignment(property)) {
        escapedAliasIdentifierNodes(property.expression, out);
      }
    }
  } else if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      escapedAliasIdentifierNodes(element, out);
    }
  } else if (ts.isSpreadElement(node)) {
    escapedAliasIdentifierNodes(node.expression, out);
  }
  return out;
}

function principalAliasMembers(state, name) {
  return state.principalAliases.get(name) ?? new Set([name]);
}

function principalNameIsTainted(state, name) {
  return (
    state.principalBindings.has(name) ||
    state.principalObjects.has(name) ||
    state.principalCarrierObjects.has(name) ||
    state.principalDerivedBindings.has(name) ||
    state.principalAuthorityBindings.has(name) ||
    hasPrincipalProperties(state.principalPropertyBindings, name) ||
    hasPrincipalProperties(state.principalCollectionPropertyBindings, name) ||
    state.signedMediaClaims.has(name) ||
    state.nonNullableSignedMediaClaims.has(name) ||
    state.authorizedSignedMediaClaims.has(name)
  );
}

function principalNameIsObjectTainted(state, name) {
  return (
    state.principalObjects.has(name) ||
    state.principalCarrierObjects.has(name) ||
    state.principalDerivedObjects.has(name) ||
    state.principalAuthorityBindings.has(name) ||
    hasPrincipalProperties(state.principalPropertyBindings, name) ||
    hasPrincipalProperties(state.principalCollectionPropertyBindings, name) ||
    state.signedMediaClaims.has(name) ||
    state.nonNullableSignedMediaClaims.has(name) ||
    state.authorizedSignedMediaClaims.has(name)
  );
}

function detachPrincipalAlias(state, name) {
  const members = principalAliasMembers(state, name);
  state.principalAliases.delete(name);
  const remaining = new Set([...members].filter((member) => member !== name));
  for (const member of remaining) {
    state.principalAliases.set(member, new Set(remaining));
  }
}

function linkPrincipalAliases(state, left, right) {
  const members = new Set([
    ...principalAliasMembers(state, left),
    ...principalAliasMembers(state, right),
    left,
    right,
  ]);
  for (const member of members) {
    state.principalAliases.set(member, new Set(members));
  }
}

function clearPrincipalName(state, name) {
  state.principalBindings.delete(name);
  state.principalObjects.delete(name);
  state.principalCarrierObjects.delete(name);
  state.principalDerivedBindings.delete(name);
  state.principalDerivedObjects.delete(name);
  state.principalAuthorityBindings.delete(name);
  state.booleanFacts.delete(name);
  clearPrincipalProperties(state.principalPropertyBindings, name);
  clearPrincipalProperties(state.principalCollectionPropertyBindings, name);
  state.principalOwnerNeutralBindings.delete(name);
  state.principalImmutableObjectBindings.delete(name);
  state.knownPrincipalBindings.delete(name);
  state.nullableDerivedBindings.delete(name);
  state.safeDerivedCollections.delete(name);
  state.knownNonEmptyCollections.delete(name);
  state.definitelyEmptyCollections.delete(name);
  state.signedMediaClaims.delete(name);
  state.nonNullableSignedMediaClaims.delete(name);
  state.authorizedSignedMediaClaims.delete(name);
}

function copySignedMediaTrust(targetState, sourceState, sourceName, targetName) {
  if (!sourceState.signedMediaClaims.has(sourceName)) return;
  targetState.signedMediaClaims.add(targetName);
  if (sourceState.nonNullableSignedMediaClaims.has(sourceName)) {
    targetState.nonNullableSignedMediaClaims.add(targetName);
  }
  if (sourceState.authorizedSignedMediaClaims.has(sourceName)) {
    targetState.authorizedSignedMediaClaims.add(targetName);
  }
}

function invalidatePrincipalAlias(state, name) {
  const members = new Set(principalAliasMembers(state, name));
  for (const member of members) {
    clearPrincipalName(state, member);
    state.invalidatedPrincipalAliases.add(member);
    state.principalAliases.delete(member);
  }
  return members;
}

function correlateNonEmptyCollectionStates(
  states,
  name,
) {
  if (!name) return states;
  const correlated = states.filter(
    (state) => !state.definitelyEmptyCollections.has(name),
  );
  if (correlated.length) return correlated;
  return states.map((state) => {
    const next = cloneState(state);
    invalidatePrincipalAlias(next, name);
    return next;
  });
}

function cloneState(state) {
  return {
    resolved: state.resolved,
    pending: new Set(state.pending),
    dbBindings: new Set(state.dbBindings),
    storageBindings: new Set(state.storageBindings),
    storageNamespaceBindings: new Set(state.storageNamespaceBindings),
    unsupportedStorageBindings: new Set(state.unsupportedStorageBindings),
    unsupportedStorageNamespaceBindings: new Set(
      state.unsupportedStorageNamespaceBindings,
    ),
    queueBindings: new Set(state.queueBindings),
    principalBindings: new Set(state.principalBindings),
    principalObjects: new Set(state.principalObjects),
    principalCarrierObjects: new Set(state.principalCarrierObjects),
    principalDerivedBindings: new Set(state.principalDerivedBindings),
    principalDerivedObjects: new Set(state.principalDerivedObjects),
    principalAuthorityBindings: new Map(state.principalAuthorityBindings),
    booleanFacts: new Map(state.booleanFacts),
    principalPropertyBindings: new Map(state.principalPropertyBindings),
    principalCollectionPropertyBindings: new Map(
      state.principalCollectionPropertyBindings,
    ),
    principalOwnerNeutralBindings: new Set(state.principalOwnerNeutralBindings),
    principalImmutableObjectBindings: new Set(
      state.principalImmutableObjectBindings,
    ),
    principalAliases: clonePrincipalAliases(state.principalAliases),
    invalidatedPrincipalAliases: new Set(state.invalidatedPrincipalAliases),
    optionalPrincipalParameters: new Set(state.optionalPrincipalParameters),
    knownPrincipalBindings: new Set(state.knownPrincipalBindings),
    nullableDerivedBindings: new Set(state.nullableDerivedBindings),
    safeDerivedCollections: new Set(state.safeDerivedCollections),
    knownNonEmptyCollections: new Set(state.knownNonEmptyCollections),
    definitelyEmptyCollections: new Set(state.definitelyEmptyCollections),
    poisonedCollections: new Set(state.poisonedCollections),
    signedMediaClaims: new Set(state.signedMediaClaims),
    nonNullableSignedMediaClaims: new Set(state.nonNullableSignedMediaClaims),
    authorizedSignedMediaClaims: new Set(state.authorizedSignedMediaClaims),
    adminResolved: state.adminResolved,
    adminPending: new Set(state.adminPending),
    returnedDerived: state.returnedDerived,
    returnedPrincipalKind: state.returnedPrincipalKind,
    returnedCapability: state.returnedCapability,
    callLineage: [...state.callLineage],
    discardedResolver: state.discardedResolver,
    shadowedResolver: state.shadowedResolver,
  };
}

function dedupeStates(states) {
  const seen = new Set();
  const out = [];
  for (const state of states) {
    const key = [
      state.resolved ? "1" : "0",
      [...state.pending].sort().join(","),
      [...state.dbBindings].sort().join(","),
      [...state.storageBindings].sort().join(","),
      [...state.storageNamespaceBindings].sort().join(","),
      [...state.unsupportedStorageBindings].sort().join(","),
      [...state.unsupportedStorageNamespaceBindings].sort().join(","),
      [...state.queueBindings].sort().join(","),
      [...state.principalBindings].sort().join(","),
      [...state.principalObjects].sort().join(","),
      [...state.principalCarrierObjects].sort().join(","),
      [...state.principalDerivedBindings].sort().join(","),
      [...state.principalDerivedObjects].sort().join(","),
      principalAuthorityKey(state.principalAuthorityBindings),
      principalAuthorityKey(state.booleanFacts),
      principalAuthorityKey(state.principalPropertyBindings),
      principalAuthorityKey(state.principalCollectionPropertyBindings),
      [...state.principalOwnerNeutralBindings].sort().join(","),
      [...state.principalImmutableObjectBindings].sort().join(","),
      principalAliasKey(state.principalAliases),
      [...state.invalidatedPrincipalAliases].sort().join(","),
      [...state.optionalPrincipalParameters].sort().join(","),
      [...state.knownPrincipalBindings].sort().join(","),
      [...state.nullableDerivedBindings].sort().join(","),
      [...state.safeDerivedCollections].sort().join(","),
      [...state.knownNonEmptyCollections].sort().join(","),
      [...state.definitelyEmptyCollections].sort().join(","),
      [...state.poisonedCollections].sort().join(","),
      [...state.signedMediaClaims].sort().join(","),
      [...state.nonNullableSignedMediaClaims].sort().join(","),
      [...state.authorizedSignedMediaClaims].sort().join(","),
      state.adminResolved ? "1" : "0",
      [...state.adminPending].sort().join(","),
      state.returnedDerived ? "1" : "0",
      state.returnedPrincipalKind ?? "",
      state.returnedCapability ? "1" : "0",
      state.callLineage.join(","),
      state.discardedResolver ? "1" : "0",
      state.shadowedResolver ? "1" : "0",
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(state);
    }
  }
  return out;
}

function createState(info) {
  return {
    resolved: false,
    pending: new Set(),
    dbBindings: new Set(info.staticDbAliases),
    storageBindings: new Set(info.staticStorageAliases),
    storageNamespaceBindings: new Set(info.staticStorageNamespaceAliases),
    unsupportedStorageBindings: new Set(info.staticUnsupportedStorageAliases),
    unsupportedStorageNamespaceBindings: new Set(
      info.staticUnsupportedStorageNamespaceAliases,
    ),
    queueBindings: new Set(),
    principalBindings: new Set(),
    principalObjects: new Set(),
    principalCarrierObjects: new Set(),
    principalDerivedBindings: new Set(),
    principalDerivedObjects: new Set(),
    principalAuthorityBindings: new Map(),
    booleanFacts: new Map(),
    principalPropertyBindings: new Map(),
    principalCollectionPropertyBindings: new Map(),
    principalOwnerNeutralBindings: moduleOwnerNeutralBindings(info),
    principalImmutableObjectBindings: new Set(),
    principalAliases: new Map(),
    invalidatedPrincipalAliases: new Set(),
    optionalPrincipalParameters: new Set(),
    knownPrincipalBindings: new Set(),
    nullableDerivedBindings: new Set(),
    safeDerivedCollections: new Set(),
    knownNonEmptyCollections: new Set(),
    definitelyEmptyCollections: new Set(),
    poisonedCollections: new Set(),
    signedMediaClaims: new Set(),
    nonNullableSignedMediaClaims: new Set(),
    authorizedSignedMediaClaims: new Set(),
    adminResolved: false,
    adminPending: new Set(),
    returnedDerived: false,
    returnedPrincipalKind: null,
    returnedCapability: false,
    callLineage: [],
    discardedResolver: false,
    shadowedResolver: false,
  };
}

class SemanticProject {
  constructor({
    repoRoot,
    sourceFiles,
    trustedAuthGuardPaths,
    trustedStoragePaths,
    reviewedExemptions = [],
  }) {
    this.repoRoot = resolve(repoRoot);
    this.requestedSourceFiles = [...new Set(sourceFiles.map((file) => resolve(file)))].sort();
    this.trustedAuthGuardPaths = new Set(trustedAuthGuardPaths.map(slash));
    this.trustedStoragePaths = trustedModuleRegistry(
      this.repoRoot,
      trustedStoragePaths,
      "storage",
    );
    this.workspacePackages = workspacePackageRegistry(this.repoRoot);
    this.reviewedExemptExports = new Set(
      reviewedExemptions.map((entry) => `${entry.path}\0${entry.exportName}`),
    );
    this.modules = new Map();
    this.moduleSensitivity = new Map();
  }

  isReviewedExemptExport(info, exportName) {
    return this.reviewedExemptExports.has(`${info.relPath}\0${exportName}`);
  }

  isPrincipalEstablishmentModule(info) {
    return Boolean(info && EXCLUDED_PRODUCTION_FILES.has(info.relPath));
  }

  isIndependentlyAnalyzedEntry(info) {
    return Boolean(
      info &&
      info.isEntry &&
      this.requestedSourceFiles.includes(info.path),
    );
  }

  isWorkspacePackageModule(info) {
    return Boolean(
      info &&
      [...this.workspacePackages.values()].some((workspacePackage) =>
        pathIsContained(workspacePackage.dir, info.path),
      ),
    );
  }

  getModule(path) {
    const absolute = resolve(path);
    if (this.modules.has(absolute)) return this.modules.get(absolute);
    if (!existsSync(absolute)) return null;

    const source = readFileSync(absolute, "utf8");
    const scriptKind = absolute.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(
      absolute,
      source,
      ts.ScriptTarget.Latest,
      true,
      scriptKind,
    );
    const info = {
      path: absolute,
      relPath: slash(relative(this.repoRoot, absolute)),
      source,
      sourceFile,
      imports: new Map(),
      namespaceImports: new Map(),
      localFunctions: new Map(),
      localValues: new Map(),
      localTypes: new Map(),
      prismaImports: new Set(),
      storageImports: new Set(),
      storageNamespaceImports: new Set(),
      unsupportedStorageImports: new Set(),
      unsupportedStorageNamespaceImports: new Set(),
      dynamicDbAliases: new Set(),
      unboundDbLoads: [],
      staticDbAliases: new Set(),
      staticStorageAliases: new Set(),
      staticStorageNamespaceAliases: new Set(),
      staticUnsupportedStorageAliases: new Set(),
      staticUnsupportedStorageNamespaceAliases: new Set(),
      importsDbPackage: false,
      getBossImports: new Set(),
      exportRecords: [],
      firstSensitiveNode: null,
      directSensitive: false,
      isEntry: false,
    };
    this.modules.set(absolute, info);
    this.indexModule(info);
    info.isEntry = isEntryModule(info);
    return info;
  }

  indexModule(info) {
    for (const statement of info.sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
        const source = statement.moduleSpecifier.text;
        if (source === "@fikirtive/db") info.importsDbPackage = true;
        const clause = statement.importClause;
        if (!clause) continue;
        if (clause.name) {
          info.imports.set(clause.name.text, {
            source,
            imported: "default",
            typeOnly: clause.isTypeOnly,
          });
        }
        const bindings = clause.namedBindings;
        if (bindings && ts.isNamespaceImport(bindings)) {
          info.namespaceImports.set(bindings.name.text, { source, typeOnly: clause.isTypeOnly });
          if (!clause.isTypeOnly) {
            const storageOrigin = this.storageModuleOrigin(info, source);
            (
              storageOrigin === "trusted"
                ? info.storageNamespaceImports
                : info.unsupportedStorageNamespaceImports
            ).add(bindings.name.text);
          }
        } else if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const imported = (element.propertyName ?? element.name).text;
            info.imports.set(element.name.text, {
              source,
              imported,
              typeOnly: clause.isTypeOnly || element.isTypeOnly,
            });
            if (!clause.isTypeOnly && !element.isTypeOnly && source === "@fikirtive/db" && imported === "prisma") {
              info.prismaImports.add(element.name.text);
            }
            if (
              !clause.isTypeOnly &&
              !element.isTypeOnly &&
              imported === "storage"
            ) {
              const storageOrigin = this.storageModuleOrigin(info, source);
              (
                storageOrigin === "trusted"
                  ? info.storageImports
                  : info.unsupportedStorageImports
              ).add(element.name.text);
            }
            if (
              !clause.isTypeOnly &&
              !element.isTypeOnly &&
              imported === "getBoss" &&
              this.isQueueModuleSpecifier(source)
            ) {
              info.getBossImports.add(element.name.text);
            }
          }
        }
        continue;
      }

      if (ts.isFunctionDeclaration(statement) && statement.name) {
        info.localFunctions.set(statement.name.text, statement);
      }
      if (
        (ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement)) &&
        statement.name
      ) {
        info.localTypes.set(statement.name.text, statement);
      }
      if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          for (const name of identifierNames(declaration.name)) {
            info.localValues.set(name, declaration.initializer ?? null);
          }
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.initializer &&
            isFunctionLike(unwrapped(declaration.initializer))
          ) {
            info.localFunctions.set(declaration.name.text, unwrapped(declaration.initializer));
          }
        }
      }
      this.indexExportRecord(info, statement);
    }

    const indexDbLoads = (node) => {
      const load = dbPackageLoadCall(node);
      if (load) {
        info.importsDbPackage = true;
        const declaration = initializerDeclarationFor(load);
        const names = declaration ? dynamicDbBindingNames(declaration.name) : [];
        if (names.length) {
          for (const name of names) info.dynamicDbAliases.add(name);
        } else {
          info.unboundDbLoads.push(load);
        }
      }
      ts.forEachChild(node, indexDbLoads);
    };
    indexDbLoads(info.sourceFile);

    info.staticDbAliases = new Set([...info.prismaImports, ...info.dynamicDbAliases]);
    info.staticStorageAliases = new Set(info.storageImports);
    info.staticStorageNamespaceAliases = new Set(info.storageNamespaceImports);
    info.staticUnsupportedStorageAliases = new Set(info.unsupportedStorageImports);
    info.staticUnsupportedStorageNamespaceAliases = new Set(
      info.unsupportedStorageNamespaceImports,
    );
    let aliasesChanged = true;
    while (aliasesChanged) {
      aliasesChanged = false;
      for (const statement of info.sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const node of statement.declarationList.declarations) {
          if (!node.initializer) continue;
          let carriesDb = false;
          let carriesStorage = false;
          let carriesStorageNamespace = false;
          let carriesUnsupportedStorage = false;
          let carriesUnsupportedStorageNamespace = false;
          const initializerPath = memberPath(node.initializer);
          if (
            initializerPath.root &&
            info.staticStorageNamespaceAliases.has(initializerPath.root)
          ) {
            if (initializerPath.members[0] === "storage") carriesStorage = true;
            else if (initializerPath.members.length === 0) carriesStorageNamespace = true;
          }
          if (
            initializerPath.root &&
            info.staticUnsupportedStorageNamespaceAliases.has(initializerPath.root)
          ) {
            if (initializerPath.members[0] === "storage") {
              carriesUnsupportedStorage = true;
            } else if (initializerPath.members.length === 0) {
              carriesUnsupportedStorageNamespace = true;
            }
          }
          const inspect = (child, isRoot = false) => {
            if (!isRoot && isFunctionLike(child)) return;
            if (ts.isIdentifier(child) && info.staticDbAliases.has(child.text)) carriesDb = true;
            if (ts.isIdentifier(child) && info.staticStorageAliases.has(child.text)) {
              carriesStorage = true;
            }
            if (
              ts.isIdentifier(child) &&
              info.staticStorageNamespaceAliases.has(child.text)
            ) {
              carriesStorageNamespace = true;
            }
            if (
              ts.isIdentifier(child) &&
              info.staticUnsupportedStorageAliases.has(child.text)
            ) {
              carriesUnsupportedStorage = true;
            }
            if (
              ts.isIdentifier(child) &&
              info.staticUnsupportedStorageNamespaceAliases.has(child.text)
            ) {
              carriesUnsupportedStorageNamespace = true;
            }
            if (
              !carriesDb ||
              !carriesStorage ||
              !carriesStorageNamespace ||
              !carriesUnsupportedStorage ||
              !carriesUnsupportedStorageNamespace
            ) {
              ts.forEachChild(child, (nested) => inspect(nested));
            }
          };
          inspect(node.initializer, true);
          for (const name of identifierNames(node.name)) {
            if (carriesDb) {
              if (!info.staticDbAliases.has(name)) {
                info.staticDbAliases.add(name);
                aliasesChanged = true;
              }
            }
            if (carriesStorage && !info.staticStorageAliases.has(name)) {
              info.staticStorageAliases.add(name);
              aliasesChanged = true;
            }
            if (
              carriesStorageNamespace &&
              !info.staticStorageNamespaceAliases.has(name)
            ) {
              info.staticStorageNamespaceAliases.add(name);
              aliasesChanged = true;
            }
            if (
              carriesUnsupportedStorage &&
              !info.staticUnsupportedStorageAliases.has(name)
            ) {
              info.staticUnsupportedStorageAliases.add(name);
              aliasesChanged = true;
            }
            if (
              carriesUnsupportedStorageNamespace &&
              !info.staticUnsupportedStorageNamespaceAliases.has(name)
            ) {
              info.staticUnsupportedStorageNamespaceAliases.add(name);
              aliasesChanged = true;
            }
          }
        }
      }
    }

    const visit = (node) => {
      if (this.directSensitiveKind(info, node, createState(info))) {
        info.directSensitive = true;
        info.firstSensitiveNode ??= node;
      }
      ts.forEachChild(node, visit);
    };
    visit(info.sourceFile);
    if (info.unboundDbLoads.length) {
      info.directSensitive = true;
      info.firstSensitiveNode ??= info.unboundDbLoads[0];
    }
  }

  indexExportRecord(info, statement) {
    if (ts.isFunctionDeclaration(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      info.exportRecords.push({
        kind: "local",
        exported: isDefault ? "default" : statement.name?.text,
        local: statement.name?.text ?? null,
        node: statement,
      });
      return;
    }

    if (ts.isVariableStatement(statement) && hasModifier(statement, ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of identifierNames(declaration.name)) {
          info.exportRecords.push({
            kind: "local",
            exported: name,
            local: name,
            node: declaration.initializer ?? declaration,
          });
        }
      }
      return;
    }

    if (ts.isExportAssignment(statement)) {
      info.exportRecords.push({
        kind: "default-expression",
        exported: "default",
        node: statement.expression,
      });
      return;
    }

    if (!ts.isExportDeclaration(statement)) return;
    const source = statement.moduleSpecifier && ts.isStringLiteralLike(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : null;
    if (!statement.exportClause) {
      if (source) info.exportRecords.push({ kind: "star", source });
      return;
    }
    if (ts.isNamespaceExport(statement.exportClause)) return;
    for (const element of statement.exportClause.elements) {
      if (element.isTypeOnly || statement.isTypeOnly) continue;
      info.exportRecords.push({
        kind: source ? "reexport" : "alias",
        exported: element.name.text,
        local: (element.propertyName ?? element.name).text,
        source,
        node: element,
      });
    }
  }

  isQueueModuleSpecifier(source) {
    return /(?:^|\/)queue(?:\.[cm]?[jt]sx?)?$/u.test(source);
  }

  storageModuleOrigin(info, source) {
    const targetPath = this.resolveModuleSpecifier(info, source);
    if (!targetPath) return "unsupported";
    const realTargetPath = realpathSync(targetPath);
    return this.trustedStoragePaths.has(realTargetPath) ? "trusted" : "unsupported";
  }

  resolveWorkspacePackageSpecifier(source) {
    const packageNames = [...this.workspacePackages.keys()]
      .filter((name) => source === name || source.startsWith(`${name}/`))
      .sort((left, right) => right.length - left.length);
    const packageName = packageNames[0];
    if (!packageName) return null;
    const workspacePackage = this.workspacePackages.get(packageName);
    const subpath =
      source === packageName ? "." : `./${source.slice(packageName.length + 1)}`;
    const target = packageExportTarget(workspacePackage.exports, subpath);
    if (!target || !target.startsWith("./")) return null;

    const targetRelative = target.slice(2);
    const sourceBases = [];
    if (targetRelative.startsWith("dist/")) {
      const withoutDist = targetRelative.slice("dist/".length);
      sourceBases.push(join(workspacePackage.dir, withoutDist));
      if (!withoutDist.startsWith("src/")) {
        sourceBases.push(join(workspacePackage.dir, "src", withoutDist));
      }
    } else {
      sourceBases.push(join(workspacePackage.dir, targetRelative));
    }

    for (const base of sourceBases) {
      if (!pathIsContained(workspacePackage.dir, base)) continue;
      for (const candidate of sourcePathCandidates(base)) {
        if (!existsSync(candidate) || !statSync(candidate).isFile()) continue;
        const realCandidate = realpathSync(candidate);
        if (pathIsContained(workspacePackage.realDir, realCandidate)) {
          return resolve(candidate);
        }
      }
    }
    return null;
  }

  resolveModuleSpecifier(info, source) {
    let base;
    if (source.startsWith("@/")) base = join(this.repoRoot, "apps/web", source.slice(2));
    else if (source.startsWith(".")) base = resolve(dirname(info.path), source);
    else return this.resolveWorkspacePackageSpecifier(source);

    return sourcePathCandidates(base).find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile(),
    ) ?? null;
  }

  resolveLocalTarget(info, local, seen = new Set()) {
    const key = `${info.path}:${local}`;
    if (seen.has(key)) return null;
    seen.add(key);

    const functionNode = info.localFunctions.get(local);
    if (functionNode) {
      return {
        info,
        node: functionNode,
        name: local,
        unknown: false,
        localBindings: [local],
      };
    }

    const initializer = info.localValues.get(local);
    if (initializer) {
      const node = unwrapped(initializer);
      if (isFunctionLike(node)) {
        return {
          info,
          node,
          name: local,
          unknown: false,
          localBindings: [local],
        };
      }
      if (ts.isIdentifier(node)) {
        const target = this.resolveLocalTarget(info, node.text, seen);
        if (!target) return null;
        return {
          ...target,
          localBindings:
            target.info.path === info.path &&
            Array.isArray(target.localBindings)
              ? [local, ...target.localBindings]
              : null,
        };
      }
    }

    const imported = info.imports.get(local);
    if (imported && !imported.typeOnly) {
      const targetPath = this.resolveModuleSpecifier(info, imported.source);
      if (!targetPath) return null;
      const targetInfo = this.getModule(targetPath);
      return this.exportTargets(targetInfo).get(imported.imported) ?? null;
    }
    return null;
  }

  exportTargets(info, seen = new Set()) {
    if (!info) return new Map();
    if (seen.has(info.path)) return new Map();
    const nextSeen = new Set(seen);
    nextSeen.add(info.path);
    const exports = new Map();

    for (const record of info.exportRecords) {
      if (!record.exported && record.kind !== "star") continue;
      if (record.kind === "local") {
        const target =
          (record.local && this.resolveLocalTarget(info, record.local)) ||
          (isFunctionLike(unwrapped(record.node))
            ? {
                info,
                node: unwrapped(record.node),
                name: record.exported,
                unknown: false,
                localBindings: [],
              }
            : { info, node: record.node, name: record.exported, unknown: true });
        exports.set(record.exported, target);
      } else if (record.kind === "default-expression") {
        const expression = unwrapped(record.node);
        let target = null;
        if (isFunctionLike(expression)) {
          target = {
            info,
            node: expression,
            name: "default",
            unknown: false,
            localBindings: [],
          };
        } else if (ts.isIdentifier(expression)) {
          target = this.resolveLocalTarget(info, expression.text);
        }
        exports.set(
          "default",
          target ?? { info, node: record.node, name: "default", unknown: true },
        );
      } else if (record.kind === "alias") {
        exports.set(
          record.exported,
          this.resolveLocalTarget(info, record.local) ?? {
            info,
            node: record.node,
            name: record.exported,
            unknown: true,
          },
        );
      } else if (record.kind === "reexport") {
        const targetPath = this.resolveModuleSpecifier(info, record.source);
        const targetInfo = targetPath ? this.getModule(targetPath) : null;
        const target = targetInfo
          ? this.exportTargets(targetInfo, nextSeen).get(record.local)
          : null;
        exports.set(
          record.exported,
          target ?? { info, node: record.node, name: record.exported, unknown: true },
        );
      } else if (record.kind === "star") {
        const targetPath = this.resolveModuleSpecifier(info, record.source);
        const targetInfo = targetPath ? this.getModule(targetPath) : null;
        for (const [name, target] of this.exportTargets(targetInfo, nextSeen)) {
          if (name !== "default" && !exports.has(name)) exports.set(name, target);
        }
      }
    }
    return exports;
  }

  moduleMayReachSensitive(info, remainingDepth = MAX_SAME_PACKAGE_IMPORT_DEPTH + 1, seen = new Set()) {
    if (!info) return false;
    const cacheKey = `${info.path}:${remainingDepth}`;
    if (this.moduleSensitivity.has(cacheKey)) return this.moduleSensitivity.get(cacheKey);
    if (seen.has(info.path)) return true;
    if (info.directSensitive) {
      this.moduleSensitivity.set(cacheKey, true);
      return true;
    }
    if (remainingDepth <= 0) {
      this.moduleSensitivity.set(cacheKey, false);
      return false;
    }
    const nextSeen = new Set(seen);
    nextSeen.add(info.path);
    for (const binding of [...info.imports.values(), ...info.namespaceImports.values()]) {
      if (binding.typeOnly) continue;
      const targetPath = this.resolveModuleSpecifier(info, binding.source);
      const targetInfo = targetPath ? this.getModule(targetPath) : null;
      if (targetInfo && this.moduleMayReachSensitive(targetInfo, remainingDepth - 1, nextSeen)) {
        this.moduleSensitivity.set(cacheKey, true);
        return true;
      }
    }
    this.moduleSensitivity.set(cacheKey, false);
    return false;
  }

  directSensitiveKind(info, node, state) {
    if (ts.isTaggedTemplateExpression(node)) {
      const tag = unwrapped(node.tag);
      if (ts.isPropertyAccessExpression(tag) || ts.isElementAccessExpression(tag)) {
        const member = ts.isPropertyAccessExpression(tag)
          ? tag.name.text
          : tag.argumentExpression && ts.isStringLiteralLike(tag.argumentExpression)
            ? tag.argumentExpression.text
            : null;
        if (member && RAW_SQL_MEMBERS.has(member)) return `raw SQL ${member}`;
      }
    }
    if (!ts.isCallExpression(node)) return null;
    const expression = unwrapped(node.expression);
    const storagePath = memberPath(expression);
    const trustedStorage =
      Boolean(storagePath.root && state.storageBindings.has(storagePath.root)) ||
      Boolean(
        storagePath.root &&
        state.storageNamespaceBindings.has(storagePath.root) &&
        storagePath.members[0] === "storage",
      );
    const unsupportedStorage =
      Boolean(
        storagePath.root &&
        state.unsupportedStorageBindings.has(storagePath.root),
      ) ||
      Boolean(
        storagePath.root &&
        state.unsupportedStorageNamespaceBindings.has(storagePath.root) &&
        storagePath.members[0] === "storage",
      );
    if (ts.isElementAccessExpression(expression)) {
      const root = storagePath.root;
      if (root && state.dbBindings.has(root)) return "computed Prisma call";
      if (unsupportedStorage) return "unsupported storage origin";
      if (trustedStorage) return "computed storage call";
      if (root && state.queueBindings.has(root)) return "computed queue call";
      return null;
    }
    if (!ts.isPropertyAccessExpression(expression)) return null;
    const member = expression.name.text;
    if (RAW_SQL_MEMBERS.has(member)) return `raw SQL ${member}`;
    const root = rootIdentifier(expression);
    if (root && state.dbBindings.has(root)) return `Prisma call ${expression.getText(info.sourceFile)}`;
    if (
      root &&
      info.importsDbPackage &&
      PRISMA_CALL_MEMBERS.has(member) &&
      (member === "$transaction" ||
        ts.isPropertyAccessExpression(expression.expression) ||
        ts.isElementAccessExpression(expression.expression))
    ) {
      return `possible Prisma call ${expression.getText(info.sourceFile)}`;
    }
    if (unsupportedStorage) {
      return `unsupported storage origin ${expression.getText(info.sourceFile)}`;
    }
    if (trustedStorage) {
      return `storage call ${expression.getText(info.sourceFile)}`;
    }
    if (member === "send" && root && state.queueBindings.has(root)) {
      return `queue send ${expression.getText(info.sourceFile)}`;
    }
    return null;
  }
}

function typeReferenceName(typeNode) {
  if (!typeNode || !ts.isTypeReferenceNode(typeNode)) return null;
  const name = typeNode.typeName;
  if (ts.isIdentifier(name)) return name.text;
  if (ts.isQualifiedName(name)) return name.right.text;
  return null;
}

function typeAllowsMissing(typeNode) {
  if (!typeNode) return true;
  if (ts.isParenthesizedTypeNode(typeNode)) return typeAllowsMissing(typeNode.type);
  if (!ts.isUnionTypeNode(typeNode)) return false;
  return typeNode.types.some(
    (part) =>
      part.kind === ts.SyntaxKind.UndefinedKeyword ||
      part.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isLiteralTypeNode(part) && part.literal.kind === ts.SyntaxKind.NullKeyword),
  );
}

function typeHasRequiredOwnerId(typeNode, info = null, seen = new Set()) {
  if (!typeNode) return false;
  if (ts.isParenthesizedTypeNode(typeNode)) {
    return typeHasRequiredOwnerId(typeNode.type, info, seen);
  }
  const reference = typeReferenceName(typeNode);
  if (reference && INTERNAL_PRINCIPAL_TYPE_NAMES.includes(reference)) return true;
  if (reference && info?.localTypes.has(reference) && !seen.has(reference)) {
    const declaration = info.localTypes.get(reference);
    const nextSeen = new Set(seen);
    nextSeen.add(reference);
    if (ts.isTypeAliasDeclaration(declaration)) {
      return typeHasRequiredOwnerId(declaration.type, info, nextSeen);
    }
    if (ts.isInterfaceDeclaration(declaration)) {
      return typeMembersHaveRequiredOwnerId(declaration.members) ||
        declaration.heritageClauses?.some((clause) =>
          clause.types.some((part) =>
            typeHasRequiredOwnerId(part, info, nextSeen),
          ),
        ) === true;
    }
  }
  if (ts.isIntersectionTypeNode(typeNode)) {
    return typeNode.types.some((part) =>
      typeHasRequiredOwnerId(part, info, seen),
    );
  }
  if (!ts.isTypeLiteralNode(typeNode)) return false;
  return typeMembersHaveRequiredOwnerId(typeNode.members);
}

function typeMembersHaveRequiredOwnerId(members) {
  return members.some(
    (member) =>
      ts.isPropertySignature(member) &&
      propertyNameText(member.name) === "ownerId" &&
      !member.questionToken &&
      !typeAllowsMissing(member.type),
  );
}

function principalParameterShape(parameter, info = null) {
  const required =
    !parameter.questionToken &&
    !parameter.initializer &&
    !typeAllowsMissing(parameter.type);
  const typeName = typeReferenceName(parameter.type);
  const configuredType =
    Boolean(typeName) && INTERNAL_PRINCIPAL_TYPE_NAMES.includes(typeName);
  const structuredOwner = typeHasRequiredOwnerId(parameter.type, info);

  if (ts.isIdentifier(parameter.name)) {
    const name = parameter.name.text;
    const configuredName = INTERNAL_PRINCIPAL_PARAMETER_NAMES.includes(name);
    if (name === "ownerId" && parameter.type) {
      return { required, kind: "binding", names: [name] };
    }
    if (configuredName && (configuredType || structuredOwner)) {
      return { required, kind: "object", names: [name] };
    }
    if (configuredType || structuredOwner) {
      return { required, kind: "object", names: [name] };
    }
    return null;
  }

  if (ts.isObjectBindingPattern(parameter.name) && (configuredType || structuredOwner)) {
    const ownerBindings = [];
    for (const element of parameter.name.elements) {
      const sourceName = propertyNameText(element.propertyName ?? element.name);
      if (sourceName !== "ownerId") continue;
      ownerBindings.push(...identifierNames(element.name));
    }
    if (ownerBindings.length) {
      return { required, kind: "binding", names: ownerBindings };
    }
  }
  return null;
}

function applyPrincipalParameters(state, node, inherited = null, info = null) {
  const next = cloneState(state);
  if (inherited) {
    for (const name of inherited.principalBindings ?? []) next.principalBindings.add(name);
    for (const name of inherited.principalObjects ?? []) next.principalObjects.add(name);
    for (const name of inherited.principalDerivedBindings ?? []) {
      next.principalDerivedBindings.add(name);
    }
    for (const name of inherited.principalDerivedObjects ?? []) {
      next.principalDerivedObjects.add(name);
    }
    for (const name of inherited.optionalPrincipalParameters ?? []) {
      next.optionalPrincipalParameters.add(name);
    }
  }
  for (const parameter of node.parameters ?? []) {
    const shape = principalParameterShape(parameter, info);
    if (!shape) continue;
    if (!shape.required) {
      for (const name of shape.names) next.optionalPrincipalParameters.add(name);
    } else if (shape.kind === "object") {
      for (const name of shape.names) next.principalObjects.add(name);
    } else {
      for (const name of shape.names) next.principalBindings.add(name);
    }
  }
  return next;
}

function isPrincipalIdentityKeyName(name) {
  return name === "id" || name.endsWith("Id") || name.endsWith("Ids");
}

function isCompoundPrismaIdentityKeyName(name) {
  const parts = name.split("_");
  return parts.length > 1 && parts.every(isPrincipalIdentityKeyName);
}

function principalExpressionKind(expression, state, derivedExpressions = null) {
  if (!expression) return null;
  const node = expression;
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAwaitExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression?.(node)
  ) {
    return principalExpressionKind(node.expression, state, derivedExpressions);
  }
  if (ts.isIdentifier(node)) {
    if (state.principalBindings.has(node.text)) return "binding";
    if (state.principalObjects.has(node.text)) return "object";
    if (state.principalDerivedBindings.has(node.text)) return "derived";
    return null;
  }
  const modeledKind =
    derivedExpressions?.get?.(node) ??
    (derivedExpressions?.has?.(node) ? "derived" : null);
  if (modeledKind) return modeledKind;
  if (ts.isConditionalExpression(node)) {
    const whenTrueKind = principalExpressionKind(
      node.whenTrue,
      state,
      derivedExpressions,
    );
    const whenFalseKind = principalExpressionKind(
      node.whenFalse,
      state,
      derivedExpressions,
    );
    if (!whenTrueKind || !whenFalseKind) return null;
    return whenTrueKind === whenFalseKind ? whenTrueKind : "derived";
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    const leftKind = principalExpressionKind(
      node.left,
      state,
      derivedExpressions,
    );
    const rightKind = principalExpressionKind(
      node.right,
      state,
      derivedExpressions,
    );
    if (!leftKind || !rightKind) return null;
    return leftKind === rightKind ? leftKind : "derived";
  }
  if (ts.isPropertyAccessExpression(node)) {
    const directReceiver = unwrapped(node.expression);
    if (ts.isIdentifier(directReceiver)) {
      const propertyKind = state.principalPropertyBindings.get(
        principalPropertyKey(directReceiver.text, node.name.text),
      );
      if (propertyKind) return propertyKind;
    }
    const receiverKind = principalExpressionKind(
      node.expression,
      state,
      derivedExpressions,
    );
    if (receiverKind === "object") {
      return node.name.text === "ownerId" ? "binding" : null;
    }
    return receiverKind === "derived" && isPrincipalIdentityKeyName(node.name.text)
      ? "derived"
      : null;
  }
  if (ts.isElementAccessExpression(node)) {
    const directReceiver = unwrapped(node.expression);
    if (
      ts.isIdentifier(directReceiver) &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression)
    ) {
      const propertyKind = state.principalPropertyBindings.get(
        principalPropertyKey(directReceiver.text, node.argumentExpression.text),
      );
      if (propertyKind) return propertyKind;
    }
    const receiverKind = principalExpressionKind(
      node.expression,
      state,
      derivedExpressions,
    );
    if (receiverKind === "object") {
      return node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "ownerId"
        ? "binding"
        : null;
    }
    return receiverKind === "derived" &&
      node.argumentExpression &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      isPrincipalIdentityKeyName(node.argumentExpression.text)
      ? "derived"
      : null;
  }
  return null;
}

function principalPropertiesForExpression(
  expression,
  state,
  derivedExpressions = null,
) {
  const node = unwrapped(expression);
  if (ts.isIdentifier(node)) {
    return principalPropertiesForRoot(state.principalPropertyBindings, node.text);
  }
  if (!ts.isObjectLiteralExpression(node)) return new Map();
  const properties = new Map();
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spread = principalPropertiesForExpression(
        property.expression,
        state,
        derivedExpressions,
      );
      // A spread overwrites at runtime every key it supplies, so it must revoke the
      // provenance of the keys written before it that it can silently replace. This
      // mirrors principalOwnerAuthorityKind's spread branch: when the spread shape is
      // known, only the keys it can supply lose their earlier proof; when the shape is
      // unknown it could supply anything, so nothing written earlier survives. Keys
      // written after the spread are unaffected, because the loop reaches them later.
      const spreadNames = knownSpreadPropertyNames(property.expression);
      if (spreadNames) {
        for (const name of spreadNames) {
          if (!spread.has(name)) properties.delete(name);
        }
      } else {
        properties.clear();
      }
      for (const [name, kind] of spread) properties.set(name, kind);
      continue;
    }
    if (ts.isComputedPropertyName(property.name)) {
      properties.clear();
      continue;
    }
    const name = propertyNameText(property.name);
    if (!name) {
      properties.clear();
      continue;
    }
    let value = null;
    if (ts.isPropertyAssignment(property)) value = property.initializer;
    else if (ts.isShorthandPropertyAssignment(property)) value = property.name;
    if (!value) {
      properties.delete(name);
      continue;
    }
    const kind = principalExpressionKind(value, state, derivedExpressions);
    if (kind) properties.set(name, kind);
    else properties.delete(name);
  }
  return properties;
}

function principalCollectionExpressionKind(
  expression,
  state,
  derivedExpressions = null,
) {
  const node = unwrapped(expression);
  if (
    !ts.isArrayLiteralExpression(node) ||
    node.elements.length === 0 ||
    node.elements.some(ts.isSpreadElement)
  ) {
    return null;
  }
  return node.elements.every((element) =>
    principalExpressionKind(element, state, derivedExpressions),
  )
    ? "derived"
    : null;
}

function isLiteralValue(expression) {
  const node = unwrapped(expression);
  return (
    ts.isStringLiteralLike(node) ||
    ts.isNumericLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword ||
    node.kind === ts.SyntaxKind.FalseKeyword ||
    node.kind === ts.SyntaxKind.NullKeyword
  );
}

function isImmutablePrincipalObjectDeclaration(
  declaration,
  state,
  frame,
  derivedExpressions,
) {
  if (
    !ts.isIdentifier(declaration.name) ||
    !ts.isVariableDeclarationList(declaration.parent) ||
    !(declaration.parent.flags & ts.NodeFlags.Const)
  ) {
    return false;
  }
  const initializer = declaration.initializer
    ? unwrapped(declaration.initializer)
    : null;
  if (!initializer || !ts.isObjectLiteralExpression(initializer)) return false;
  const valuesAreSafe = initializer.properties.every((property) => {
    if (
      !ts.isPropertyAssignment(property) &&
      !ts.isShorthandPropertyAssignment(property)
    ) {
      return false;
    }
    if (
      ts.isPropertyAssignment(property) &&
      ts.isComputedPropertyName(property.name)
    ) {
      return false;
    }
    const value = ts.isShorthandPropertyAssignment(property)
      ? property.name
      : property.initializer;
    if (isLiteralValue(value)) return true;
    const kind = principalExpressionKind(value, state, derivedExpressions);
    if (kind === "binding") return true;
    if (kind !== "derived") return false;
    const root = rootIdentifier(value);
    return !root || !state.principalDerivedObjects.has(root);
  });
  return (
    valuesAreSafe &&
    bindingIsOnlyObjectSpread(
      frame.node,
      declaration,
      declaration.name.text,
    )
  );
}

function callMemberName(node) {
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return null;
  const expression = unwrapped(node.expression);
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (
    ts.isElementAccessExpression(expression) &&
    expression.argumentExpression &&
    ts.isStringLiteralLike(expression.argumentExpression)
  ) {
    return expression.argumentExpression.text;
  }
  return null;
}

function objectPropertyInitializer(expression, propertyName) {
  const node = unwrapped(expression);
  if (!ts.isObjectLiteralExpression(node)) return null;
  for (const property of node.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      propertyNameText(property.name) === propertyName
    ) {
      return property.initializer;
    }
    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.text === propertyName
    ) {
      return property.name;
    }
  }
  return null;
}

// For direct Prisma calls, trust must reach the authority-bearing subtree. In particular,
// `update({ where: { id: attackerId }, data: { audit: derived.id } })` is not owner-scoped.
// Non-Prisma sensitive surfaces (queue payloads, local/import boundaries) retain the complete
// argument-tree rule because they do not share Prisma's stable `where`/`data` shape.
function operationAuthorityExpressions(node) {
  if (ts.isTaggedTemplateExpression(node)) {
    return ts.isTemplateExpression(node.template)
      ? node.template.templateSpans.map((span) => span.expression)
      : [];
  }
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return [];
  const args = [...(node.arguments ?? [])];
  const member = callMemberName(node);
  if (!member || !PRISMA_CALL_MEMBERS.has(member) || !args.length) return args;
  const authorityProperty =
    member === "create" || member === "createMany" ? "data" : "where";
  const authority = objectPropertyInitializer(args[0], authorityProperty);
  // A pre-built argument object may itself be principal-derived. Keep that narrow case, but do
  // not scan unrelated properties of a visible object literal when its authority key is absent.
  return authority ? [authority] : ts.isIdentifier(unwrapped(args[0])) ? [args[0]] : [];
}

function principalOwnerAuthorityKind(expression, state, derivedExpressions = null) {
  const node = unwrapped(expression);
  if (ts.isIdentifier(node)) {
    const authorityKind = state.principalAuthorityBindings.get(node.text);
    if (authorityKind) return authorityKind;
    const kind = principalExpressionKind(node, state, derivedExpressions);
    if (kind === "object") return "binding";
    if (kind === "derived" && state.principalDerivedObjects.has(node.text)) return "derived";
    return null;
  }
  if (ts.isConditionalExpression(node)) {
    const whenTrueKind = principalOwnerAuthorityKind(
      node.whenTrue,
      state,
      derivedExpressions,
    );
    const whenFalseKind = principalOwnerAuthorityKind(
      node.whenFalse,
      state,
      derivedExpressions,
    );
    if (!whenTrueKind || !whenFalseKind) return null;
    return whenTrueKind === whenFalseKind ? whenTrueKind : "derived";
  }
  if (!ts.isObjectLiteralExpression(node)) return null;
  let ownerKind = null;
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spreadKind = principalOwnerAuthorityKind(
        property.expression,
        state,
        derivedExpressions,
      );
      if (spreadKind) {
        ownerKind = spreadKind;
      } else if (
        !expressionIsOwnerNeutral(
          property.expression,
          state.principalOwnerNeutralBindings,
        )
      ) {
        ownerKind = null;
      }
      continue;
    }
    if (ts.isPropertyAssignment(property)) {
      if (ts.isComputedPropertyName(property.name)) {
        ownerKind = null;
      } else if (propertyNameText(property.name) === "ownerId") {
        const kind = principalExpressionKind(
          property.initializer,
          state,
          derivedExpressions,
        );
        ownerKind = kind === "binding" || kind === "derived" ? kind : null;
      }
    } else if (ts.isShorthandPropertyAssignment(property) && property.name.text === "ownerId") {
      const kind = principalExpressionKind(property.name, state, derivedExpressions);
      ownerKind = kind === "binding" || kind === "derived" ? kind : null;
    }
  }
  return ownerKind;
}

function combinedAuthorityKind(entries) {
  if (!entries.length) return null;
  const first = entries[0].kind;
  return entries.every((entry) => entry.kind === first) ? first : "derived";
}

function knownSpreadPropertyNames(expression) {
  const node = unwrapped(expression);
  if (ts.isConditionalExpression(node)) {
    const whenTrue = knownSpreadPropertyNames(node.whenTrue);
    const whenFalse = knownSpreadPropertyNames(node.whenFalse);
    return whenTrue && whenFalse
      ? new Set([...whenTrue, ...whenFalse])
      : null;
  }
  if (!ts.isObjectLiteralExpression(node)) return null;
  const names = new Set();
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spreadNames = knownSpreadPropertyNames(property.expression);
      if (!spreadNames) return null;
      for (const name of spreadNames) names.add(name);
      continue;
    }
    if (ts.isComputedPropertyName(property.name)) return null;
    const name = propertyNameText(property.name);
    if (!name) return null;
    names.add(name);
  }
  return names;
}

function principalKeyAuthorityEntries(
  expression,
  state,
  derivedExpressions = null,
  identityContext = false,
) {
  const kind = principalExpressionKind(expression, state, derivedExpressions);
  if (kind) return [{ key: null, kind }];
  const node = unwrapped(expression);
  if (ts.isIdentifier(node)) {
    const authorityKind = state.principalAuthorityBindings.get(node.text);
    return authorityKind ? [{ key: "ownerId", kind: authorityKind }] : [];
  }
  if (ts.isConditionalExpression(node)) {
    const ownerKind = principalOwnerAuthorityKind(
      node,
      state,
      derivedExpressions,
    );
    if (ownerKind) return [{ key: "ownerId", kind: ownerKind }];
    const whenTrue = principalKeyAuthorityEntries(
      node.whenTrue,
      state,
      derivedExpressions,
      identityContext,
    );
    const whenFalse = principalKeyAuthorityEntries(
      node.whenFalse,
      state,
      derivedExpressions,
      identityContext,
    );
    if (!whenTrue.length || !whenFalse.length) return [];
    return [{
      key: null,
      kind: combinedAuthorityKind([...whenTrue, ...whenFalse]),
    }];
  }
  if (ts.isArrayLiteralExpression(node)) {
    const entries = [];
    for (const element of node.elements) {
      if (ts.isSpreadElement(element)) continue;
      entries.push(
        ...principalKeyAuthorityEntries(
          element,
          state,
          derivedExpressions,
          identityContext,
        ),
      );
    }
    return entries;
  }
  if (!ts.isObjectLiteralExpression(node)) return [];

  let entries = [];
  const removeOverriddenKey = (key) => {
    const mayOverrideUnknownAuthority =
      key === "AND" ||
      key === "OR" ||
      isPrincipalIdentityKeyName(key);
    entries = entries.filter(
      (entry) =>
        entry.key !== key &&
        !(entry.key === null && mayOverrideUnknownAuthority),
    );
  };
  const addForKey = (key, candidates) => {
    removeOverriddenKey(key);
    const candidateKind = combinedAuthorityKind(candidates);
    if (candidateKind) entries.push({ key, kind: candidateKind });
  };

  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) {
      const spreadEntries = principalKeyAuthorityEntries(
        property.expression,
        state,
        derivedExpressions,
        false,
      );
      const spreadNames = knownSpreadPropertyNames(property.expression);
      if (spreadNames) {
        for (const name of spreadNames) removeOverriddenKey(name);
        entries.push(...spreadEntries);
      } else if (spreadEntries.length) {
        entries = spreadEntries;
      } else if (
        expressionIsOwnerNeutral(
          property.expression,
          state.principalOwnerNeutralBindings,
        )
      ) {
        entries = entries.filter((entry) => entry.key === "ownerId");
      } else {
        entries = [];
      }
      continue;
    }
    if (ts.isComputedPropertyName(property.name)) {
      entries = [];
      continue;
    }
    const propertyName = propertyNameText(property.name);
    if (!propertyName) {
      entries = [];
      continue;
    }
    removeOverriddenKey(propertyName);
    if (
      NON_AUTHORITY_PRISMA_FILTER_OPERATORS.has(propertyName) ||
      (
        identityContext &&
        !POSITIVE_PRISMA_IDENTITY_FILTER_OPERATORS.has(propertyName)
      )
    ) {
      continue;
    }
    if (ts.isPropertyAssignment(property)) {
      if (propertyName === "NOT") continue;
      if (propertyName === "OR") {
        const branches = unwrapped(property.initializer);
        if (
          !ts.isArrayLiteralExpression(branches) ||
          branches.elements.length === 0 ||
          branches.elements.some(ts.isSpreadElement)
        ) {
          continue;
        }
        const branchEntries = branches.elements.map((branch) =>
          principalKeyAuthorityEntries(
            branch,
            state,
            derivedExpressions,
            false,
          ),
        );
        if (branchEntries.some((candidate) => candidate.length === 0)) continue;
        addForKey("OR", branchEntries.flat());
        continue;
      }
      const initializer = unwrapped(property.initializer);
      const initializerKind = principalExpressionKind(
        property.initializer,
        state,
        derivedExpressions,
      );
      const candidates =
        identityContext ||
        propertyName === "AND" ||
        isPrincipalIdentityKeyName(propertyName) ||
        initializerKind === "object" ||
        ts.isObjectLiteralExpression(initializer) ||
        ts.isConditionalExpression(initializer)
          ? principalKeyAuthorityEntries(
              property.initializer,
              state,
              derivedExpressions,
              identityContext ||
                (
                  isPrincipalIdentityKeyName(propertyName) &&
                  !isCompoundPrismaIdentityKeyName(propertyName)
                ),
            )
          : [];
      addForKey(propertyName, candidates);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      const shorthandKind = principalExpressionKind(
        property.name,
        state,
        derivedExpressions,
      );
      const candidates =
        identityContext ||
        isPrincipalIdentityKeyName(propertyName) ||
        shorthandKind === "object"
          ? principalKeyAuthorityEntries(
              property.name,
              state,
              derivedExpressions,
              true,
            )
          : [];
      addForKey(propertyName, candidates);
    }
  }
  return entries;
}

function authorityExpressionKinds(
  expression,
  state,
  derivedExpressions = null,
  out = [],
  principalKeyPathOnly = false,
) {
  if (principalKeyPathOnly) {
    out.push(
      ...principalKeyAuthorityEntries(
        expression,
        state,
        derivedExpressions,
      ).map((entry) => entry.kind),
    );
    return out;
  }
  const kind = principalExpressionKind(expression, state, derivedExpressions);
  if (kind) {
    out.push(kind);
    return out;
  }
  const node = unwrapped(expression);
  if (ts.isIdentifier(node)) {
    const authorityKind = state.principalAuthorityBindings.get(node.text);
    if (authorityKind) out.push(authorityKind);
    return out;
  }
  if (ts.isConditionalExpression(node)) {
    const authorityKind = principalOwnerAuthorityKind(
      node,
      state,
      derivedExpressions,
    );
    if (authorityKind) out.push(authorityKind);
    return out;
  }
  if (ts.isObjectLiteralExpression(node)) {
    const ownerKind = principalOwnerAuthorityKind(node, state, derivedExpressions);
    if (ownerKind) out.push(ownerKind);
    for (const property of node.properties) {
      if (ts.isPropertyAssignment(property)) {
        if (ts.isComputedPropertyName(property.name)) continue;
        const propertyName = propertyNameText(property.name);
        if (propertyName === "ownerId" || propertyName === "NOT") continue;
        if (propertyName === "OR") {
          const branches = unwrapped(property.initializer);
          if (
            !ts.isArrayLiteralExpression(branches) ||
            branches.elements.length === 0 ||
            branches.elements.some(ts.isSpreadElement)
          ) {
            continue;
          }
          const branchKinds = branches.elements.map((branch) =>
            authorityExpressionKinds(branch, state, derivedExpressions, []),
          );
          if (branchKinds.some((kinds) => kinds.length === 0)) continue;
          const allKinds = branchKinds.flat();
          const firstKind = allKinds[0];
          out.push(
            allKinds.every((candidate) => candidate === firstKind)
              ? firstKind
              : "derived",
          );
          continue;
        }
        authorityExpressionKinds(property.initializer, state, derivedExpressions, out);
      } else if (ts.isShorthandPropertyAssignment(property)) {
        if (
          property.name.text === "ownerId" ||
          property.name.text === "OR" ||
          property.name.text === "NOT"
        ) {
          continue;
        }
        authorityExpressionKinds(property.name, state, derivedExpressions, out);
      }
    }
  } else if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) {
      if (!ts.isSpreadElement(element)) {
        authorityExpressionKinds(element, state, derivedExpressions, out);
      }
    }
  }
  return out;
}

function operationUsesPrincipal(node, state, derivedExpressions = null) {
  const principalKeyPathOnly =
    Boolean(callMemberName(node)) &&
    PRISMA_CALL_MEMBERS.has(callMemberName(node));
  const allExpressions =
    ts.isTaggedTemplateExpression(node) || principalKeyPathOnly
      ? operationAuthorityExpressions(node)
      : [...(node.arguments ?? [])];
  if (
    allExpressions.some((argument) =>
      authorityExpressionKinds(
        argument,
        state,
        null,
        [],
        principalKeyPathOnly,
      ).includes("binding"),
    )
  ) {
    return true;
  }
  return operationAuthorityExpressions(node).some(
    (argument) =>
      authorityExpressionKinds(
        argument,
        state,
        derivedExpressions,
        [],
        principalKeyPathOnly,
      ).includes("derived"),
  );
}

function operationReferencesPrincipal(node, state, derivedExpressions = null) {
  const principalKeyPathOnly =
    Boolean(callMemberName(node)) &&
    PRISMA_CALL_MEMBERS.has(callMemberName(node));
  const allExpressions =
    ts.isTaggedTemplateExpression(node) || principalKeyPathOnly
      ? operationAuthorityExpressions(node)
      : [...(node.arguments ?? [])];
  if (
    allExpressions.some((argument) => {
      const kinds = authorityExpressionKinds(
        argument,
        state,
        derivedExpressions,
        [],
        principalKeyPathOnly,
      );
      return kinds.includes("binding") || kinds.includes("object");
    })
  ) {
    return true;
  }
  return operationAuthorityExpressions(node).some(
    (argument) =>
      authorityExpressionKinds(
        argument,
        state,
        derivedExpressions,
        [],
        principalKeyPathOnly,
      ).includes("derived"),
  );
}

function directMemberReference(expression) {
  const node = unwrapped(expression);
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(unwrapped(node.expression))
  ) {
    return {
      root: unwrapped(node.expression).text,
      member: node.name.text,
    };
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isIdentifier(unwrapped(node.expression)) &&
    node.argumentExpression &&
    ts.isStringLiteralLike(node.argumentExpression)
  ) {
    return {
      root: unwrapped(node.expression).text,
      member: node.argumentExpression.text,
    };
  }
  return null;
}

function collectionAssertedNonEmpty(expression, truthy) {
  const node = unwrapped(expression);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return collectionAssertedNonEmpty(node.operand, !truthy);
  }
  if (!ts.isBinaryExpression(node)) return null;
  const lengthRoot = (candidate) => {
    const value = unwrapped(candidate);
    return ts.isPropertyAccessExpression(value) &&
      value.name.text === "length" &&
      ts.isIdentifier(unwrapped(value.expression))
      ? unwrapped(value.expression)
      : null;
  };
  const isZero = (candidate) => {
    const value = unwrapped(candidate);
    return ts.isNumericLiteral(value) && value.text === "0";
  };
  const root =
    (isZero(node.right) && lengthRoot(node.left)) ||
    (isZero(node.left) && lengthRoot(node.right));
  if (!root) return null;
  const equality =
    node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken ||
    node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken;
  const inequality =
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsToken ||
    node.operatorToken.kind === ts.SyntaxKind.ExclamationEqualsEqualsToken;
  return (equality && !truthy) || (inequality && truthy)
    ? { name: root.text, reference: root }
    : null;
}

function booleanBranchFact(expression, truthy) {
  const node = unwrapped(expression);
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken
  ) {
    return booleanBranchFact(node.operand, !truthy);
  }
  return ts.isIdentifier(node) ? { name: node.text, value: truthy } : null;
}

function booleanFactForExpression(expression, state) {
  const node = unwrapped(expression);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (
    ts.isPrefixUnaryExpression(node) &&
    node.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const fact = booleanFactForExpression(node.operand, state);
    return fact === null ? null : !fact;
  }
  return ts.isIdentifier(node) && state.booleanFacts.has(node.text)
    ? state.booleanFacts.get(node.text)
    : null;
}

function isCanonicalDerivedObjectMember(
  expression,
  state,
  derivedObjectExpressions,
) {
  const node = unwrapped(expression);
  if (
    !ts.isPropertyAccessExpression(node) &&
    !ts.isElementAccessExpression(node)
  ) {
    return false;
  }
  const member =
    ts.isPropertyAccessExpression(node)
      ? node.name.text
      : node.argumentExpression &&
          ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
  if (!member || !STORAGE_OWNER_RELATION_MEMBERS.has(member)) return false;
  const receiver = unwrapped(node.expression);
  if (derivedObjectExpressions.has(receiver)) return true;
  return Boolean(
    ts.isIdentifier(receiver) &&
    (
      state.principalObjects.has(receiver.text) ||
      state.principalDerivedObjects.has(receiver.text)
    ),
  );
}

function expressionReferencesAuthorizedSignedMediaKey(expression, state) {
  const node = unwrapped(expression);
  if (ts.isConditionalExpression(node)) {
    return (
      expressionReferencesAuthorizedSignedMediaKey(node.whenTrue, state) &&
      expressionReferencesAuthorizedSignedMediaKey(node.whenFalse, state)
    );
  }
  const member = directMemberReference(node);
  return Boolean(
    member &&
    member.member === "key" &&
    state.authorizedSignedMediaClaims.has(member.root),
  );
}

function operationReferencesAuthorizedSignedMedia(node, state) {
  return Boolean(
    ts.isCallExpression(node) &&
    callMemberName(node) === "get" &&
    node.arguments.length === 1 &&
    expressionReferencesAuthorizedSignedMediaKey(node.arguments[0], state),
  );
}

function storageOwnerExpressionReferencesPrincipal(
  expression,
  state,
  derivedExpressions = null,
) {
  if (!expression) return false;
  const node = unwrapped(expression);
  if (ts.isIdentifier(node)) {
    const kind = principalExpressionKind(node, state, derivedExpressions);
    return kind === "binding" || kind === "derived";
  }
  if (
    !ts.isPropertyAccessExpression(node) &&
    !ts.isElementAccessExpression(node)
  ) {
    return false;
  }
  const member =
    ts.isPropertyAccessExpression(node)
      ? node.name.text
      : ts.isElementAccessExpression(node) &&
          node.argumentExpression &&
          ts.isStringLiteralLike(node.argumentExpression)
        ? node.argumentExpression.text
        : null;
  const receiver = unwrapped(node.expression);
  const directReceiver = ts.isIdentifier(receiver) ? receiver.text : null;
  const relationReceiver = directMemberReference(receiver);
  return Boolean(
    member === "ownerId" &&
    (
      (
        directReceiver &&
        (
          state.principalObjects.has(directReceiver) ||
          state.principalDerivedObjects.has(directReceiver)
        )
      ) ||
      (
        relationReceiver &&
        STORAGE_OWNER_RELATION_MEMBERS.has(relationReceiver.member) &&
        (
          state.principalObjects.has(relationReceiver.root) ||
          state.principalDerivedObjects.has(relationReceiver.root)
        )
      )
    ),
  );
}

function scopedFunctionBindings(node) {
  const functions = new Map();
  if (!node.body || !ts.isBlock(node.body)) return functions;
  for (const statement of node.body.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      functions.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.initializer &&
          isFunctionLike(unwrapped(declaration.initializer))
        ) {
          functions.set(declaration.name.text, unwrapped(declaration.initializer));
        }
      }
    }
  }
  return functions;
}

const REASSIGNED_BINDINGS = new WeakMap();

function visibleScopedBinding(frameNode, reference, name) {
  const position = reference.getStart();
  let current = reference;
  while (current && current !== frameNode) {
    const block = current.parent;
    if (block && ts.isBlock(block)) {
      let candidate = null;
      for (const statement of block.statements) {
        if (
          ts.isFunctionDeclaration(statement) &&
          statement.name?.text === name
        ) {
          candidate ??= { kind: "function", node: statement };
        } else if (
          ts.isVariableStatement(statement) &&
          statement.getStart() <= position
        ) {
          for (const declaration of statement.declarationList.declarations) {
            if (ts.isIdentifier(declaration.name) && declaration.name.text === name) {
              candidate = { kind: "value", declaration };
            }
          }
        }
      }
      if (candidate) return candidate;
    }
    current = current.parent;
  }
  return null;
}

function parameterBinding(node, name) {
  return (node.parameters ?? []).find((parameter) =>
    identifierNames(parameter.name).includes(name),
  ) ?? null;
}

function functionScopedVarBinding(node, name) {
  let found = false;
  const visit = (candidate) => {
    if (found) return;
    if (candidate !== node && isFunctionLike(candidate)) return;
    if (
      ts.isVariableDeclaration(candidate) &&
      ts.isVariableDeclarationList(candidate.parent) &&
      !(candidate.parent.flags & ts.NodeFlags.BlockScoped) &&
      identifierNames(candidate.name).includes(name)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(candidate, visit);
  };
  if (node.body) visit(node.body);
  return found;
}

function frameOwnsIdentifierBinding(frameNode, reference, name) {
  if (
    parameterBinding(frameNode, name) ||
    frameNode.name?.text === name ||
    visibleScopedBinding(frameNode, reference, name) ||
    functionScopedVarBinding(frameNode, name)
  ) {
    return true;
  }
  let current = reference;
  while (current && current !== frameNode) {
    const parent = current.parent;
    if (
      ts.isCatchClause(parent) &&
      parent.variableDeclaration &&
      identifierNames(parent.variableDeclaration.name).includes(name)
    ) {
      return true;
    }
    if (
      (
        ts.isForStatement(parent) ||
        ts.isForInStatement(parent) ||
        ts.isForOfStatement(parent)
      ) &&
      parent.initializer &&
      ts.isVariableDeclarationList(parent.initializer) &&
      parent.initializer.declarations.some((declaration) =>
        identifierNames(declaration.name).includes(name),
      )
    ) {
      return true;
    }
    current = parent;
  }
  return false;
}

function visibleBindingNode(scope, reference, name) {
  const scoped = visibleScopedBinding(scope, reference, name);
  if (scoped?.kind === "value") return scoped.declaration;
  if (scoped?.kind === "function") return scoped.node;
  let current = reference.parent;
  while (current && current !== scope) {
    if (isFunctionLike(current)) {
      const parameter = parameterBinding(current, name);
      if (parameter) return parameter;
      if (current.name?.text === name) return current;
    }
    current = current.parent;
  }
  return null;
}

function identifierMayNameCallback(name) {
  return /(?:callback|handler|listener|mutat(?:e|or)|predicate|visitor|^cb$|^fn$)/iu.test(name);
}

function callMayConsumeCallback(call, argument = null) {
  const member = callMemberName(call);
  const callee = unwrapped(call.expression);
  const callbackIndexes = member
    ? CALLBACK_CONSUMER_ARGUMENT_INDEXES.get(member)
    : (
    ts.isIdentifier(callee) &&
    new Set(["queueMicrotask", "setImmediate", "setInterval", "setTimeout"]).has(callee.text)
      ? new Set([0])
      : null
    );
  if (!callbackIndexes) return false;
  if (!argument) return true;
  const argumentNode = unwrapped(argument);
  const index = [...(call.arguments ?? [])].findIndex(
    (candidate) => candidate === argument || unwrapped(candidate) === argumentNode,
  );
  return callbackIndexes.has(index);
}

function parameterMayBeCallback(parameter) {
  if (!parameter.type) {
    return identifierNames(parameter.name).some(identifierMayNameCallback);
  }
  const type = parameter.type;
  if (ts.isFunctionTypeNode(type) || ts.isConstructorTypeNode(type)) return true;
  if (ts.isUnionTypeNode(type) || ts.isIntersectionTypeNode(type)) {
    return type.types.some((candidate) =>
      parameterMayBeCallback({ type: candidate }),
    );
  }
  if (ts.isTypeReferenceNode(type)) {
    const name = type.typeName.getText();
    return /(?:callback|handler|function|mutator|predicate|listener|fn)/iu.test(name);
  }
  return false;
}

function reassignedBindings(scope) {
  const cached = REASSIGNED_BINDINGS.get(scope);
  if (cached) return cached;
  const reassigned = new Set();
  const visit = (node) => {
    if (
      ts.isBinaryExpression(node) &&
      ts.isAssignmentOperator(node.operatorToken.kind)
    ) {
      for (const name of assignmentTargetRootNames(node.left)) reassigned.add(name);
    }
    if (
      (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
      (node.operator === ts.SyntaxKind.PlusPlusToken ||
        node.operator === ts.SyntaxKind.MinusMinusToken) &&
      ts.isIdentifier(unwrapped(node.operand))
    ) {
      reassigned.add(unwrapped(node.operand).text);
    }
    if (
      ts.isIdentifier(node) &&
      (ts.isForInStatement(node.parent) || ts.isForOfStatement(node.parent)) &&
      node.parent.initializer === node
    ) {
      reassigned.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  REASSIGNED_BINDINGS.set(scope, reassigned);
  return reassigned;
}

function bindingIsReassigned(scope, name) {
  return reassignedBindings(scope).has(name);
}

const ESCAPED_RECEIVERS = new WeakMap();

// A receiver handed to any call, constructor, or spread can be rewritten by an
// opaque mutator (`Object.assign(dispatch, { run: leak })`). Once that happens the
// literal's declared shape is no longer what the member call dispatches to, so the
// declaration-site resolution below must refuse it and fall through to the
// fail-closed net in unresolvedLocalReceiverNames.
function escapedReceiverNames(scope) {
  const cached = ESCAPED_RECEIVERS.get(scope);
  if (cached) return cached;
  const escaped = new Set();
  const visit = (node) => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      for (const argument of node.arguments ?? []) {
        const value = unwrapped(argument);
        if (ts.isIdentifier(value)) escaped.add(value.text);
      }
    }
    if (
      (ts.isSpreadAssignment(node) || ts.isSpreadElement(node)) &&
      ts.isIdentifier(unwrapped(node.expression))
    ) {
      escaped.add(unwrapped(node.expression).text);
    }
    ts.forEachChild(node, visit);
  };
  visit(scope);
  ESCAPED_RECEIVERS.set(scope, escaped);
  return escaped;
}

function memberPathBase(expression) {
  let node = unwrapped(expression);
  while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
    node = unwrapped(node.expression);
  }
  return node;
}

// Resolves the declaration-site initializer of a receiver root that is local to
// this repo. Parameters, imports and globals stay unresolved on purpose.
function localReceiverInitializer(frame, reference, root) {
  if (parameterBinding(frame.node, root)) return null;
  const binding = visibleBindingNode(frame.node, reference, root);
  if (binding) {
    return ts.isVariableDeclaration(binding) && binding.initializer
      ? unwrapped(binding.initializer)
      : null;
  }
  const moduleInitializer = frame.info.localValues.get(root);
  return moduleInitializer ? unwrapped(moduleInitializer) : null;
}

function objectLiteralMemberValue(frame, literal, member) {
  // A spread rebuilds the surface from an unknown source and a computed key hides
  // which slot is written; either makes the whole literal unprovable.
  for (const property of literal.properties) {
    if (ts.isSpreadAssignment(property)) return null;
    if (property.name && ts.isComputedPropertyName(property.name)) return null;
  }
  for (const property of literal.properties) {
    const name = property.name;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteralLike(name))) continue;
    if (name.text !== member) continue;
    if (ts.isMethodDeclaration(property)) return property;
    if (ts.isPropertyAssignment(property)) return unwrapped(property.initializer);
    if (ts.isShorthandPropertyAssignment(property)) {
      return (
        frame.localFunctions.get(name.text) ??
        frame.info.localFunctions.get(name.text) ??
        null
      );
    }
    return null;
  }
  return null;
}

function visibleClassDeclaration(frame, reference, name) {
  let current = reference;
  while (current && current !== frame.node) {
    const block = current.parent;
    if (block && ts.isBlock(block)) {
      for (const statement of block.statements) {
        if (ts.isClassDeclaration(statement) && statement.name?.text === name) {
          return statement;
        }
      }
    }
    current = current.parent;
  }
  for (const statement of frame.info.sourceFile.statements) {
    if (ts.isClassDeclaration(statement) && statement.name?.text === name) {
      return statement;
    }
  }
  return null;
}

function classMethodNode(classNode, member) {
  // Inherited members live in another declaration; never guess at them.
  if (classNode.heritageClauses?.length) return null;
  for (const element of classNode.members) {
    if (element.name && ts.isComputedPropertyName(element.name)) return null;
  }
  for (const element of classNode.members) {
    const name = element.name;
    if (!name || !(ts.isIdentifier(name) || ts.isStringLiteralLike(name))) continue;
    if (name.text !== member) continue;
    if (ts.isMethodDeclaration(element)) return element;
    if (ts.isPropertyDeclaration(element) && element.initializer) {
      return unwrapped(element.initializer);
    }
    return null;
  }
  return null;
}

function localClassMethodNode(frame, reference, constructorExpression, member) {
  const constructorName = unwrapped(constructorExpression);
  if (!ts.isIdentifier(constructorName)) return null;
  const classNode = visibleClassDeclaration(frame, reference, constructorName.text);
  if (!classNode) return null;
  const method = classMethodNode(classNode, member);
  return method && isFunctionLike(method) ? method : null;
}

// A locally declared object literal (or local class instance) whose method forwards
// a tracked capability must not escape the fence the way an imported object surface
// never could. Resolving the member body keeps the precise diagnostic; anything that
// cannot be pinned here falls through to unresolvedLocalReceiverNames.
function localMemberFunctionNode(frame, callee) {
  const node = unwrapped(callee);
  if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
    return null;
  }
  const { members } = memberPath(node);
  if (members.length === 0 || members.some((member) => member === null)) return null;
  const base = memberPathBase(node);
  if (ts.isNewExpression(base)) {
    return members.length === 1
      ? localClassMethodNode(frame, base, base.expression, members[0])
      : null;
  }
  if (!ts.isIdentifier(base)) return null;
  const root = base.text;
  // Reassignment of the root, a member write (`dispatch.run = leak`) or handing the
  // receiver to an opaque mutator all invalidate the declaration-site shape.
  if (bindingIsReassigned(frame.info.sourceFile, root)) return null;
  if (escapedReceiverNames(frame.info.sourceFile).has(root)) return null;
  let value = localReceiverInitializer(frame, node, root);
  if (value && ts.isNewExpression(value)) {
    return members.length === 1
      ? localClassMethodNode(frame, value, value.expression, members[0])
      : null;
  }
  for (const member of members) {
    if (!value || !ts.isObjectLiteralExpression(value)) return null;
    const next = objectLiteralMemberValue(frame, value, member);
    value = next ? unwrapped(next) : null;
  }
  return value && isFunctionLike(value) ? value : null;
}

function makeFrame(
  info,
  node,
  name,
  callbacks = new Map(),
  localFunctions = new Map(),
) {
  return { info, node, name, callbacks, localFunctions };
}

class EntryAnalyzer {
  constructor(project, originInfo, exportName) {
    this.project = project;
    this.originInfo = originInfo;
    this.exportName = exportName;
    this.diagnostics = [];
    this.covered = false;
    this.internalCovered = false;
    this.resolvedCovered = false;
    this.adminCovered = false;
    this.internalAllowed = !originInfo.isEntry;
    this.validatedInputCandidates = new Map();
    this.principalDerivedExpressions = new WeakMap();
    this.principalDerivedObjectExpressions = new WeakSet();
    this.trackedCapabilityExpressions = new WeakSet();
    this.capturedBindingInvalidations = new Map();
    this.callStack = [];
    this.callbackStack = [];
    this.invocationSequence = 0;
    this.structuredCallbackDepth = 0;
    this.originResolvesPrincipal = false;
    this.missingPrincipalBoundaryCount = 0;
    this.missingPrincipalBoundaryRecorded = false;
  }

  addDiagnostic(info, node, reason, detail) {
    this.covered = true;
    const diagnostic = {
      path: this.originInfo.relPath,
      implementationPath: info.relPath,
      exportName: this.exportName,
      line: lineOf(info, node),
      reason,
      detail,
    };
    const key = [
      diagnostic.path,
      diagnostic.exportName,
      diagnostic.reason,
      diagnostic.implementationPath,
      diagnostic.line,
    ].join("\0");
    Object.defineProperty(diagnostic, "key", { value: key, enumerable: false });
    const existingIndex = this.diagnostics.findIndex((entry) => entry.key === key);
    if (existingIndex === -1) {
      this.diagnostics.push(diagnostic);
    } else if (
      diagnostic.implementationPath === this.originInfo.relPath &&
      this.diagnostics[existingIndex].implementationPath !== this.originInfo.relPath
    ) {
      this.diagnostics[existingIndex] = diagnostic;
    }
  }

  reasonForUnguarded(frame, node, state) {
    if (this.hasPriorScopedValidation(frame, node, state)) {
      return REASON.UNPROVABLE;
    }
    if (state.pending.size) return REASON.UNUSED;
    if (state.discardedResolver) return REASON.DISCARDED;
    if (state.shadowedResolver) return REASON.SHADOWED;
    if (this.hasResolverAfter(frame, node.getStart(frame.info.sourceFile))) return REASON.AFTER;
    return REASON.MISSING;
  }

  hasPriorScopedValidation(frame, node, state) {
    const operationNames = new Set();
    for (const authority of operationAuthorityExpressions(node)) {
      const visitAuthority = (child) => {
        if (
          ts.isIdentifier(child) &&
          principalExpressionKind(
            child,
            state,
            this.principalDerivedExpressions,
          ) === null
        ) {
          operationNames.add(child.text);
        }
        ts.forEachChild(child, visitAuthority);
      };
      visitAuthority(authority);
    }
    if (!operationNames.size) return false;

    let found = false;
    const visit = (candidate, root = false) => {
      if (found || candidate.getStart(frame.info.sourceFile) >= node.getStart(frame.info.sourceFile)) {
        return;
      }
      if (!root && isFunctionLike(candidate)) return;
      if (
        ts.isCallExpression(candidate) &&
        (callMemberName(candidate) === "findFirst" ||
          callMemberName(candidate) === "findUnique") &&
        this.project.directSensitiveKind(frame.info, candidate, state) &&
        operationReferencesPrincipal(
          candidate,
          state,
          this.principalDerivedExpressions,
        )
      ) {
        const candidateNames = this.scopedReadClientKeyNames(candidate, state);
        let declaration = candidate.parent;
        while (
          declaration &&
          declaration !== frame.node &&
          !ts.isVariableDeclaration(declaration) &&
          !isFunctionLike(declaration)
        ) {
          declaration = declaration.parent;
        }
        const resultName =
          declaration &&
          ts.isVariableDeclaration(declaration) &&
          ts.isIdentifier(declaration.name)
            ? declaration.name.text
            : null;
        if (
          resultName &&
          this.isDominatedByTruthyBinding(frame, node, resultName) &&
          [...candidateNames].some((name) => operationNames.has(name))
        ) {
          found = true;
          return;
        }
      }
      ts.forEachChild(candidate, (child) => visit(child));
    };
    visit(frame.node, true);
    return found;
  }

  isDominatedByTruthyBinding(frame, node, bindingName) {
    let current = node;
    while (current && current !== frame.node) {
      const parent = current.parent;
      if (
        parent &&
        ts.isIfStatement(parent) &&
        parent.thenStatement === current &&
        this.truthyResultNames(parent.expression, true).has(bindingName)
      ) {
        return true;
      }
      current = parent;
    }
    return false;
  }

  hasResolverAfter(frame, position) {
    let found = false;
    const visit = (node, isRoot = false) => {
      if (found) return;
      if (!isRoot && isFunctionLike(node)) return;
      if (node.getStart(frame.info.sourceFile) > position && ts.isCallExpression(node)) {
        if (this.trustedImportedResolver(frame.info, node) || this.localProducer(frame, node)) {
          found = true;
          return;
        }
      }
      if (ts.isIfStatement(node)) {
        if (node.expression.kind === ts.SyntaxKind.FalseKeyword) {
          if (node.elseStatement) visit(node.elseStatement);
          return;
        }
        if (node.expression.kind === ts.SyntaxKind.TrueKeyword) {
          visit(node.thenStatement);
          return;
        }
      }
      ts.forEachChild(node, (child) => visit(child));
    };
    visit(frame.node, true);
    return found;
  }

  frameContainsPrincipalResolver(frame) {
    let found = false;
    const visit = (node, root = false) => {
      if (found) return;
      if (!root && isFunctionLike(node)) return;
      if (
        ts.isCallExpression(node) &&
        (this.trustedImportedResolver(frame.info, node) || this.localProducer(frame, node))
      ) {
        found = true;
        return;
      }
      ts.forEachChild(node, (child) => visit(child));
    };
    visit(frame.node, true);
    return found;
  }

  recordSensitive(
    frame,
    node,
    states,
    detail,
    reasonOverride = null,
    authorityKind = "principal",
  ) {
    this.covered = true;
    const nextStates = [];
    for (const state of states) {
      if (reasonOverride) {
        this.addDiagnostic(frame.info, node, reasonOverride, detail);
        nextStates.push(state);
        continue;
      }
      if (
        state.resolved &&
        operationReferencesPrincipal(node, state, this.principalDerivedExpressions)
      ) {
        this.resolvedCovered = true;
        nextStates.push(state);
        continue;
      }
      if (
        authorityKind === "storage" &&
        operationReferencesAuthorizedSignedMedia(node, state)
      ) {
        this.resolvedCovered = true;
        nextStates.push(state);
        continue;
      }
      if (state.adminResolved && state.adminPending.size === 0) {
        this.adminCovered = true;
        nextStates.push(state);
        continue;
      }
      if (
        this.internalAllowed &&
        operationUsesPrincipal(node, state, this.principalDerivedExpressions)
      ) {
        this.internalCovered = true;
        nextStates.push(state);
        continue;
      }
      let reason = this.reasonForUnguarded(frame, node, state);
      if (
        this.internalAllowed &&
        reason !== REASON.UNUSED &&
        reason !== REASON.UNPROVABLE &&
        (state.principalBindings.size || state.principalObjects.size)
      ) {
        reason = REASON.PARAM_UNUSED;
      } else if (this.internalAllowed && state.optionalPrincipalParameters.size) {
        reason = REASON.PARAM_OPTIONAL;
      }
      this.addDiagnostic(frame.info, node, reason, detail);
      nextStates.push(state);
    }
    return dedupeStates(nextStates);
  }

  recordDepthLimited(
    frame,
    node,
    states,
    detail,
    { trustedEntryBoundary = false, missingPrincipalBoundary = false } = {},
  ) {
    this.covered = true;
    if (trustedEntryBoundary) {
      this.resolvedCovered = true;
      return states;
    }
    if (
      states.every(
        (state) =>
          state.resolved &&
          operationReferencesPrincipal(node, state, this.principalDerivedExpressions),
      )
    ) {
      this.resolvedCovered = true;
      return states;
    }
    if (
      states.every((state) => state.adminResolved && state.adminPending.size === 0)
    ) {
      this.adminCovered = true;
      return states;
    }
    if (
      this.internalAllowed &&
      states.every((state) =>
        operationUsesPrincipal(node, state, this.principalDerivedExpressions),
      )
    ) {
      this.internalCovered = true;
      return states;
    }
    const recorded = this.recordSensitive(
      frame,
      node,
      states,
      detail,
      REASON.UNPROVABLE,
    );
    if (missingPrincipalBoundary && !this.originResolvesPrincipal) {
      this.missingPrincipalBoundaryCount += 1;
      if (
        this.missingPrincipalBoundaryCount > 1 &&
        !this.missingPrincipalBoundaryRecorded
      ) {
        this.missingPrincipalBoundaryRecorded = true;
        return this.recordSensitive(frame, node, recorded, detail);
      }
    }
    return recorded;
  }

  trustedImportedResolver(info, call) {
    const expression = unwrapped(call.expression);
    if (!ts.isIdentifier(expression)) return null;
    const binding = info.imports.get(expression.text);
    const targetPath = binding
      ? this.project.resolveModuleSpecifier(info, binding.source)
      : null;
    const trustedPath = targetPath
      ? slash(relative(this.project.repoRoot, targetPath))
      : null;
    if (
      !binding ||
      binding.typeOnly ||
      !AUTH_GUARD_EXPORTS.has(binding.imported) ||
      !trustedPath ||
      !this.project.trustedAuthGuardPaths.has(trustedPath)
    ) {
      return null;
    }
    return binding.imported;
  }

  exactImportedCall(frame, call, source, imported) {
    const expression = unwrapped(call.expression);
    if (!ts.isIdentifier(expression)) return false;
    const binding = frame.info.imports.get(expression.text);
    return Boolean(
      binding &&
      !binding.typeOnly &&
      binding.source === source &&
      binding.imported === imported,
    );
  }

  isStorageKeyCall(frame, call) {
    return this.exactImportedCall(frame, call, "@fikirtive/core", "storageKey");
  }

  isProvenPureStorageUrlCall(frame, call, sensitive) {
    if (
      !sensitive?.startsWith("storage ") ||
      callMemberName(call) !== "url" ||
      call.arguments.length !== 1
    ) {
      return false;
    }
    const key = unwrapped(call.arguments[0]);
    return Boolean(
      ts.isCallExpression(key) &&
      key.arguments.length === 3 &&
      this.isStorageKeyCall(frame, key),
    );
  }

  isKeyOwnerMatchesCall(frame, call) {
    return this.exactImportedCall(frame, call, "@fikirtive/core", "keyOwnerMatches");
  }

  isSignedMediaVerifierCall(frame, call) {
    return Boolean(
      call.arguments.length === 2 &&
      this.exactImportedCall(
        frame,
        call,
        "@fikirtive/token-crypto",
        "verifyMediaToken",
      ),
    );
  }

  isModeledPureGlobalCall(frame, call) {
    const expression = unwrapped(call.expression);
    if (
      !ts.isIdentifier(expression) ||
      !MODELED_PURE_CALLBACK_GLOBALS.has(expression.text)
    ) {
      return false;
    }
    return Boolean(
      !frame.info.imports.has(expression.text) &&
      !frame.info.localFunctions.has(expression.text) &&
      !frame.localFunctions.has(expression.text) &&
      !parameterBinding(frame.node, expression.text) &&
      !visibleScopedBinding(frame.node, expression, expression.text),
    );
  }

  isUnshadowedGlobal(frame, expression, name) {
    const node = unwrapped(expression);
    return Boolean(
      ts.isIdentifier(node) &&
      node.text === name &&
      !frame.info.imports.has(name) &&
      !frame.info.localFunctions.has(name) &&
      !frame.localFunctions.has(name) &&
      !parameterBinding(frame.node, name) &&
      !visibleScopedBinding(frame.node, node, name),
    );
  }

  isObjectAssignCall(frame, call) {
    const expression = unwrapped(call.expression);
    return Boolean(
      ts.isCallExpression(call) &&
      ts.isPropertyAccessExpression(expression) &&
      expression.name.text === "assign" &&
      this.isUnshadowedGlobal(frame, expression.expression, "Object"),
    );
  }

  isLocalMapReceiver(frame, expression) {
    const node = unwrapped(expression);
    if (!ts.isIdentifier(node)) return false;
    const binding = visibleScopedBinding(frame.node, node, node.text);
    const initializer =
      binding?.kind === "value"
        ? binding.declaration.initializer
        : frame.info.localValues.get(node.text);
    const value = initializer ? unwrapped(initializer) : null;
    return Boolean(
      value &&
      ts.isNewExpression(value) &&
      this.isUnshadowedGlobal(frame, value.expression, "Map"),
    );
  }

  localProducer(frame, call) {
    const expression = unwrapped(call.expression);
    if (!ts.isIdentifier(expression)) return null;
    if (!LOCAL_PRINCIPAL_PRODUCERS.has(expression.text)) return null;
    const target =
      frame.localFunctions.get(expression.text) ??
      frame.info.localFunctions.get(expression.text);
    return target ? { target, name: expression.text } : null;
  }

  isShadowedResolverCall(frame, call) {
    const expression = unwrapped(call.expression);
    if (!ts.isIdentifier(expression)) return false;
    if (!PRINCIPAL_RESOLUTION_NAMES.includes(expression.text)) return false;
    return !this.trustedImportedResolver(frame.info, call) && !this.localProducer(frame, call);
  }

  resolvedPrincipalExpression(frame, expression, state) {
    const node = unwrapped(expression);
    if (!state.resolved || !ts.isCallExpression(node)) return false;
    return Boolean(this.trustedImportedResolver(frame.info, node) || this.localProducer(frame, node));
  }

  activateIdentifier(states, name) {
    return states;
  }

  recordCapturedBindingInvalidation(frame, reference, name) {
    const binding = visibleBindingNode(
      frame.info.sourceFile,
      reference,
      name,
    );
    if (!binding) return;
    const bindings = this.capturedBindingInvalidations.get(name) ?? new Set();
    bindings.add(binding);
    this.capturedBindingInvalidations.set(name, bindings);
  }

  applyCapturedBindingInvalidations(states, frame, reference) {
    let current = states;
    for (const [name, bindings] of this.capturedBindingInvalidations) {
      const visible = visibleBindingNode(
        frame.info.sourceFile,
        reference,
        name,
      );
      if (visible && bindings.has(visible)) {
        current = this.invalidatePrincipalRoot(current, name);
      }
    }
    return current;
  }

  invalidatePrincipalRoot(
    states,
    name,
    { preserveImmutable = false, recordInvalidation = false } = {},
  ) {
    const nextStates = states.map((state) => {
      if (
        preserveImmutable &&
        state.principalImmutableObjectBindings.has(name)
      ) {
        return state;
      }
      if (
        !principalNameIsTainted(state, name) &&
        !state.principalAliases.has(name) &&
        !state.principalOwnerNeutralBindings.has(name) &&
        !state.knownPrincipalBindings.has(name) &&
        !state.nullableDerivedBindings.has(name) &&
        !state.safeDerivedCollections.has(name) &&
        !state.signedMediaClaims.has(name) &&
        !state.nonNullableSignedMediaClaims.has(name) &&
        !state.authorizedSignedMediaClaims.has(name)
      ) {
        if (!recordInvalidation) return state;
        const next = cloneState(state);
        next.invalidatedPrincipalAliases.add(name);
        return next;
      }
      const next = cloneState(state);
      invalidatePrincipalAlias(next, name);
      return next;
    });
    return nextStates;
  }

  collectionAliasesForState(state, name) {
    const aliases = new Set(principalAliasMembers(state, name));
    const tracked = [...aliases].some(
      (alias) =>
        state.safeDerivedCollections.has(alias) ||
        state.knownNonEmptyCollections.has(alias) ||
        state.definitelyEmptyCollections.has(alias) ||
        state.poisonedCollections.has(alias) ||
        hasPrincipalProperties(
          state.principalCollectionPropertyBindings,
          alias,
        ),
    );
    return tracked ? aliases : new Set();
  }

  markCollectionsPossiblyMutated(states, frame, expressions) {
    const roots = [];
    for (const expression of expressions) {
      const root = rootIdentifierNode(expression);
      if (
        root &&
        visibleBindingNode(frame.info.sourceFile, root, root.text)
      ) {
        roots.push(root.text);
      }
    }
    if (!roots.length) return states;
    return states.map((state) => {
      let next = state;
      for (const root of roots) {
        const aliases = this.collectionAliasesForState(state, root);
        if (!aliases.size) continue;
        if (next === state) next = cloneState(state);
        for (const alias of aliases) {
          next.definitelyEmptyCollections.delete(alias);
        }
      }
      return next;
    });
  }

  // Round 26: sticky collection poison, produced independently of `.push`.
  // `affectedNames` falls back to the bare receiver name when the alias group is not
  // yet tracked (mirrors the push handler at the `.push` site): an untracked receiver
  // such as `new Array(1)` must still be poisonable, because the later trusted push
  // would otherwise bless that same bare name into safeDerivedCollections. The poison
  // entry itself is what makes the name tracked from then on.
  poisonCollectionNames(state, name, tracked) {
    const affectedNames = tracked.size ? tracked : new Set([name]);
    const next = cloneState(state);
    for (const affected of affectedNames) {
      next.poisonedCollections.add(affected);
      next.safeDerivedCollections.delete(affected);
      next.principalDerivedBindings.delete(affected);
      next.principalDerivedObjects.delete(affected);
      next.definitelyEmptyCollections.delete(affected);
    }
    return next;
  }

  // Round 26: an un-modeled member call outside the pure-read allowlist may insert an
  // untrusted element into its receiver, so it poisons the receiver alias group unless
  // every argument is principal-derived. An untracked receiver is only poisoned when
  // the callee receiver is the bare identifier itself — that is the exact shape a later
  // `.push` can bless — so scalar reads through a property chain (`row.asset.ext.foo()`)
  // never strip owner provenance from the chain root.
  poisonMutatedCollectionReceiver(states, frame, receiverExpression, args, memberName = null) {
    const rootNode = rootIdentifierNode(receiverExpression);
    if (!rootNode) return states;
    const root = rootNode.text;
    if (!visibleBindingNode(frame.info.sourceFile, rootNode, root)) return states;
    const bareReceiver = ts.isIdentifier(unwrapped(receiverExpression));
    const rangeOnlySlot = memberName ? RANGE_ONLY_MUTATOR_SLOTS.get(memberName) : null;
    return states.map((state) => {
      const carriesOnlyDerived =
        args.length > 0 &&
        args.every((argument, index) => {
          if (
            rangeOnlySlot &&
            rangeOnlySlot(index) &&
            ts.isNumericLiteral(unwrapped(argument))
          ) {
            return true;
          }
          const kind = principalExpressionKind(
            argument,
            state,
            this.principalDerivedExpressions,
          );
          const objectEscapes = [...escapedAliasIdentifiers(argument)].some(
            (alias) => principalNameIsObjectTainted(state, alias),
          );
          return kind === "derived" && !objectEscapes;
        });
      if (carriesOnlyDerived) return state;
      const tracked = this.collectionAliasesForState(state, root);
      if (!tracked.size && !bareReceiver) return state;
      return this.poisonCollectionNames(state, root, tracked);
    });
  }

  // Round 26: a tracked collection handed to an un-modeled callee may be mutated by
  // an inserting method inside that callee, so its alias group is poisoned on escape.
  // Only already-tracked collections are poisoned here — an arbitrary identifier
  // passed to an opaque call is handled by the existing escape invalidation.
  poisonEscapedCollections(states, frame, expressions) {
    const roots = [];
    for (const expression of expressions) {
      const root = rootIdentifierNode(expression);
      if (root && visibleBindingNode(frame.info.sourceFile, root, root.text)) {
        roots.push(root.text);
      }
    }
    if (!roots.length) return states;
    return states.map((state) => {
      let next = state;
      for (const root of roots) {
        const tracked = this.collectionAliasesForState(state, root);
        if (!tracked.size) continue;
        next = this.poisonCollectionNames(next, root, tracked);
      }
      return next;
    });
  }

  invalidateDirectAlias(states, expression) {
    const name = rootIdentifier(expression);
    if (!name) return states;
    if (!states.some((state) => principalNameIsObjectTainted(state, name))) return states;
    return this.invalidatePrincipalRoot(states, name);
  }

  invalidateEscapedAliases(
    states,
    expression,
    {
      invalidateOwnerNeutral = true,
      preserveImmutableName = null,
    } = {},
  ) {
    let current = states;
    for (const name of escapedAliasIdentifiers(expression)) {
      if (invalidateOwnerNeutral) {
        current = current.map((state) => {
          if (!state.principalOwnerNeutralBindings.has(name)) return state;
          const next = cloneState(state);
          next.principalOwnerNeutralBindings.delete(name);
          return next;
        });
      }
      if (current.some((state) => principalNameIsObjectTainted(state, name))) {
        current = this.invalidatePrincipalRoot(current, name, {
          preserveImmutable: name === preserveImmutableName,
        });
      }
    }
    return current;
  }

  invalidateCallEscapes(states, call, args) {
    let current = states;
    for (const argument of args) {
      current = this.invalidateEscapedAliases(current, argument);
    }
    const called = unwrapped(call.expression);
    if (
      (ts.isPropertyAccessExpression(called) ||
        ts.isElementAccessExpression(called)) &&
      !isKnownReadOnlyPropertyMethodCall(call)
    ) {
      current = this.invalidateDirectAlias(current, called.expression);
    }
    return current;
  }

  mergeCallbackInvalidations(states, callbackExits) {
    const invalidated = new Set();
    for (const state of callbackExits) {
      for (const name of state.invalidatedPrincipalAliases) {
        invalidated.add(name);
      }
    }
    let current = states;
    for (const name of invalidated) {
      current = this.invalidatePrincipalRoot(current, name);
    }
    return current;
  }

  invalidateAllTaintedBindings(states) {
    const tainted = new Set();
    for (const state of states) {
      for (const name of state.principalBindings) tainted.add(name);
      for (const name of state.principalObjects) tainted.add(name);
      for (const name of state.principalDerivedBindings) tainted.add(name);
      for (const name of state.principalDerivedObjects) tainted.add(name);
      for (const name of state.principalAuthorityBindings.keys()) tainted.add(name);
      for (const name of state.principalAliases.keys()) tainted.add(name);
      for (const name of state.signedMediaClaims) tainted.add(name);
      for (const name of state.nonNullableSignedMediaClaims) tainted.add(name);
      for (const name of state.authorizedSignedMediaClaims) tainted.add(name);
    }
    let current = states;
    for (const name of tainted) {
      current = this.invalidatePrincipalRoot(current, name);
    }
    return current;
  }

  recursiveCallCarriesPrincipal(frame, args, states) {
    return states.some((state) =>
      args.some((argument) => {
        const node = unwrapped(argument);
        return Boolean(
          principalExpressionKind(
            node,
            state,
            this.principalDerivedExpressions,
          ) ||
          principalOwnerAuthorityKind(
            node,
            state,
            this.principalDerivedExpressions,
          ) ||
          this.resolvedPrincipalExpression(frame, node, state),
        );
      }),
    );
  }

  callbackArgumentResolution(
    frame,
    expression,
    importDepth = 0,
    seen = new Set(),
    consumerCall = null,
    consumerArgument = expression,
  ) {
    const node = unwrapped(expression);
    const knownCallbackConsumer = Boolean(
      consumerCall && callMayConsumeCallback(consumerCall),
    );
    const callbackPosition = Boolean(
      consumerCall &&
      callMayConsumeCallback(consumerCall, consumerArgument),
    );
    if (knownCallbackConsumer && !callbackPosition) {
      return { kind: "not-callback" };
    }
    if (isFunctionLike(node)) {
      return { kind: "analyzable", node, frame };
    }
    if (!ts.isIdentifier(node)) {
      if (
        callbackPosition &&
        (
          ts.isSpreadElement(node) ||
          ts.isCallExpression(node) ||
          ts.isPropertyAccessExpression(node) ||
          ts.isElementAccessExpression(node) ||
          ts.isConditionalExpression(node)
        )
      ) {
        return { kind: "unresolved" };
      }
      return { kind: "not-callback" };
    }
    if (seen.has(node.text)) return { kind: "unresolved" };
    const nextSeen = new Set(seen);
    nextSeen.add(node.text);
    const plausibleCallback =
      identifierMayNameCallback(node.text) ||
      callbackPosition;

    const parameter = parameterBinding(frame.node, node.text);
    if (parameter) {
      const mapped = frame.callbacks.get(node.text);
      if (
        mapped &&
        !bindingIsReassigned(frame.node, node.text, parameter.name)
      ) {
        return {
          kind: "analyzable",
          node: mapped.node,
          frame: mapped.callerFrame ?? frame,
        };
      }
      return parameterMayBeCallback(parameter) || plausibleCallback
        ? { kind: "unresolved" }
        : { kind: "not-callback" };
    }

    const scopedBinding = visibleScopedBinding(frame.node, node, node.text);
    if (scopedBinding?.kind === "value") {
      const { declaration } = scopedBinding;
      if (
        bindingIsReassigned(frame.node, node.text, declaration.name) ||
        !declaration.initializer
      ) {
        return plausibleCallback
          ? { kind: "unresolved" }
          : { kind: "not-callback" };
      }
      const initializer = unwrapped(declaration.initializer);
      if (isFunctionLike(initializer)) {
        return { kind: "analyzable", node: initializer, frame };
      }
      if (ts.isIdentifier(initializer)) {
        return this.callbackArgumentResolution(
          frame,
          initializer,
          importDepth,
          nextSeen,
          consumerCall,
          consumerArgument,
        );
      }
      if (
        ts.isCallExpression(initializer) ||
        ts.isPropertyAccessExpression(initializer) ||
        ts.isElementAccessExpression(initializer) ||
        ts.isConditionalExpression(initializer)
      ) {
        return plausibleCallback
          ? { kind: "unresolved" }
          : { kind: "not-callback" };
      }
      return { kind: "not-callback" };
    }
    if (scopedBinding?.kind === "function") {
      if (bindingIsReassigned(frame.node, node.text)) {
        return { kind: "unresolved" };
      }
      return { kind: "analyzable", node: scopedBinding.node, frame };
    }

    const inheritedFunction = frame.localFunctions.get(node.text);
    if (inheritedFunction) {
      if (bindingIsReassigned(frame.node, node.text)) {
        return { kind: "unresolved" };
      }
      return { kind: "analyzable", node: inheritedFunction, frame };
    }

    const imported = frame.info.imports.get(node.text);
    if (imported && !imported.typeOnly) {
      if (!plausibleCallback) return { kind: "not-callback" };
      if (
        importDepth >= MAX_SAME_PACKAGE_IMPORT_DEPTH ||
        bindingIsReassigned(frame.info.sourceFile, node.text)
      ) {
        return { kind: "unresolved" };
      }
      const targetPath = this.project.resolveModuleSpecifier(
        frame.info,
        imported.source,
      );
      const targetInfo = targetPath
        ? this.project.getModule(targetPath)
        : null;
      const target = targetInfo
        ? this.project.exportTargets(targetInfo).get(imported.imported)
        : null;
      if (
        !targetInfo ||
        !target ||
        target.unknown ||
        target.info.path !== targetInfo.path ||
        !Array.isArray(target.localBindings) ||
        target.localBindings.some((name) =>
          bindingIsReassigned(targetInfo.sourceFile, name)
        ) ||
        !isFunctionLike(unwrapped(target.node))
      ) {
        return { kind: "unresolved" };
      }
      const targetNode = unwrapped(target.node);
      const callbackFrame = makeFrame(
        targetInfo,
        targetNode,
        imported.imported,
        new Map(),
        new Map(targetInfo.localFunctions),
      );
      return {
        kind: "analyzable",
        node: targetNode,
        frame: callbackFrame,
        importDepth: importDepth + 1,
      };
    }

    const moduleInitializer = frame.info.localValues.get(node.text);
    if (moduleInitializer) {
      if (bindingIsReassigned(frame.info.sourceFile, node.text)) {
        return { kind: "unresolved" };
      }
      const initializer = unwrapped(moduleInitializer);
      if (isFunctionLike(initializer)) {
        const callbackFrame = makeFrame(
          frame.info,
          initializer,
          node.text,
          new Map(),
          new Map(frame.info.localFunctions),
        );
        return { kind: "analyzable", node: initializer, frame: callbackFrame };
      }
      if (ts.isIdentifier(initializer)) {
        return this.callbackArgumentResolution(
          frame,
          initializer,
          importDepth,
          nextSeen,
          consumerCall,
          consumerArgument,
        );
      }
      if (
        ts.isCallExpression(initializer) ||
        ts.isPropertyAccessExpression(initializer) ||
        ts.isElementAccessExpression(initializer) ||
        ts.isConditionalExpression(initializer)
      ) {
        return plausibleCallback
          ? { kind: "unresolved" }
          : { kind: "not-callback" };
      }
      return { kind: "not-callback" };
    }

    const moduleFunction = frame.info.localFunctions.get(node.text);
    if (moduleFunction) {
      if (bindingIsReassigned(frame.info.sourceFile, node.text, moduleFunction.name ?? null)) {
        return { kind: "unresolved" };
      }
      const callbackFrame = makeFrame(
        frame.info,
        moduleFunction,
        node.text,
        new Map(),
        new Map(frame.info.localFunctions),
      );
      return { kind: "analyzable", node: moduleFunction, frame: callbackFrame };
    }

    if (MODELED_PURE_CALLBACK_GLOBALS.has(node.text)) {
      return { kind: "not-callback" };
    }
    return plausibleCallback
      ? { kind: "unresolved" }
      : { kind: "not-callback" };
  }

  recursiveStructuredCarrierUsage(frame, argumentIndex) {
    const parameter = frame.node.parameters?.[argumentIndex];
    if (!parameter || !ts.isIdentifier(parameter.name)) {
      return { calledProperties: new Set(), hasUnknownCall: false };
    }
    const parameterName = parameter.name.text;
    const calledProperties = new Set();
    let hasUnknownCall = false;
    const visit = (node) => {
      if (isFunctionLike(node)) return;
      if (ts.isCallExpression(node)) {
        const callee = unwrapped(node.expression);
        if (
          ts.isPropertyAccessExpression(callee) &&
          rootIdentifier(callee.expression) === parameterName
        ) {
          calledProperties.add(callee.name.text);
        } else if (
          ts.isElementAccessExpression(callee) &&
          rootIdentifier(callee.expression) === parameterName
        ) {
          if (
            callee.argumentExpression &&
            ts.isStringLiteralLike(callee.argumentExpression)
          ) {
            calledProperties.add(callee.argumentExpression.text);
          } else {
            hasUnknownCall = true;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    if (frame.node.body) ts.forEachChild(frame.node.body, visit);
    return { calledProperties, hasUnknownCall };
  }

  async analyzeRecursiveStructuredCallbackArguments(
    frame,
    args,
    states,
    importDepth,
  ) {
    let current = states;
    for (let argumentIndex = 0; argumentIndex < args.length; argumentIndex += 1) {
      const argument = args[argumentIndex];
      const argumentNode = unwrapped(argument);
      if (!ts.isObjectLiteralExpression(argumentNode)) continue;
      const carrierUsage = this.recursiveStructuredCarrierUsage(
        frame,
        argumentIndex,
      );
      if (carrierUsage.hasUnknownCall) {
        return this.invalidateAllTaintedBindings(current);
      }
      for (const property of argumentNode.properties) {
        let propertyName = null;
        let callbackExpression = null;
        let callbackCandidate = false;
        let failIfUnresolved = false;
        if (
          ts.isPropertyAssignment(property) &&
          !ts.isComputedPropertyName(property.name)
        ) {
          propertyName = propertyNameText(property.name);
          callbackExpression = property.initializer;
          const initializer = unwrapped(property.initializer);
          callbackCandidate =
            isFunctionLike(initializer) ||
            ts.isIdentifier(initializer) ||
            Boolean(propertyName && identifierMayNameCallback(propertyName)) ||
            ts.isCallExpression(initializer) ||
            ts.isPropertyAccessExpression(initializer) ||
            ts.isElementAccessExpression(initializer) ||
            ts.isConditionalExpression(initializer);
          failIfUnresolved =
            !ts.isIdentifier(initializer) ||
            Boolean(propertyName && identifierMayNameCallback(propertyName)) ||
            (
              ts.isIdentifier(initializer) &&
              identifierMayNameCallback(initializer.text)
            );
        } else if (
          ts.isMethodDeclaration(property) &&
          !ts.isComputedPropertyName(property.name)
        ) {
          propertyName = propertyNameText(property.name);
          callbackExpression = property;
          callbackCandidate = true;
          failIfUnresolved = true;
        } else if (ts.isShorthandPropertyAssignment(property)) {
          propertyName = property.name.text;
          callbackExpression = property.name;
          callbackCandidate = true;
          failIfUnresolved = identifierMayNameCallback(propertyName);
        } else {
          return this.invalidateAllTaintedBindings(current);
        }
        if (
          propertyName &&
          carrierUsage.calledProperties.has(propertyName)
        ) {
          callbackCandidate = true;
          failIfUnresolved = true;
        }
        if (!callbackCandidate || !propertyName || !callbackExpression) continue;
        const resolution = this.callbackArgumentResolution(
          frame,
          callbackExpression,
          importDepth,
        );
        if (resolution.kind !== "analyzable") {
          if (failIfUnresolved) {
            return this.invalidateAllTaintedBindings(current);
          }
          continue;
        }
        const callbackAnalysis = await this.analyzeCallback(
          resolution.node,
          current,
          resolution.frame,
          resolution.importDepth ?? importDepth,
        );
        current = this.mergeCallbackInvalidations(
          current,
          callbackAnalysis.exits,
        );
      }
    }
    return current;
  }

  adminNonErrorNames(expression, truthy) {
    const node = unwrapped(expression);
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.ExclamationToken
    ) {
      return this.adminNonErrorNames(node.operand, !truthy);
    }
    if (
      !truthy &&
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      ts.isStringLiteralLike(unwrapped(node.left)) &&
      unwrapped(node.left).text === "error" &&
      ts.isIdentifier(unwrapped(node.right))
    ) {
      return new Set([unwrapped(node.right).text]);
    }
    return new Set();
  }

  applyAdminNonErrorBranch(states, expression, truthy) {
    const names = this.adminNonErrorNames(expression, truthy);
    if (!names.size) return states;
    return states.map((state) => {
      const next = cloneState(state);
      for (const name of names) {
        if (!next.adminPending.has(name)) continue;
        next.adminPending.delete(name);
        next.pending.delete(name);
      }
      return next;
    });
  }

  applySignedMediaTruthiness(states, expression, truthy) {
    const names = this.truthyResultNames(expression, truthy);
    if (!names.size) return states;
    return states.map((state) => {
      const next = cloneState(state);
      for (const name of names) {
        if (next.signedMediaClaims.has(name)) {
          next.nonNullableSignedMediaClaims.add(name);
        }
      }
      return next;
    });
  }

  applyBooleanFactBranch(states, expression, truthy) {
    const fact = booleanBranchFact(expression, truthy);
    if (!fact) return states;
    const correlated = states
      .filter(
        (state) =>
          !state.booleanFacts.has(fact.name) ||
          state.booleanFacts.get(fact.name) === fact.value,
      )
      .map((state) => {
        const next = cloneState(state);
        next.booleanFacts.set(fact.name, fact.value);
        return next;
      });
    if (correlated.length) return correlated;
    return states.map((state) => {
      const next = cloneState(state);
      next.booleanFacts.delete(fact.name);
      return next;
    });
  }

  applyQueueTruthiness(states, expression, truthy) {
    const fact = booleanBranchFact(expression, truthy);
    if (
      !fact ||
      !states.some((state) => state.queueBindings.has(fact.name)) ||
      !states.some((state) => state.nullableDerivedBindings.has(fact.name))
    ) {
      return states;
    }
    return states.filter((state) => {
      const queue = state.queueBindings.has(fact.name);
      const nullable = state.nullableDerivedBindings.has(fact.name);
      if (!queue && !nullable) return true;
      return fact.value ? queue : nullable;
    });
  }

  applyOwnerMatchBranch(states, frame, expression, truthy) {
    const node = unwrapped(expression);
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.ExclamationToken
    ) {
      return this.applyOwnerMatchBranch(states, frame, node.operand, !truthy);
    }
    if (
      !truthy ||
      !ts.isCallExpression(node) ||
      !this.isKeyOwnerMatchesCall(frame, node) ||
      node.arguments.length !== 2
    ) {
      return states;
    }
    const keyExpression = unwrapped(node.arguments[0]);
    const ownerExpression = unwrapped(node.arguments[1]);
    return states.map((state) => {
      const next = cloneState(state);
      if (
        ts.isIdentifier(keyExpression) &&
        principalExpressionKind(
          ownerExpression,
          state,
          this.principalDerivedExpressions,
        )
      ) {
        next.principalDerivedBindings.add(keyExpression.text);
        return next;
      }
      const keyMember = directMemberReference(keyExpression);
      const ownerMember = directMemberReference(ownerExpression);
      if (
        keyMember &&
        ownerMember &&
        keyMember.root === ownerMember.root &&
        keyMember.member === "key" &&
        ownerMember.member === "ownerId" &&
        state.nonNullableSignedMediaClaims.has(keyMember.root)
      ) {
        next.authorizedSignedMediaClaims.add(keyMember.root);
      }
      return next;
    });
  }

  applyResolverUse(states, context, resolverName) {
    const isAdmin = ADMIN_GUARD_EXPORTS.has(resolverName);
    return states.map((state) => {
      const next = cloneState(state);
      if (context.kind === "discarded") {
        next.discardedResolver = true;
      } else if (context.kind === "assigned" && context.name) {
        next.pending.add(context.name);
        next.principalObjects.add(context.name);
        next.resolved = true;
        if (isAdmin) {
          next.adminResolved = true;
          next.adminPending.add(context.name);
        }
      } else if (context.kind === "destructured") {
        if (isAdmin || !context.ownerNames?.length) {
          next.discardedResolver = true;
        } else {
          next.resolved = true;
          for (const name of context.ownerNames) {
            next.pending.add(name);
            next.principalBindings.add(name);
          }
        }
      } else {
        if (isAdmin) {
          next.discardedResolver = true;
        } else {
          next.resolved = true;
        }
      }
      return next;
    });
  }

  async asyncExpression(node, states, frame, context, importDepth) {
    if (!node) return states;
    const expression = unwrapped(node);
    states = this.applyCapturedBindingInvalidations(
      states,
      frame,
      expression,
    );

    if (ts.isIdentifier(expression)) {
      return this.activateIdentifier(states, expression.text);
    }
    if (
      ts.isStringLiteralLike(expression) ||
      ts.isNumericLiteral(expression) ||
      expression.kind === ts.SyntaxKind.TrueKeyword ||
      expression.kind === ts.SyntaxKind.FalseKeyword ||
      expression.kind === ts.SyntaxKind.NullKeyword ||
      expression.kind === ts.SyntaxKind.ThisKeyword ||
      expression.kind === ts.SyntaxKind.SuperKeyword
    ) {
      return states;
    }
    if (isFunctionLike(expression) || ts.isClassExpression(expression)) return states;

    if (ts.isCallExpression(expression) || ts.isNewExpression(expression)) {
      return this.analyzeCall(expression, states, frame, context, importDepth);
    }

    if (ts.isTaggedTemplateExpression(expression)) {
      let current = await this.asyncExpression(
        expression.tag,
        states,
        frame,
        { kind: "consumed" },
        importDepth,
      );
      current = await this.analyzeTemplate(expression.template, current, frame, importDepth);
      const sensitive = this.project.directSensitiveKind(frame.info, expression, current[0] ?? createState(frame.info));
      if (sensitive) current = this.recordSensitive(frame, expression, current, sensitive);
      return current;
    }

    if (ts.isPropertyAccessExpression(expression)) {
      return this.asyncExpression(
        expression.expression,
        states,
        frame,
        { kind: "consumed" },
        importDepth,
      );
    }
    if (ts.isElementAccessExpression(expression)) {
      let current = await this.asyncExpression(
        expression.expression,
        states,
        frame,
        { kind: "consumed" },
        importDepth,
      );
      if (expression.argumentExpression) {
        current = await this.asyncExpression(
          expression.argumentExpression,
          current,
          frame,
          { kind: "consumed" },
          importDepth,
        );
      }
      return current;
    }
    if (ts.isBinaryExpression(expression)) {
      let current = await this.asyncExpression(
        expression.left,
        states,
        frame,
        { kind: "consumed" },
        importDepth,
      );
      if (
        expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
        expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
        expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
      ) {
        const right = await this.asyncExpression(
          expression.right,
          current.map(cloneState),
          frame,
          { kind: "consumed" },
          importDepth,
        );
        return dedupeStates([...current, ...right]);
      }
      const right = await this.asyncExpression(
        expression.right,
        current,
        frame,
        { kind: "consumed" },
        importDepth,
      );
      const assignmentTarget = unwrapped(expression.left);
      if (
        ts.isAssignmentOperator(expression.operatorToken.kind) &&
        (ts.isPropertyAccessExpression(assignmentTarget) ||
          ts.isElementAccessExpression(assignmentTarget))
      ) {
        const mutatedRootNode = rootIdentifierNode(assignmentTarget);
        const mutatedRoot = mutatedRootNode?.text ?? null;
        if (mutatedRoot) {
          const capturedWrite = !frameOwnsIdentifierBinding(
            frame.node,
            mutatedRootNode,
            mutatedRoot,
          );
          if (capturedWrite) {
            this.recordCapturedBindingInvalidation(
              frame,
              mutatedRootNode,
              mutatedRoot,
            );
          }
          const assigned = right.map((state) => {
            if (
              !this.expressionContainsTrackedCapability(
                frame,
                expression.right,
                state,
              )
            ) {
              return state;
            }
            const next = cloneState(state);
            next.dbBindings.add(mutatedRoot);
            return next;
          });
          const collectionUpdated = assigned.map((state) => {
            if (!ts.isElementAccessExpression(assignmentTarget)) return state;
            const collectionNames = this.collectionAliasesForState(
              state,
              mutatedRoot,
            );
            if (!collectionNames.size) return state;
            const next = cloneState(state);
            const carriesDerived =
              principalExpressionKind(
                expression.right,
                state,
                this.principalDerivedExpressions,
              ) === "derived";
            for (const name of collectionNames) {
              next.definitelyEmptyCollections.delete(name);
              if (!carriesDerived) next.poisonedCollections.add(name);
            }
            return next;
          });
          return this.invalidatePrincipalRoot(collectionUpdated, mutatedRoot, {
            recordInvalidation: capturedWrite,
          });
        }
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        (
          ts.isObjectLiteralExpression(assignmentTarget) ||
          ts.isArrayLiteralExpression(assignmentTarget)
        )
      ) {
        const assignedNames = assignmentTargetRootNames(assignmentTarget);
        let invalidated = right;
        for (const name of assignedNames) {
          invalidated = this.invalidatePrincipalRoot(invalidated, name);
        }
        return invalidated.map((state) => {
          const next = cloneState(state);
          for (const name of assignedNames) {
            detachPrincipalAlias(next, name);
            clearPrincipalName(next, name);
          }
          return next;
        });
      }
      if (
        expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(unwrapped(expression.left))
      ) {
        const assignedTarget = unwrapped(expression.left);
        const assignedName = assignedTarget.text;
        const aliasSource = directAliasIdentifier(expression.right);
        const capturedWrite = !frameOwnsIdentifierBinding(
          frame.node,
          assignedTarget,
          assignedName,
        );
        if (capturedWrite) {
          this.recordCapturedBindingInvalidation(
            frame,
            assignedTarget,
            assignedName,
          );
        }
        const assignmentStates = capturedWrite
          ? this.invalidatePrincipalRoot(right, assignedName, {
              recordInvalidation: true,
            })
          : right;
        return assignmentStates.map((state, index) => {
          const sourceState = right[index] ?? state;
          const next = cloneState(state);
          detachPrincipalAlias(next, assignedName);
          clearPrincipalName(next, assignedName);
          next.queueBindings.delete(assignedName);
          if (this.expressionTaintsQueue(frame, expression.right, sourceState)) {
            next.queueBindings.add(assignedName);
          }
          const kind = principalExpressionKind(
            expression.right,
            sourceState,
            this.principalDerivedExpressions,
          );
          const rightNode = unwrapped(expression.right);
          const authorityKind =
            ts.isObjectLiteralExpression(rightNode) ||
            (aliasSource && sourceState.principalAuthorityBindings.has(aliasSource))
              ? principalOwnerAuthorityKind(
                  expression.right,
                  sourceState,
                  this.principalDerivedExpressions,
                )
              : null;
          const ownerNeutral = expressionIsOwnerNeutral(
            expression.right,
            sourceState.principalOwnerNeutralBindings,
          );
          if (kind === "binding") {
            next.principalBindings.add(assignedName);
            next.knownPrincipalBindings.add(assignedName);
          } else if (kind === "object") {
            next.principalObjects.add(assignedName);
          } else if (kind === "derived") {
            next.principalDerivedBindings.add(assignedName);
          }
          if (authorityKind) {
            next.principalAuthorityBindings.set(assignedName, authorityKind);
          }
          if (this.project.isWorkspacePackageModule(frame.info)) {
            for (const [propertyName, propertyKind] of principalPropertiesForExpression(
              expression.right,
              sourceState,
              this.principalDerivedExpressions,
            )) {
              next.principalPropertyBindings.set(
                principalPropertyKey(assignedName, propertyName),
                propertyKind,
              );
            }
          }
          if (ownerNeutral) next.principalOwnerNeutralBindings.add(assignedName);
          if (aliasSource && principalNameIsObjectTainted(sourceState, aliasSource)) {
            copySignedMediaTrust(next, sourceState, aliasSource, assignedName);
            if (kind === "derived") next.principalDerivedObjects.add(assignedName);
            linkPrincipalAliases(next, assignedName, aliasSource);
          }
          return next;
        });
      }
      if (
        ts.isAssignmentOperator(expression.operatorToken.kind) &&
        ts.isIdentifier(unwrapped(expression.left))
      ) {
        const assignedTarget = unwrapped(expression.left);
        const assignedName = assignedTarget.text;
        const capturedWrite = !frameOwnsIdentifierBinding(
          frame.node,
          assignedTarget,
          assignedName,
        );
        if (capturedWrite) {
          this.recordCapturedBindingInvalidation(
            frame,
            assignedTarget,
            assignedName,
          );
        }
        const assignmentStates = capturedWrite
          ? this.invalidatePrincipalRoot(right, assignedName, {
              recordInvalidation: true,
            })
          : right;
        return assignmentStates.map((state) => {
          const next = cloneState(state);
          detachPrincipalAlias(next, assignedName);
          clearPrincipalName(next, assignedName);
          return next;
        });
      }
      return right;
    }
    if (ts.isConditionalExpression(expression)) {
      const condition = await this.asyncExpression(
        expression.condition,
        states,
        frame,
        { kind: "consumed" },
        importDepth,
      );
      const whenTrue = await this.asyncExpression(
        expression.whenTrue,
        condition.map(cloneState),
        frame,
        context,
        importDepth,
      );
      const whenFalse = await this.asyncExpression(
        expression.whenFalse,
        condition.map(cloneState),
        frame,
        context,
        importDepth,
      );
      return dedupeStates([...whenTrue, ...whenFalse]);
    }
    if (ts.isPrefixUnaryExpression(expression) || ts.isPostfixUnaryExpression(expression)) {
      const operand = expression.operand;
      const current = await this.asyncExpression(
        operand,
        states,
        frame,
        context,
        importDepth,
      );
      const mutatesOperand =
        expression.operator === ts.SyntaxKind.PlusPlusToken ||
        expression.operator === ts.SyntaxKind.MinusMinusToken;
      if (!mutatesOperand) return current;
      const target = unwrapped(operand);
      if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
        const mutatedRootNode = rootIdentifierNode(target);
        const mutatedRoot = mutatedRootNode?.text ?? null;
        if (!mutatedRoot) return current;
        const capturedWrite = !frameOwnsIdentifierBinding(
          frame.node,
          mutatedRootNode,
          mutatedRoot,
        );
        if (capturedWrite) {
          this.recordCapturedBindingInvalidation(
            frame,
            mutatedRootNode,
            mutatedRoot,
          );
        }
        return this.invalidatePrincipalRoot(current, mutatedRoot, {
          recordInvalidation: capturedWrite,
        });
      }
      if (ts.isIdentifier(target)) {
        const capturedWrite = !frameOwnsIdentifierBinding(
          frame.node,
          target,
          target.text,
        );
        if (capturedWrite) {
          this.recordCapturedBindingInvalidation(
            frame,
            target,
            target.text,
          );
        }
        const assignmentStates = capturedWrite
          ? this.invalidatePrincipalRoot(current, target.text, {
              recordInvalidation: true,
            })
          : current;
        return assignmentStates.map((state) => {
          const next = cloneState(state);
          detachPrincipalAlias(next, target.text);
          clearPrincipalName(next, target.text);
          return next;
        });
      }
      return current;
    }
    if (ts.isDeleteExpression(expression)) {
      const current = await this.asyncExpression(
        expression.expression,
        states,
        frame,
        context,
        importDepth,
      );
      const target = unwrapped(expression.expression);
      if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
        const mutatedRootNode = rootIdentifierNode(target);
        const mutatedRoot = mutatedRootNode?.text ?? null;
        if (!mutatedRoot) return current;
        const capturedWrite = !frameOwnsIdentifierBinding(
          frame.node,
          mutatedRootNode,
          mutatedRoot,
        );
        if (capturedWrite) {
          this.recordCapturedBindingInvalidation(
            frame,
            mutatedRootNode,
            mutatedRoot,
          );
        }
        return this.invalidatePrincipalRoot(current, mutatedRoot, {
          recordInvalidation: capturedWrite,
        });
      }
      return current;
    }
    if (ts.isTypeOfExpression(expression) || ts.isVoidExpression(expression)) {
      return this.asyncExpression(
        expression.operand ?? expression.expression,
        states,
        frame,
        expression.kind === ts.SyntaxKind.VoidExpression ? { kind: "discarded" } : context,
        importDepth,
      );
    }
    if (ts.isObjectLiteralExpression(expression)) {
      let current = states;
      for (const property of expression.properties) {
        if (ts.isPropertyAssignment(property)) {
          if (ts.isComputedPropertyName(property.name)) {
            current = await this.asyncExpression(
              property.name.expression,
              current,
              frame,
              { kind: "consumed" },
              importDepth,
            );
          }
          current = await this.asyncExpression(
            property.initializer,
            current,
            frame,
            { kind: "consumed" },
            importDepth,
          );
        } else if (ts.isShorthandPropertyAssignment(property)) {
          current = this.activateIdentifier(current, property.name.text);
        } else if (ts.isSpreadAssignment(property)) {
          current = await this.asyncExpression(
            property.expression,
            current,
            frame,
            { kind: "consumed" },
            importDepth,
          );
          const spread = unwrapped(property.expression);
          current = this.invalidateEscapedAliases(current, property.expression, {
            invalidateOwnerNeutral: false,
            preserveImmutableName: ts.isIdentifier(spread) ? spread.text : null,
          });
        }
      }
      if (context.kind === "assigned") {
        current = this.invalidateEscapedAliases(current, expression, {
          invalidateOwnerNeutral: false,
        });
      }
      return current;
    }
    if (ts.isArrayLiteralExpression(expression)) {
      let current = states;
      for (const element of expression.elements) {
        current = await this.asyncExpression(
          element,
          current,
          frame,
          { kind: "consumed" },
          importDepth,
        );
      }
      if (context.kind === "assigned") {
        current = this.invalidateEscapedAliases(current, expression, {
          invalidateOwnerNeutral: false,
        });
      }
      return current;
    }
    if (ts.isTemplateExpression(expression)) {
      return this.analyzeTemplate(expression, states, frame, importDepth);
    }
    if (ts.isYieldExpression(expression)) {
      return expression.expression
        ? this.asyncExpression(expression.expression, states, frame, context, importDepth)
        : states;
    }

    let current = states;
    for (const child of expression.getChildren(frame.info.sourceFile)) {
      if (child === expression) continue;
      current = await this.asyncExpression(
        child,
        current,
        frame,
        { kind: "consumed" },
        importDepth,
      );
    }
    return current;
  }

  async analyzeTemplate(template, states, frame, importDepth) {
    if (!ts.isTemplateExpression(template)) return states;
    let current = states;
    for (const span of template.templateSpans) {
      current = await this.asyncExpression(
        span.expression,
        current,
        frame,
        { kind: "consumed" },
        importDepth,
      );
    }
    if (
      this.project.isWorkspacePackageModule(frame.info) &&
      states.length > 0 &&
      states.every((state) =>
        template.templateSpans.some((span) => {
          const kind = principalExpressionKind(
            span.expression,
            state,
            this.principalDerivedExpressions,
          );
          return kind === "binding" || kind === "derived";
        }),
      )
    ) {
      this.principalDerivedExpressions.set(template, "derived");
    }
    return current;
  }

  callBinding(frame, call) {
    const expression = unwrapped(call.expression);
    if (ts.isIdentifier(expression)) {
      const callback = frame.callbacks.get(expression.text);
      if (callback) return { kind: "callback", ...callback, name: expression.text };
      const local =
        frame.localFunctions.get(expression.text) ??
        frame.info.localFunctions.get(expression.text);
      if (local) return { kind: "local", info: frame.info, node: local, name: expression.text };
      const imported = frame.info.imports.get(expression.text);
      if (imported && !imported.typeOnly) {
        const targetPath = this.project.resolveModuleSpecifier(frame.info, imported.source);
        const targetInfo = targetPath ? this.project.getModule(targetPath) : null;
        const target = targetInfo
          ? this.project.exportTargets(targetInfo).get(imported.imported)
          : null;
        return {
          kind: "import",
          binding: imported,
          targetInfo,
          target,
          name: imported.imported,
        };
      }
      return null;
    }

    if (ts.isPropertyAccessExpression(expression)) {
      const root = rootIdentifier(expression);
      const callback = root
        ? (
          frame.callbacks.get(`${root}.${expression.name.text}`) ??
          frame.callbacks.get(`${root}.*`)
        )
        : null;
      if (callback) {
        return {
          kind: "callback",
          ...callback,
          name: `${root}.${expression.name.text}`,
        };
      }
      const namespace = root ? frame.info.namespaceImports.get(root) : null;
      if (namespace && !namespace.typeOnly) {
        const targetPath = this.project.resolveModuleSpecifier(frame.info, namespace.source);
        const targetInfo = targetPath ? this.project.getModule(targetPath) : null;
        const target = targetInfo
          ? this.project.exportTargets(targetInfo).get(expression.name.text)
          : null;
        return {
          kind: "import",
          binding: { source: namespace.source, imported: expression.name.text },
          targetInfo,
          target,
          name: expression.name.text,
        };
      }
      if (root) {
        const imported = frame.info.imports.get(root);
        if (imported && !imported.typeOnly) {
          const targetPath = this.project.resolveModuleSpecifier(frame.info, imported.source);
          const targetInfo = targetPath ? this.project.getModule(targetPath) : null;
          const target = targetInfo
            ? this.project.exportTargets(targetInfo).get(imported.imported)
            : null;
          const targetNode = target ? unwrapped(target.node) : null;
          if (
            expression.name.text === "includes" &&
            targetNode &&
            ts.isArrayLiteralExpression(targetNode)
          ) {
            return null;
          }
          return {
            kind: "import-surface",
            binding: imported,
            targetInfo,
            name: `${imported.imported}.${expression.name.text}`,
          };
        }
      }
    }
    if (
      ts.isElementAccessExpression(expression) &&
      expression.argumentExpression &&
      ts.isStringLiteralLike(expression.argumentExpression)
    ) {
      const root = rootIdentifier(expression);
      const callback = root
        ? (
          frame.callbacks.get(`${root}.${expression.argumentExpression.text}`) ??
          frame.callbacks.get(`${root}.*`)
        )
        : null;
      if (callback) {
        return {
          kind: "callback",
          ...callback,
          name: `${root}.${expression.argumentExpression.text}`,
        };
      }
    }
    const localMember = localMemberFunctionNode(frame, expression);
    if (localMember) {
      const path = memberPath(expression);
      return {
        kind: "local",
        info: frame.info,
        node: localMember,
        name: [path.root, ...path.members].filter(Boolean).join("."),
      };
    }
    return null;
  }

  expressionTaintsDb(frame, expression, state) {
    const node = unwrapped(expression);
    const root = rootIdentifier(node);
    if (root && state.dbBindings.has(root)) return true;
    if (ts.isIdentifier(node)) {
      const initializer = frame.info.localValues.get(node.text);
      if (initializer && initializer !== expression) {
        const initializerRoot = rootIdentifier(initializer);
        return Boolean(initializerRoot && state.dbBindings.has(initializerRoot));
      }
    }
    return false;
  }

  expressionTaintsStorage(frame, expression, state) {
    const node = unwrapped(expression);
    const path = memberPath(node);
    if (path.root && state.storageBindings.has(path.root)) return true;
    if (
      path.root &&
      state.storageNamespaceBindings.has(path.root) &&
      path.members[0] === "storage"
    ) {
      return true;
    }
    if (ts.isIdentifier(node)) {
      const initializer = frame.info.localValues.get(node.text);
      if (initializer && initializer !== expression) {
        return this.expressionTaintsStorage(frame, initializer, state);
      }
    }
    return false;
  }

  expressionTaintsStorageNamespace(frame, expression, state) {
    const node = unwrapped(expression);
    const path = memberPath(node);
    if (
      path.root &&
      path.members.length === 0 &&
      state.storageNamespaceBindings.has(path.root)
    ) {
      return true;
    }
    if (ts.isIdentifier(node)) {
      const initializer = frame.info.localValues.get(node.text);
      if (initializer && initializer !== expression) {
        return this.expressionTaintsStorageNamespace(frame, initializer, state);
      }
    }
    return false;
  }

  expressionTaintsUnsupportedStorage(frame, expression, state) {
    const node = unwrapped(expression);
    const path = memberPath(node);
    if (path.root && state.unsupportedStorageBindings.has(path.root)) return true;
    if (
      path.root &&
      state.unsupportedStorageNamespaceBindings.has(path.root) &&
      path.members[0] === "storage"
    ) {
      return true;
    }
    if (ts.isIdentifier(node)) {
      const initializer = frame.info.localValues.get(node.text);
      if (initializer && initializer !== expression) {
        return this.expressionTaintsUnsupportedStorage(frame, initializer, state);
      }
    }
    return false;
  }

  expressionTaintsUnsupportedStorageNamespace(frame, expression, state) {
    const node = unwrapped(expression);
    const path = memberPath(node);
    if (
      path.root &&
      path.members.length === 0 &&
      state.unsupportedStorageNamespaceBindings.has(path.root)
    ) {
      return true;
    }
    if (ts.isIdentifier(node)) {
      const initializer = frame.info.localValues.get(node.text);
      if (initializer && initializer !== expression) {
        return this.expressionTaintsUnsupportedStorageNamespace(
          frame,
          initializer,
          state,
        );
      }
    }
    return false;
  }

  expressionTaintsQueue(frame, expression, state) {
    const node = unwrapped(expression);
    const root = rootIdentifier(node);
    return Boolean(
      (root && state.queueBindings.has(root)) ||
      this.isGetBossCall(frame, node),
    );
  }

  expressionContainsTrackedCapability(
    frame,
    expression,
    state,
    seenBindings = new Set(),
  ) {
    let found = false;
    const visit = (node) => {
      if (found) return;
      const current = unwrapped(node);
      if (isFunctionLike(current)) return;
      if (this.trackedCapabilityExpressions.has(current)) {
        found = true;
        return;
      }
      const path = memberPath(current);
      if (
        path.root &&
        (
          state.dbBindings.has(path.root) ||
          state.storageBindings.has(path.root) ||
          state.unsupportedStorageBindings.has(path.root) ||
          state.queueBindings.has(path.root) ||
          (
            state.storageNamespaceBindings.has(path.root) &&
            (path.members.length === 0 || path.members[0] === "storage")
          ) ||
          (
            state.unsupportedStorageNamespaceBindings.has(path.root) &&
            (path.members.length === 0 || path.members[0] === "storage")
          )
        )
      ) {
        found = true;
        return;
      }
      if (
        ts.isPropertyAccessExpression(current) ||
        ts.isElementAccessExpression(current)
      ) {
        if (
          ts.isElementAccessExpression(current) &&
          current.argumentExpression
        ) {
          visit(current.argumentExpression);
        }
        return;
      }
      if (ts.isCallExpression(current)) {
        if (this.isGetBossCall(frame, current)) found = true;
        return;
      }
      if (ts.isNewExpression(current)) return;
      if (ts.isIdentifier(current)) {
        const name = current.text;
        const initializer = frame.info.localValues.get(name);
        if (initializer && !seenBindings.has(name)) {
          const nextSeen = new Set(seenBindings);
          nextSeen.add(name);
          if (
            this.expressionContainsTrackedCapability(
              frame,
              initializer,
              state,
              nextSeen,
            )
          ) {
            found = true;
          }
        }
        return;
      }
      if (ts.isObjectLiteralExpression(current)) {
        for (const property of current.properties) {
          if (ts.isPropertyAssignment(property)) visit(property.initializer);
          else if (ts.isShorthandPropertyAssignment(property)) visit(property.name);
          else if (ts.isSpreadAssignment(property)) visit(property.expression);
        }
        return;
      }
      ts.forEachChild(current, visit);
    };
    visit(expression);
    return found;
  }

  localMutableCarrierRoot(frame, expression, seenBindings = new Set()) {
    const root = rootIdentifierNode(expression);
    if (!root || seenBindings.has(root.text)) return null;
    const binding = visibleBindingNode(
      frame.info.sourceFile,
      root,
      root.text,
    );
    if (!binding) return null;
    if (ts.isParameter(binding)) {
      const type = binding.type;
      const scalarType =
        type &&
        new Set([
          ts.SyntaxKind.StringKeyword,
          ts.SyntaxKind.NumberKeyword,
          ts.SyntaxKind.BooleanKeyword,
          ts.SyntaxKind.BigIntKeyword,
          ts.SyntaxKind.SymbolKeyword,
        ]).has(type.kind);
      return scalarType ? null : root.text;
    }
    if (!ts.isVariableDeclaration(binding) || !binding.initializer) return null;
    const initializer = unwrapped(binding.initializer);
    if (
      ts.isObjectLiteralExpression(initializer) ||
      ts.isArrayLiteralExpression(initializer)
    ) {
      return root.text;
    }
    if (!ts.isIdentifier(initializer)) return null;
    const nextSeen = new Set(seenBindings);
    nextSeen.add(root.text);
    return this.localMutableCarrierRoot(frame, initializer, nextSeen)
      ? root.text
      : null;
  }

  propagateOpaqueCallCapabilities(states, frame, args) {
    if (args.length < 2) return states;
    return states.map((state) => {
      if (
        !args.some((argument) =>
          this.expressionContainsTrackedCapability(frame, argument, state),
        )
      ) {
        return state;
      }
      const carriers = args
        .filter(
          (argument) =>
            !this.expressionContainsTrackedCapability(
              frame,
              argument,
              state,
            ),
        )
        .map((argument) =>
          this.localMutableCarrierRoot(frame, argument),
        )
        .filter(Boolean);
      if (!carriers.length) return state;
      const next = cloneState(state);
      for (const carrier of carriers) next.dbBindings.add(carrier);
      return next;
    });
  }

  callPassesTrackedCapability(frame, args, states) {
    return states.some((state) =>
      args.some((argument) =>
        this.expressionContainsTrackedCapability(frame, argument, state),
      ),
    );
  }

  unresolvedSameRepoCalleeNames(frame, expression) {
    // This is only a fail-close detector for dynamic callee shapes. It recognizes
    // functions whose exact local/imported body is in this repo; globals and callback
    // parameters remain opaque and do not acquire authority.
    const names = new Set();
    const importedFunction = (localName) => {
      const imported = frame.info.imports.get(localName);
      if (!imported || imported.typeOnly) return;
      const targetPath = this.project.resolveModuleSpecifier(
        frame.info,
        imported.source,
      );
      const targetInfo = targetPath ? this.project.getModule(targetPath) : null;
      const target = targetInfo
        ? this.project.exportTargets(targetInfo).get(imported.imported)
        : null;
      if (
        target &&
        !target.unknown &&
        isFunctionLike(unwrapped(target.node))
      ) {
        names.add(imported.imported);
      }
    };
    const namespaceFunction = (root, member) => {
      const namespace = frame.info.namespaceImports.get(root);
      if (!namespace || namespace.typeOnly) return;
      const targetPath = this.project.resolveModuleSpecifier(
        frame.info,
        namespace.source,
      );
      const targetInfo = targetPath ? this.project.getModule(targetPath) : null;
      const target = targetInfo
        ? this.project.exportTargets(targetInfo).get(member)
        : null;
      if (
        target &&
        !target.unknown &&
        isFunctionLike(unwrapped(target.node))
      ) {
        names.add(member);
      }
    };
    const visit = (candidate) => {
      const node = unwrapped(candidate);
      if (ts.isIdentifier(node)) {
        const local =
          frame.localFunctions.get(node.text) ??
          frame.info.localFunctions.get(node.text);
        if (local && isFunctionLike(unwrapped(local))) {
          names.add(node.text);
        } else {
          importedFunction(node.text);
        }
        return;
      }
      if (ts.isPropertyAccessExpression(node)) {
        const root = rootIdentifier(node);
        if (root) namespaceFunction(root, node.name.text);
        return;
      }
      if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression)
      ) {
        const root = rootIdentifier(node);
        if (root) namespaceFunction(root, node.argumentExpression.text);
        if (ts.isArrayLiteralExpression(unwrapped(node.expression))) {
          for (const element of unwrapped(node.expression).elements) visit(element);
        }
        return;
      }
      if (ts.isConditionalExpression(node)) {
        visit(node.whenTrue);
        visit(node.whenFalse);
        return;
      }
      if (ts.isArrayLiteralExpression(node)) {
        for (const element of node.elements) visit(element);
      }
    };
    visit(expression);
    return [...names].sort();
  }

  unresolvedLocalReceiverNames(frame, expression, states) {
    // Fail-closed companion to callBinding's local member resolution. A callable
    // member of an in-repo local receiver that could not be pinned to a body must
    // never silently accept a tracked capability, exactly as an imported object
    // surface never can. Globals, parameters and imports keep their deliberate
    // opaque carve-out and do not acquire authority here.
    const node = unwrapped(expression);
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) {
      return [];
    }
    const { members } = memberPath(node);
    // A computed member name is dynamic dispatch: it can never be pinned to a body,
    // so it stays unprovable rather than silently resolving to nothing.
    const member = members[members.length - 1] ?? "[computed]";
    const base = memberPathBase(node);
    if (ts.isNewExpression(base)) {
      const constructorName = unwrapped(base.expression);
      const label = ts.isIdentifier(constructorName) ? constructorName.text : "new";
      return [`${label}.${member}`];
    }
    if (!ts.isIdentifier(base)) return [];
    const root = base.text;
    if (frame.info.imports.has(root) || frame.info.namespaceImports.has(root)) return [];
    if (
      frame.callbacks.has(root) ||
      frame.callbacks.has(`${root}.${member}`) ||
      frame.callbacks.has(`${root}.*`)
    ) {
      return [];
    }
    if (
      states.some((state) =>
        this.expressionContainsTrackedCapability(frame, base, state),
      )
    ) {
      return [];
    }
    if (parameterBinding(frame.node, root)) return [];
    const binding = visibleBindingNode(frame.node, node, root);
    if (binding) {
      if (!ts.isVariableDeclaration(binding)) return [];
    } else if (!frame.info.localValues.has(root)) {
      return [];
    }
    return [`${root}.${member}`];
  }

  isGetBossCall(frame, expression) {
    const node = unwrapped(expression);
    if (!ts.isCallExpression(node)) return false;
    const callee = unwrapped(node.expression);
    return ts.isIdentifier(callee) && frame.info.getBossImports.has(callee.text);
  }

  isTransactionCall(call) {
    const expression = unwrapped(call.expression);
    if (ts.isPropertyAccessExpression(expression)) {
      return expression.name.text === "$transaction";
    }
    return (
      ts.isElementAccessExpression(expression) &&
      expression.argumentExpression &&
      ts.isStringLiteralLike(expression.argumentExpression) &&
      expression.argumentExpression.text === "$transaction"
    );
  }

  isPgBossPrismaSendAdapterCall(frame, call, states) {
    if (
      call.arguments.length !== 1 ||
      !this.exactImportedCall(frame, call, "pg-boss", "fromPrisma")
    ) {
      return false;
    }
    const transaction = unwrapped(call.arguments[0]);
    if (
      !ts.isIdentifier(transaction) ||
      !states.length ||
      !states.every((state) => state.dbBindings.has(transaction.text))
    ) {
      return false;
    }
    const property = call.parent;
    if (
      !ts.isPropertyAssignment(property) ||
      property.initializer !== call ||
      propertyNameText(property.name) !== "db"
    ) {
      return false;
    }
    const options = property.parent;
    const sendCall = options?.parent;
    if (
      !ts.isObjectLiteralExpression(options) ||
      !ts.isCallExpression(sendCall) ||
      sendCall.arguments[2] !== options ||
      callMemberName(sendCall) !== "send"
    ) {
      return false;
    }
    const queueRoot = rootIdentifier(unwrapped(sendCall.expression));
    return Boolean(
      queueRoot &&
      states.every((state) => state.queueBindings.has(queueRoot)),
    );
  }

  markPrincipalDerivedOperationResult(call, states, frame, context) {
    const derivedNames = context.derivedNames ?? [];
    const member = callMemberName(call);
    if (!member || !PRISMA_PRINCIPAL_DERIVED_RESULT_MEMBERS.has(member)) return states;
    const scoped = states.map(
      (state) =>
        Boolean(this.project.directSensitiveKind(frame.info, call, state)) &&
        operationReferencesPrincipal(call, state, this.principalDerivedExpressions),
    );
    if (scoped.some(Boolean)) {
      this.principalDerivedExpressions.set(unwrapped(call), "derived");
    }
    let nextStates = states;
    if (member === "create") {
      const firstArgument = call.arguments?.[0];
      const data = firstArgument
        ? objectPropertyInitializer(firstArgument, "data")
        : null;
      const object = data ? unwrapped(data) : null;
      const idValue =
        object && ts.isObjectLiteralExpression(object)
          ? objectPropertyInitializer(object, "id")
          : null;
      const id = idValue ? unwrapped(idValue) : null;
      if (id && ts.isIdentifier(id)) {
        nextStates = states.map((state, index) => {
          if (!scoped[index]) return state;
          const next = cloneState(state);
          next.principalDerivedBindings.add(id.text);
          return next;
        });
      }
    }
    if (
      scoped.some(Boolean) &&
      (member === "findFirst" || member === "findUnique")
    ) {
      const candidateNames = this.scopedReadClientKeyNames(
        call,
        states[scoped.findIndex(Boolean)],
      );
      for (const resultName of derivedNames) {
        if (candidateNames.size) {
          this.validatedInputCandidates.set(resultName, candidateNames);
        }
      }
    }
    if (!derivedNames.length) return nextStates;
    return nextStates.map((state, index) => {
      if (!scoped[index]) return state;
      const next = cloneState(state);
      for (const name of derivedNames) {
        next.principalDerivedBindings.add(name);
        if (
          context.kind === "assigned" &&
          context.name === name &&
          member !== "count"
        ) {
          next.principalDerivedObjects.add(name);
        }
      }
      return next;
    });
  }

  scopedReadClientKeyNames(call, state) {
    const names = new Set();
    const firstArgument = call.arguments?.[0];
    const where = firstArgument
      ? objectPropertyInitializer(firstArgument, "where")
      : null;
    const object = where ? unwrapped(where) : null;
    if (!object || !ts.isObjectLiteralExpression(object)) return names;
    for (const property of object.properties) {
      if (
        !ts.isPropertyAssignment(property) &&
        !ts.isShorthandPropertyAssignment(property)
      ) {
        continue;
      }
      const key = propertyNameText(property.name);
      const value = ts.isShorthandPropertyAssignment(property)
        ? property.name
        : unwrapped(property.initializer);
      if (
        (!key || (key !== "id" && !key.endsWith("Id"))) ||
        !ts.isIdentifier(value) ||
        principalExpressionKind(
          value,
          state,
          this.principalDerivedExpressions,
        ) !== null
      ) {
        continue;
      }
      names.add(value.text);
    }
    return names;
  }

  truthyResultNames(expression, truthy) {
    const node = unwrapped(expression);
    if (ts.isIdentifier(node)) return truthy ? new Set([node.text]) : new Set();
    if (
      ts.isPrefixUnaryExpression(node) &&
      node.operator === ts.SyntaxKind.ExclamationToken
    ) {
      return this.truthyResultNames(node.operand, !truthy);
    }
    if (ts.isBinaryExpression(node)) {
      const isAnd = node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken;
      const isOr = node.operatorToken.kind === ts.SyntaxKind.BarBarToken;
      if ((truthy && isAnd) || (!truthy && isOr)) {
        return new Set([
          ...this.truthyResultNames(node.left, truthy),
          ...this.truthyResultNames(node.right, truthy),
        ]);
      }
    }
    return new Set();
  }

  applyValidatedInputs(states, resultNames) {
    if (!resultNames.size) return states;
    return states.map((state) => {
      const next = cloneState(state);
      for (const resultName of resultNames) {
        for (const inputName of this.validatedInputCandidates.get(resultName) ?? []) {
          next.principalDerivedBindings.add(inputName);
        }
      }
      return next;
    });
  }

  // A call to one of the reviewed transparent frame runners (see PRINCIPAL_FRAME_RUNNERS).
  // The trust is withdrawn the moment the runner module can reach a sensitive operation, so
  // the model cannot be turned into a bypass by editing packages/db/src/principal.ts.
  isPrincipalFrameRunnerCall(binding) {
    if (binding?.kind !== "import") return false;
    const relPath = binding.targetInfo?.relPath;
    if (!relPath) return false;
    if (!PRINCIPAL_FRAME_RUNNERS.get(relPath)?.has(binding.name)) return false;
    return !this.project.moduleMayReachSensitive(binding.targetInfo);
  }

  applyInvokedReturn(call, invoked, callerStates) {
    const normalReturns = invoked.filter(
      (state) => state.returnedPrincipalKind !== "abrupt",
    );
    const returnedKinds = normalReturns.map(
      (state) => state.returnedPrincipalKind,
    );
    if (returnedKinds.length && returnedKinds.every(Boolean)) {
      const firstKind = returnedKinds[0];
      const kind = returnedKinds.every((candidate) => candidate === firstKind)
        ? firstKind
        : "derived";
      this.principalDerivedExpressions.set(unwrapped(call), kind);
    }
    if (normalReturns.some((state) => state.returnedCapability)) {
      this.trackedCapabilityExpressions.add(unwrapped(call));
    }
    return invoked.map((state, index) => {
      const next = cloneState(state);
      const caller = callerStates[Math.min(index, callerStates.length - 1)];
      next.returnedDerived = caller?.returnedDerived ?? false;
      next.returnedPrincipalKind = caller?.returnedPrincipalKind ?? null;
      next.returnedCapability = caller?.returnedCapability ?? false;
      return next;
    });
  }

  async analyzeCallback(
    callback,
    states,
    frame,
    importDepth,
    { transaction = false, derivedCollectionElement = false } = {},
  ) {
    const node = unwrapped(callback);
    if (!isFunctionLike(node)) return { returned: [], exits: [] };
    const stackKey = `${frame.info.path}:${node.pos}`;
    if (this.callbackStack.includes(stackKey)) {
      const exits = states.map(cloneState);
      return { returned: [], exits };
    }
    this.callbackStack.push(stackKey);
    try {
      const callbackStates = states.map((state) => {
        const next = cloneState(state);
        for (const parameter of node.parameters ?? []) {
          for (const name of identifierNames(parameter.name)) {
            detachPrincipalAlias(next, name);
            clearPrincipalName(next, name);
            next.poisonedCollections.delete(name);
          }
        }
        const txParameter = node.parameters?.[0];
        if (transaction && txParameter && ts.isIdentifier(txParameter.name)) {
          next.dbBindings.add(txParameter.name.text);
        }
        if (
          derivedCollectionElement &&
          txParameter &&
          ts.isIdentifier(txParameter.name)
        ) {
          next.principalDerivedBindings.add(txParameter.name.text);
          next.principalDerivedObjects.add(txParameter.name.text);
        }
        return next;
      });
      const localFunctions = new Map(frame.localFunctions);
      for (const [localName, localNode] of scopedFunctionBindings(node)) {
        localFunctions.set(localName, localNode);
      }
      const callbackFrame = makeFrame(
        frame.info,
        node,
        `${frame.name}.$transaction`,
        new Map(frame.callbacks),
        localFunctions,
      );
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        const returned = await this.asyncExpression(
          node.body,
          callbackStates,
          callbackFrame,
          { kind: "consumed" },
          importDepth,
        );
        const expressionExits = returned.map((state) => {
          const next = cloneState(state);
          const expressionKind = principalExpressionKind(
            node.body,
            state,
            this.principalDerivedExpressions,
          ) ?? principalCollectionExpressionKind(
            node.body,
            state,
            this.principalDerivedExpressions,
          );
          const authorityKind = principalOwnerAuthorityKind(
            node.body,
            state,
            this.principalDerivedExpressions,
          );
          const kind = expressionKind ?? (authorityKind ? "derived" : null);
          next.returnedPrincipalKind = kind;
          next.returnedDerived = kind === "derived";
          return next;
        });
        return { returned: expressionExits, exits: expressionExits };
      } else {
        const flow = await this.analyzeBlock(node.body, callbackStates, callbackFrame, importDepth);
        return {
          returned: flow.returned,
          exits: dedupeStates([...flow.returned, ...flow.continuing]),
        };
      }
    } finally {
      this.callbackStack.pop();
    }
  }

  async analyzeCall(call, states, frame, context, importDepth) {
    let current = states;
    const args = call.arguments ? [...call.arguments] : [];
    const transactionCall = this.isTransactionCall(call);
    const earlyBinding = this.callBinding(frame, call);
    const trustedResolver = ts.isCallExpression(call)
      ? this.trustedImportedResolver(frame.info, call)
      : null;
    const localProducer = ts.isCallExpression(call) ? this.localProducer(frame, call) : null;
    const storageKeyCall =
      ts.isCallExpression(call) && this.isStorageKeyCall(frame, call);
    const keyOwnerMatchesCall =
      ts.isCallExpression(call) && this.isKeyOwnerMatchesCall(frame, call);
    const signedMediaVerifierCall =
      ts.isCallExpression(call) && this.isSignedMediaVerifierCall(frame, call);
    const modeledPureGlobalCall =
      ts.isCallExpression(call) && this.isModeledPureGlobalCall(frame, call);
    const importedWorkspaceBody =
      earlyBinding?.kind === "import" &&
      this.project.isWorkspacePackageModule(earlyBinding.targetInfo);
    const importedBodyModeled =
      earlyBinding?.kind === "import" &&
      earlyBinding.target &&
      !earlyBinding.target.unknown &&
      isFunctionLike(unwrapped(earlyBinding.target.node)) &&
      (
        importDepth < MAX_SAME_PACKAGE_IMPORT_DEPTH ||
        importedWorkspaceBody
      ) &&
      !this.project.isReviewedExemptExport(earlyBinding.targetInfo, earlyBinding.name) &&
      !(
        earlyBinding.targetInfo?.path !== this.originInfo.path &&
        this.project.isIndependentlyAnalyzedEntry(earlyBinding.targetInfo) &&
        this.project.moduleMayReachSensitive(earlyBinding.targetInfo)
      );
    // A transparent frame runner's body is resolvable, but tracing the callback THROUGH it
    // would analyse the callback against the runner's frame instead of the caller's. Treat the
    // callback as call-site material so it is analysed where it actually executes.
    const frameRunnerCall = this.isPrincipalFrameRunnerCall(earlyBinding);
    const callbackCallIsFullyTraced =
      !frameRunnerCall &&
      (
        transactionCall ||
        earlyBinding?.kind === "local" ||
        earlyBinding?.kind === "callback" ||
        Boolean(localProducer) ||
        importedBodyModeled
      );
    const callbackAnalyses = [];
    let transactionReturnsDerived = false;
    const calledExpression = unwrapped(call.expression);
    const callbackMember = callMemberName(call);
    const collectionReceiver =
      ts.isPropertyAccessExpression(calledExpression) ||
      ts.isElementAccessExpression(calledExpression)
        ? calledExpression.expression
        : null;
    const collectionReceiverIsDerived =
      Boolean(collectionReceiver) &&
      current.length > 0 &&
      current.every((state) => {
        const kind = principalExpressionKind(
          collectionReceiver,
          state,
          this.principalDerivedExpressions,
        );
        const root = rootIdentifier(collectionReceiver);
        return (
          kind === "derived" ||
          Boolean(root && state.safeDerivedCollections.has(root))
        );
      });
    const collectionReceiverIsDerivedObject =
      Boolean(collectionReceiver) &&
      current.length > 0 &&
      current.every((state) => {
        const receiver = unwrapped(collectionReceiver);
        if (this.principalDerivedObjectExpressions.has(receiver)) return true;
        return Boolean(
          ts.isIdentifier(receiver) &&
          (
            state.principalDerivedObjects.has(receiver.text) ||
            state.safeDerivedCollections.has(receiver.text)
          ),
        );
      });
    const derivedCollectionElement =
      Boolean(callbackMember) &&
      DERIVED_COLLECTION_CALLBACK_MEMBERS.has(callbackMember) &&
      collectionReceiverIsDerived;
    const derivedCollectionPreservingCall =
      Boolean(callbackMember) &&
      DERIVED_COLLECTION_PRESERVING_MEMBERS.has(callbackMember) &&
      collectionReceiverIsDerived &&
      collectionReceiverIsDerivedObject;
    const derivedMapGetCall =
      callbackMember === "get" &&
      Boolean(collectionReceiver) &&
      this.isLocalMapReceiver(frame, collectionReceiver) &&
      collectionReceiverIsDerived;
    const derivedMapConstructor =
      ts.isNewExpression(call) &&
      this.isUnshadowedGlobal(frame, call.expression, "Map");

    if (this.isShadowedResolverCall(frame, call)) {
      current = current.map((state) => {
        const next = cloneState(state);
        next.shadowedResolver = true;
        return next;
      });
    }

    const callee = unwrapped(call.expression);
    if (
      (ts.isPropertyAccessExpression(callee) || ts.isElementAccessExpression(callee)) &&
      ts.isCallExpression(unwrapped(callee.expression))
    ) {
      current = await this.asyncExpression(
        callee.expression,
        current,
        frame,
        { kind: "discarded" },
        importDepth,
      );
    }

    for (const argument of args) {
      const callbackResolution = this.callbackArgumentResolution(
        frame,
        argument,
        importDepth,
        new Set(),
        call,
      );
      if (callbackResolution.kind === "analyzable") {
        if (!callbackCallIsFullyTraced || transactionCall) {
          const callbackAnalysis = await this.analyzeCallback(
            callbackResolution.node,
            current,
            callbackResolution.frame,
            callbackResolution.importDepth ?? importDepth,
            {
              transaction: transactionCall,
              derivedCollectionElement,
            },
          );
          callbackAnalyses.push(callbackAnalysis);
          if (
            transactionCall &&
            callbackAnalysis.returned.some((state) => state.returnedDerived)
          ) {
            transactionReturnsDerived = true;
          }
        }
        continue;
      }
      current = await this.asyncExpression(
        argument,
        current,
        frame,
        { kind: "consumed" },
        importDepth,
      );
      if (
        callbackResolution.kind === "unresolved" &&
        (!callbackCallIsFullyTraced || transactionCall)
      ) {
        current = this.invalidateAllTaintedBindings(current);
      }
    }

    if (transactionReturnsDerived) {
      this.principalDerivedExpressions.set(unwrapped(call), "derived");
    }
    // `run*(x, fn)` evaluates to `fn()`'s value, so the callback's returned principal kind is
    // the call's kind. Mirrors applyInvokedReturn for a body the prover deliberately skips.
    if (frameRunnerCall && callbackAnalyses.length > 0) {
      const returnedKinds = callbackAnalyses
        .flatMap((analysis) => analysis.returned)
        .filter((state) => state.returnedPrincipalKind !== "abrupt")
        .map((state) => state.returnedPrincipalKind);
      if (returnedKinds.length && returnedKinds.every(Boolean)) {
        const firstKind = returnedKinds[0];
        this.principalDerivedExpressions.set(
          unwrapped(call),
          returnedKinds.every((candidate) => candidate === firstKind) ? firstKind : "derived",
        );
      }
    }
    const derivedMapCallbackResult =
      derivedCollectionElement &&
      callbackMember === "map" &&
      callbackAnalyses.length > 0 &&
      callbackAnalyses.every(
        (analysis) =>
          analysis.returned.length > 0 &&
          analysis.returned.every((state) => state.returnedDerived),
      );
    const derivedMapConstructorResult =
      derivedMapConstructor &&
      args.length > 0 &&
      current.length > 0 &&
      current.every((state) =>
        Boolean(
          principalExpressionKind(
            args[0],
            state,
            this.principalDerivedExpressions,
          ),
        ),
      );
    if (
      derivedCollectionPreservingCall ||
      derivedMapCallbackResult ||
      derivedMapConstructorResult ||
      derivedMapGetCall
    ) {
      this.principalDerivedExpressions.set(unwrapped(call), "derived");
      this.principalDerivedObjectExpressions.add(unwrapped(call));
    }
    if (
      storageKeyCall &&
      current.length > 0 &&
      current.every((state) =>
        storageOwnerExpressionReferencesPrincipal(
          args[0],
          state,
          this.principalDerivedExpressions,
        ),
      )
    ) {
      this.principalDerivedExpressions.set(unwrapped(call), "derived");
    }
    if (
      signedMediaVerifierCall &&
      context.kind === "assigned" &&
      context.name
    ) {
      current = current.map((state) => {
        const next = cloneState(state);
        next.signedMediaClaims.add(context.name);
        return next;
      });
    }
    const pgBossPrismaSendAdapterCall =
      ts.isCallExpression(call) &&
      this.isPgBossPrismaSendAdapterCall(frame, call, current);
    const objectAssignCall = this.isObjectAssignCall(frame, call);
    if (objectAssignCall && args.length > 1) {
      const target = rootIdentifierNode(args[0]);
      if (target) {
        current = current.map((state) => {
          if (
            !args.slice(1).some((argument) =>
              this.expressionContainsTrackedCapability(
                frame,
                argument,
                state,
              ),
            )
          ) {
            return state;
          }
          const next = cloneState(state);
          next.dbBindings.add(target.text);
          return next;
        });
        // Round 26: Object.assign writes elements into its target, so a non-derived
        // source poisons the target alias group exactly like an inserting mutator.
        current = this.poisonMutatedCollectionReceiver(
          current,
          frame,
          args[0],
          args.slice(1),
        );
        current = this.invalidatePrincipalRoot(current, target.text);
      }
    }

    if (
      ts.isCallExpression(call) &&
      ts.isPropertyAccessExpression(unwrapped(call.expression)) &&
      unwrapped(call.expression).name.text === "push"
    ) {
      const receiverRoot = rootIdentifierNode(
        unwrapped(call.expression).expression,
      );
      const receiver = receiverRoot?.text ?? null;
      if (receiver) {
        current = current.map((state) => {
          const next = cloneState(state);
          const collectionNames = this.collectionAliasesForState(
            state,
            receiver,
          );
          const pushedProperties =
            args.length === 1
              ? principalPropertiesForExpression(
                  args[0],
                  state,
                  this.principalDerivedExpressions,
                )
              : new Map();
          const existingProperties = principalPropertiesForRoot(
            state.principalCollectionPropertyBindings,
            receiver,
          );
          const initializesStructuredCollection =
            state.safeDerivedCollections.has(receiver) &&
            existingProperties.size === 0;
          clearPrincipalProperties(
            next.principalCollectionPropertyBindings,
            receiver,
          );
          if (initializesStructuredCollection) {
            for (const [propertyName, propertyKind] of pushedProperties) {
              next.principalCollectionPropertyBindings.set(
                principalPropertyKey(receiver, propertyName),
                propertyKind,
              );
            }
          } else {
            for (const [propertyName, propertyKind] of existingProperties) {
              if (pushedProperties.get(propertyName) !== propertyKind) continue;
              next.principalCollectionPropertyBindings.set(
                principalPropertyKey(receiver, propertyName),
                propertyKind,
              );
            }
          }
          const carriesOnlyDerived =
            args.length > 0 &&
            args.every(
              (argument) => {
                const kind = principalExpressionKind(
                  argument,
                  state,
                  this.principalDerivedExpressions,
                );
                const objectEscapes = [...escapedAliasIdentifiers(argument)].some(
                  (name) => principalNameIsObjectTainted(state, name),
                );
                return kind === "derived" && !objectEscapes;
              },
            );
          const carriesStructuredProperties =
            args.length === 1 &&
            ts.isObjectLiteralExpression(unwrapped(args[0])) &&
            pushedProperties.size > 0;
          const wasPoisoned = [...collectionNames].some((name) =>
            state.poisonedCollections.has(name),
          );
          const becomesPoisoned =
            args.length > 0 &&
            !carriesOnlyDerived &&
            !carriesStructuredProperties;
          const collectionPoisoned = wasPoisoned || becomesPoisoned;
          if (carriesStructuredProperties && !collectionPoisoned) {
            next.principalDerivedBindings.delete(receiver);
            next.principalDerivedObjects.delete(receiver);
            next.safeDerivedCollections.delete(receiver);
          } else if (carriesOnlyDerived && !collectionPoisoned) {
            next.principalDerivedBindings.add(receiver);
            next.principalDerivedObjects.add(receiver);
          } else if (principalNameIsTainted(next, receiver)) {
            invalidatePrincipalAlias(next, receiver);
          }
          if (!carriesStructuredProperties) {
            if (carriesOnlyDerived && !collectionPoisoned) {
              next.safeDerivedCollections.add(receiver);
            } else next.safeDerivedCollections.delete(receiver);
          }
          if (args.length > 0) {
            const affectedNames = collectionNames.size
              ? collectionNames
              : new Set([receiver]);
            for (const name of affectedNames) {
              next.definitelyEmptyCollections.delete(name);
              next.knownNonEmptyCollections.add(name);
              if (becomesPoisoned) next.poisonedCollections.add(name);
            }
          }
          if (
            args.some((argument) =>
              this.expressionContainsTrackedCapability(
                frame,
                argument,
                state,
              ),
            )
          ) {
            const affectedNames = collectionNames.size
              ? collectionNames
              : new Set([receiver]);
            for (const name of affectedNames) next.dbBindings.add(name);
          }
          return next;
        });
        for (const argument of args) {
          current = this.invalidateEscapedAliases(current, argument);
        }
        const receiverExpression = unwrapped(call.expression).expression;
        if (!ts.isIdentifier(unwrapped(receiverExpression))) {
          current = this.invalidateDirectAlias(current, receiverExpression);
        }
      }
    }

    const directSensitive = this.project.directSensitiveKind(
      frame.info,
      call,
      current[0] ?? createState(frame.info),
    );
    const pushCall =
      ts.isCallExpression(call) &&
      ts.isPropertyAccessExpression(unwrapped(call.expression)) &&
      unwrapped(call.expression).name.text === "push";
    const callIsModeled =
      Boolean(trustedResolver) ||
      Boolean(localProducer) ||
      earlyBinding?.kind === "local" ||
      earlyBinding?.kind === "callback" ||
      importedBodyModeled ||
      transactionCall ||
      pushCall ||
      storageKeyCall ||
      keyOwnerMatchesCall ||
      signedMediaVerifierCall ||
      modeledPureGlobalCall ||
      pgBossPrismaSendAdapterCall ||
      objectAssignCall ||
      derivedCollectionPreservingCall ||
      derivedMapCallbackResult ||
      derivedMapConstructorResult ||
      derivedMapGetCall ||
      Boolean(directSensitive && !directSensitive.startsWith("computed "));
    const unresolvedCapabilityCallees =
      !earlyBinding && ts.isCallExpression(call)
        ? this.unresolvedSameRepoCalleeNames(frame, call.expression)
        : [];
    if (
      unresolvedCapabilityCallees.length > 0 &&
      this.callPassesTrackedCapability(frame, args, current)
    ) {
      return this.recordSensitive(
        frame,
        call,
        current,
        `unresolved same-repo callee ${unresolvedCapabilityCallees.join("/")} receives a tracked DB/storage/queue capability`,
        REASON.UNPROVABLE,
      );
    }
    const unresolvedLocalReceivers =
      !earlyBinding && !callIsModeled && ts.isCallExpression(call)
        ? this.unresolvedLocalReceiverNames(frame, call.expression, current)
        : [];
    if (
      unresolvedLocalReceivers.length > 0 &&
      this.callPassesTrackedCapability(frame, args, current)
    ) {
      return this.recordSensitive(
        frame,
        call,
        current,
        `unresolved same-repo callee ${unresolvedLocalReceivers.join("/")} receives a tracked DB/storage/queue capability`,
        REASON.UNPROVABLE,
      );
    }
    if (transactionCall || !callbackCallIsFullyTraced) {
      for (const callbackAnalysis of callbackAnalyses) {
        current = this.mergeCallbackInvalidations(
          current,
          callbackAnalysis.exits,
        );
      }
    }
    const deferredSensitiveBoundary =
      (earlyBinding?.kind === "import-surface" &&
        earlyBinding.targetInfo &&
        this.project.moduleMayReachSensitive(earlyBinding.targetInfo)) ||
      (earlyBinding?.kind === "import" &&
        earlyBinding.targetInfo?.path !== this.originInfo.path &&
        this.project.isIndependentlyAnalyzedEntry(earlyBinding.targetInfo) &&
        this.project.moduleMayReachSensitive(earlyBinding.targetInfo));
    if (!callIsModeled && !deferredSensitiveBoundary) {
      current = this.propagateOpaqueCallCapabilities(
        current,
        frame,
        args,
      );
      const possiblyMutated = [...args];
      if (
        ts.isPropertyAccessExpression(calledExpression) ||
        ts.isElementAccessExpression(calledExpression)
      ) {
        possiblyMutated.push(calledExpression.expression);
      }
      // Round 26: `.push` used to be the only producer of collection poison for member
      // calls, so every other inserting mutation (unshift/splice/fill/copyWithin, an
      // unknown or dynamically named member) merely invalidated the receiver, and one
      // later owner-derived push re-blessed the whole list — attacker-controlled
      // elements included. Poison production is now independent of `.push`.
      // `clearPrincipalName` deliberately never clears poisonedCollections, so the
      // poison outlives the invalidation below and the next push sees wasPoisoned.
      if (
        (ts.isPropertyAccessExpression(calledExpression) ||
          ts.isElementAccessExpression(calledExpression)) &&
        !(callbackMember && PURE_COLLECTION_READ_MEMBERS.has(callbackMember))
      ) {
        current = this.poisonMutatedCollectionReceiver(
          current,
          frame,
          calledExpression.expression,
          args,
          callbackMember,
        );
      }
      current = this.poisonEscapedCollections(current, frame, args);
      current = this.markCollectionsPossiblyMutated(
        current,
        frame,
        possiblyMutated,
      );
      current = this.invalidateCallEscapes(current, call, args);
    }

    if (trustedResolver) return this.applyResolverUse(current, context, trustedResolver);

    // The runner IS its callback. Descending into the body now would re-analyse that callback
    // against the runner's frame — the lossy path this model exists to replace. Only taken
    // once the callback was actually traced above; an untraceable callback keeps the ordinary
    // (conservative) import handling.
    if (frameRunnerCall && callbackAnalyses.length > 0) return current;

    const binding = earlyBinding;
    if (
      (binding?.kind === "import" || binding?.kind === "import-surface") &&
      this.project.isPrincipalEstablishmentModule(binding.targetInfo)
    ) {
      return current;
    }
    if (binding?.kind === "callback" && binding.unresolved) {
      return this.invalidateAllTaintedBindings(current);
    }
    if (pgBossPrismaSendAdapterCall) return current;
    if (
      ts.isNewExpression(call) &&
      binding?.kind === "import" &&
      binding.name.endsWith("Error")
    ) {
      return current;
    }
    if (
      binding?.kind === "import" &&
      binding.targetInfo?.path !== this.originInfo.path &&
      this.project.isIndependentlyAnalyzedEntry(binding.targetInfo) &&
      this.project.moduleMayReachSensitive(binding.targetInfo)
    ) {
      this.covered = true;
      this.resolvedCovered = true;
      return this.invalidateCallEscapes(current, call, args);
    }
    if (binding?.kind === "local" || binding?.kind === "callback" || localProducer) {
      const target = localProducer
        ? { info: frame.info, node: localProducer.target, name: localProducer.name }
        : binding;
      const incoming = current.map(cloneState);
      const structuredCallback =
        binding?.kind === "callback" && binding.structured === true;
      if (structuredCallback) this.structuredCallbackDepth += 1;
      let invoked;
      try {
        invoked = await this.invokeFunction(
          target.info,
          target.node,
          target.name,
          args,
          frame,
          current,
          binding?.kind === "callback"
            ? binding.importDepth ?? importDepth
            : importDepth,
        );
      } finally {
        if (structuredCallback) this.structuredCallbackDepth -= 1;
      }
      if (localProducer) {
        invoked = invoked.map((state, index) => {
          const before = incoming[Math.min(index, incoming.length - 1)] ?? createState(frame.info);
          const next = cloneState(state);
          const producedPrincipal = !before.resolved && state.resolved;
          if (!before.resolved && !producedPrincipal) {
            next.resolved = false;
            next.pending = new Set(before.pending);
            next.shadowedResolver = true;
            return next;
          }
          if (context.kind === "discarded") {
            next.resolved = before.resolved;
            next.pending = new Set(before.pending);
            next.discardedResolver = true;
          } else if (context.kind === "assigned" && context.name) {
            next.resolved = true;
            next.pending = new Set(before.pending);
            next.pending.add(context.name);
            next.principalObjects = new Set(before.principalObjects);
            next.principalObjects.add(context.name);
          }
          return next;
        });
      }
      return this.applyInvokedReturn(call, invoked, incoming);
    }

    if (binding?.kind === "import") {
      if (
        binding.targetInfo &&
        this.project.isReviewedExemptExport(binding.targetInfo, binding.name)
      ) {
        return current;
      }
      const importedBodyResolved = Boolean(
        binding.target &&
        !binding.target.unknown &&
        isFunctionLike(unwrapped(binding.target.node)),
      );
      if (
        this.callPassesTrackedCapability(frame, args, current) &&
        (
          !importedBodyResolved ||
          (
            importDepth >= MAX_SAME_PACKAGE_IMPORT_DEPTH &&
            !importedWorkspaceBody
          )
        )
      ) {
        return this.recordSensitive(
          frame,
          call,
          current,
          importedBodyResolved
            ? `same-package call ${binding.name} receives a tracked DB/storage/queue capability beyond the one-module analysis limit`
            : `imported call ${binding.name} receives a tracked DB/storage/queue capability but its body cannot be resolved`,
          REASON.UNPROVABLE,
        );
      }
      if (
        binding.target &&
        !binding.target.unknown &&
        isFunctionLike(unwrapped(binding.target.node))
      ) {
        if (
          importDepth >= MAX_SAME_PACKAGE_IMPORT_DEPTH &&
          !importedWorkspaceBody
        ) {
          if (this.project.moduleMayReachSensitive(binding.targetInfo)) {
            return this.recordDepthLimited(
              frame,
              call,
              current,
              `same-package call ${binding.name} exceeds the one-module analysis limit`,
              {
                trustedEntryBoundary: binding.targetInfo?.isEntry === true,
                missingPrincipalBoundary: args.length === 0,
              },
            );
          }
        } else {
          const invoked = await this.invokeFunction(
            binding.target.info,
            unwrapped(binding.target.node),
            binding.name,
            args,
            frame,
            current,
            importDepth + (importedWorkspaceBody ? 0 : 1),
          );
          return this.applyInvokedReturn(call, invoked, current);
        }
      } else if (binding.targetInfo && this.project.moduleMayReachSensitive(binding.targetInfo)) {
        const reason = importDepth >= MAX_SAME_PACKAGE_IMPORT_DEPTH ? REASON.UNPROVABLE : null;
        const detail = reason
          ? `same-package call ${binding.name} exceeds the one-module analysis limit`
          : `same-package call ${binding.name} reaches sensitive module ${binding.targetInfo.relPath}`;
        return reason
          ? this.recordDepthLimited(frame, call, current, detail, {
              trustedEntryBoundary: binding.targetInfo?.isEntry === true,
            })
          : this.recordSensitive(frame, call, current, detail);
      }
    }

    if (
      binding?.kind === "import-surface" &&
      !transactionCall &&
      !directSensitive &&
      this.callPassesTrackedCapability(frame, args, current)
    ) {
      return this.invalidateCallEscapes(
        this.recordSensitive(
          frame,
          call,
          current,
          `imported object surface ${binding.name} receives a tracked DB/storage/queue capability but its callee body cannot be resolved`,
          REASON.UNPROVABLE,
        ),
        call,
        args,
      );
    }

    if (
      binding?.kind === "import-surface" &&
      binding.targetInfo &&
      this.project.moduleMayReachSensitive(binding.targetInfo)
    ) {
      const reason = importDepth >= MAX_SAME_PACKAGE_IMPORT_DEPTH ? REASON.UNPROVABLE : null;
      const detail = reason
        ? `dynamic service/repository surface ${binding.name} exceeds the one-module analysis limit`
        : `service/repository call ${binding.name} reaches ${binding.targetInfo.relPath}`;
      return reason
        ? this.invalidateCallEscapes(
            this.recordDepthLimited(frame, call, current, detail, {
              trustedEntryBoundary: binding.targetInfo?.isEntry === true,
            }),
            call,
            args,
          )
        : this.invalidateCallEscapes(
            this.recordSensitive(frame, call, current, detail),
            call,
            args,
          );
    }

    const sensitive = directSensitive;
    if (sensitive) {
      if (transactionCall) return current;
      if (this.isProvenPureStorageUrlCall(frame, call, sensitive)) {
        this.covered = true;
        return current;
      }
      const computed = sensitive.startsWith("computed ");
      const unsupportedStorage = sensitive.startsWith("unsupported storage origin");
      current = this.recordSensitive(
        frame,
        call,
        current,
        computed
          ? `${sensitive}; computed dispatch cannot be proven`
          : unsupportedStorage
            ? `${sensitive}; module is not in the trusted storage registry`
            : sensitive,
        computed || unsupportedStorage ? REASON.UNPROVABLE : null,
        sensitive.startsWith("storage ") ? "storage" : "principal",
      );
      if (!computed && !unsupportedStorage) {
        current = this.markPrincipalDerivedOperationResult(call, current, frame, context);
      }
    }
    return current;
  }

  async invokeFunction(info, node, name, args, callerFrame, states, importDepth) {
    const stackKey = `${info.path}:${node.pos}:${name}`;
    if (this.callStack.includes(stackKey)) {
      if (this.project.moduleMayReachSensitive(info)) {
        if (
          this.structuredCallbackDepth > 0 &&
          !this.recursiveCallCarriesPrincipal(
            callerFrame,
            args,
            states,
          )
        ) {
          return this.analyzeRecursiveStructuredCallbackArguments(
            callerFrame,
            args,
            states,
            importDepth,
          );
        }
        return this.recordDepthLimited(
          callerFrame,
          node,
          states,
          `recursive call ${name} cannot be proven`,
        );
      }
      return states;
    }
    this.callStack.push(stackKey);
    try {
      const callbacks = new Map();
      const invocationId = ++this.invocationSequence;
      const callerStatesByLineage = new Map();
      // Invocation-local origin maps are keyed by the caller's exact declaration node.
      // Callee parameters and locals with the same text therefore cannot sever or
      // fabricate propagation back to the caller.
      const callerOriginsByLineage = new Map();
      const calleeStates = states.map((state, index) => {
        const next = cloneState(state);
        const lineage = `${invocationId}:${index}`;
        const callerOrigins = [];
        next.callLineage.push(lineage);
        callerStatesByLineage.set(lineage, state);
        next.dbBindings = new Set(info.staticDbAliases);
        next.storageBindings = new Set(info.staticStorageAliases);
        next.storageNamespaceBindings = new Set(info.staticStorageNamespaceAliases);
        next.unsupportedStorageBindings = new Set(
          info.staticUnsupportedStorageAliases,
        );
        next.unsupportedStorageNamespaceBindings = new Set(
          info.staticUnsupportedStorageNamespaceAliases,
        );
        next.queueBindings = new Set();
        next.pending = new Set();
        next.returnedDerived = false;
        next.returnedPrincipalKind = null;
        next.returnedCapability = false;
        if (info.path !== callerFrame.info.path) {
          next.principalBindings = new Set();
          next.principalObjects = new Set();
          next.principalCarrierObjects = new Set();
          next.principalDerivedBindings = new Set();
          next.principalDerivedObjects = new Set();
          next.principalAuthorityBindings = new Map();
          next.booleanFacts = new Map();
          next.principalPropertyBindings = new Map();
          next.principalCollectionPropertyBindings = new Map();
          next.principalOwnerNeutralBindings = moduleOwnerNeutralBindings(info);
          next.principalImmutableObjectBindings = new Set();
          next.principalAliases = new Map();
          next.invalidatedPrincipalAliases = new Set();
          next.optionalPrincipalParameters = new Set();
          next.knownPrincipalBindings = new Set();
          next.nullableDerivedBindings = new Set();
          next.safeDerivedCollections = new Set();
          next.knownNonEmptyCollections = new Set();
          next.definitelyEmptyCollections = new Set();
          next.poisonedCollections = new Set();
          next.signedMediaClaims = new Set();
          next.nonNullableSignedMediaClaims = new Set();
          next.authorizedSignedMediaClaims = new Set();
        }
        for (let index = 0; index < (node.parameters?.length ?? 0); index += 1) {
          const parameter = node.parameters[index];
          const argument = args[index];
          for (const parameterName of identifierNames(parameter.name)) {
            detachPrincipalAlias(next, parameterName);
            clearPrincipalName(next, parameterName);
            next.poisonedCollections.delete(parameterName);
          }
          if (!argument) continue;
          const argumentNode = unwrapped(argument);
          if (ts.isIdentifier(parameter.name)) {
            const directArgument = ts.isIdentifier(argumentNode);
            const origins = new Map();
            for (const reference of escapedAliasIdentifierNodes(argumentNode)) {
              const binding = visibleBindingNode(
                callerFrame.info.sourceFile,
                reference,
                reference.text,
              );
              if (!binding || origins.has(binding)) continue;
              const objectTainted = principalNameIsObjectTainted(
                state,
                reference.text,
              );
              const collectionTracked = Boolean(
                this.collectionAliasesForState(state, reference.text).size,
              );
              if (!objectTainted && !collectionTracked) continue;
              origins.set(binding, { name: reference.text });
              // A nested object/array carrier receives only the reference-capable
              // authority reachable from its exact caller binding. Mutating the carrier
              // then poisons/invalidates that mapped origin at invocation exit.
              // Reachability is NOT identity: a carrier that merely contains a principal
              // is never itself a principal object, so its own `.ownerId` stays subject
              // to the default-deny per-property provenance below.
              if (!directArgument && objectTainted) {
                next.principalCarrierObjects.add(parameter.name.text);
              }
              if (!directArgument && collectionTracked) {
                if (state.safeDerivedCollections.has(reference.text)) {
                  next.safeDerivedCollections.add(parameter.name.text);
                }
                if (state.knownNonEmptyCollections.has(reference.text)) {
                  next.knownNonEmptyCollections.add(parameter.name.text);
                }
                if (state.definitelyEmptyCollections.has(reference.text)) {
                  next.definitelyEmptyCollections.add(parameter.name.text);
                }
                if (state.poisonedCollections.has(reference.text)) {
                  next.poisonedCollections.add(parameter.name.text);
                }
              }
            }
            if (origins.size) {
              callerOrigins.push({
                parameterName: parameter.name.text,
                origins,
              });
            }
          }
          if (
            ts.isIdentifier(parameter.name) &&
            ts.isIdentifier(argumentNode)
          ) {
            if (state.safeDerivedCollections.has(argumentNode.text)) {
              next.safeDerivedCollections.add(parameter.name.text);
            }
            if (state.knownNonEmptyCollections.has(argumentNode.text)) {
              next.knownNonEmptyCollections.add(parameter.name.text);
            }
            if (state.definitelyEmptyCollections.has(argumentNode.text)) {
              next.definitelyEmptyCollections.add(parameter.name.text);
            }
            if (state.poisonedCollections.has(argumentNode.text)) {
              next.poisonedCollections.add(parameter.name.text);
            }
          }
          const parameterShape = principalParameterShape(parameter, info);
          const ownerAuthorityKind =
            parameterShape?.kind === "object" || ts.isObjectBindingPattern(parameter.name)
              ? principalOwnerAuthorityKind(
                  argumentNode,
                  state,
                  this.principalDerivedExpressions,
                )
              : null;
          const callerPrincipalKind =
            principalExpressionKind(
              argumentNode,
              state,
              this.principalDerivedExpressions,
            ) ??
            (this.resolvedPrincipalExpression(callerFrame, argumentNode, state)
              ? "object"
              : ownerAuthorityKind
                ? "object"
                : null);
          const principalKind = callerPrincipalKind;
          // Exact per-property provenance is the only authority a carrier argument can
          // hand its callee. It applies to every module, not just workspace packages:
          // it is strictly narrower than a blanket object grant. Round 25 shipped this
          // claiming it default-denied every unproven property, which was false — the
          // spread branch of principalPropertiesForExpression merged unknown content
          // without revoking anything, so `{ ownerId: gate.ownerId, ...input }` kept the
          // guard's proof even though the spread overwrites ownerId at runtime. Round 28
          // made that branch revoke what a spread can supply but cannot prove; the
          // default-deny claim only holds because of that revocation, so read the two
          // together (see auth-guard-fence-design.md §43).
          const argumentPrincipalProperties = principalPropertiesForExpression(
            argumentNode,
            state,
            this.principalDerivedExpressions,
          );
          if (ts.isObjectBindingPattern(parameter.name)) {
            if (principalKind) {
              for (const element of parameter.name.elements) {
                const sourceName = propertyNameText(element.propertyName ?? element.name);
                if (sourceName === "ownerId") {
                  for (const name of identifierNames(element.name)) {
                    next.principalBindings.add(name);
                  }
                  continue;
                }
                if (
                  !sourceName ||
                  !isPrincipalIdentityKeyName(sourceName) ||
                  !ts.isObjectLiteralExpression(argumentNode)
                ) {
                  continue;
                }
                const propertyValue = objectPropertyInitializer(argumentNode, sourceName);
                if (
                  propertyValue &&
                  principalExpressionKind(
                    propertyValue,
                    state,
                    this.principalDerivedExpressions,
                  ) === "derived"
                ) {
                  for (const name of identifierNames(element.name)) {
                    next.principalDerivedBindings.add(name);
                  }
                }
              }
            }
            for (const element of parameter.name.elements) {
              const sourceName = propertyNameText(
                element.propertyName ?? element.name,
              );
              const propertyValue =
                sourceName && ts.isObjectLiteralExpression(argumentNode)
                  ? objectPropertyInitializer(argumentNode, sourceName)
                  : null;
              const booleanFact = propertyValue
                ? booleanFactForExpression(propertyValue, state)
                : null;
              if (booleanFact !== null) {
                for (const bindingName of identifierNames(element.name)) {
                  next.booleanFacts.set(bindingName, booleanFact);
                }
              }
              const propertyKind = sourceName
                ? argumentPrincipalProperties.get(sourceName)
                : null;
              if (!propertyKind) continue;
              for (const bindingName of identifierNames(element.name)) {
                if (propertyKind === "binding") {
                  next.principalBindings.add(bindingName);
                } else if (propertyKind === "object") {
                  next.principalObjects.add(bindingName);
                } else {
                  next.principalDerivedBindings.add(bindingName);
                }
              }
            }
            continue;
          }
          if (!ts.isIdentifier(parameter.name)) continue;
          const booleanFact = booleanFactForExpression(argumentNode, state);
          if (booleanFact !== null) {
            next.booleanFacts.set(parameter.name.text, booleanFact);
          }
          for (const [propertyName, propertyKind] of argumentPrincipalProperties) {
            next.principalPropertyBindings.set(
              principalPropertyKey(parameter.name.text, propertyName),
              propertyKind,
            );
          }
          if (ts.isObjectLiteralExpression(argumentNode)) {
            let hasUnknownProperties = false;
            for (const property of argumentNode.properties) {
              let propertyName = null;
              let callbackExpression = null;
              if (
                ts.isPropertyAssignment(property) &&
                !ts.isComputedPropertyName(property.name)
              ) {
                propertyName = propertyNameText(property.name);
                callbackExpression = property.initializer;
              } else if (
                ts.isMethodDeclaration(property) &&
                !ts.isComputedPropertyName(property.name)
              ) {
                propertyName = propertyNameText(property.name);
                callbackExpression = property;
              } else if (ts.isShorthandPropertyAssignment(property)) {
                propertyName = property.name.text;
                callbackExpression = property.name;
              } else {
                hasUnknownProperties = true;
                continue;
              }
              if (!propertyName || !callbackExpression) {
                hasUnknownProperties = true;
                continue;
              }
              const resolution = this.callbackArgumentResolution(
                callerFrame,
                callbackExpression,
                importDepth,
              );
              callbacks.set(
                `${parameter.name.text}.${propertyName}`,
                resolution.kind === "analyzable"
                  ? {
                      info: resolution.frame.info,
                      node: resolution.node,
                      callerFrame: resolution.frame,
                      importDepth: resolution.importDepth ?? importDepth,
                      structured: true,
                    }
                  : {
                      info: callerFrame.info,
                      node: null,
                      callerFrame,
                      structured: true,
                      unresolved: true,
                    },
              );
            }
            if (hasUnknownProperties) {
              callbacks.set(`${parameter.name.text}.*`, {
                info: callerFrame.info,
                node: null,
                callerFrame,
                structured: true,
                unresolved: true,
              });
            }
          }
          const callbackResolution = this.callbackArgumentResolution(
            callerFrame,
            argumentNode,
            importDepth,
          );
          if (callbackResolution.kind === "analyzable") {
            callbacks.set(parameter.name.text, {
              info: callbackResolution.frame.info,
              node: callbackResolution.node,
              callerFrame: callbackResolution.frame,
              importDepth: callbackResolution.importDepth ?? importDepth,
            });
          } else {
            const carriesDb = this.expressionTaintsDb(
              callerFrame,
              argumentNode,
              state,
            );
            const carriesStorage = this.expressionTaintsStorage(
              callerFrame,
              argumentNode,
              state,
            );
            const carriesStorageNamespace = this.expressionTaintsStorageNamespace(
              callerFrame,
              argumentNode,
              state,
            );
            const carriesUnsupportedStorage =
              this.expressionTaintsUnsupportedStorage(
                callerFrame,
                argumentNode,
                state,
              );
            const carriesUnsupportedStorageNamespace =
              this.expressionTaintsUnsupportedStorageNamespace(
                callerFrame,
                argumentNode,
                state,
              );
            if (carriesDb) {
              next.dbBindings.add(parameter.name.text);
            }
            if (carriesStorage) {
              next.storageBindings.add(parameter.name.text);
            }
            if (carriesStorageNamespace) {
              next.storageNamespaceBindings.add(parameter.name.text);
            }
            if (carriesUnsupportedStorage) {
              next.unsupportedStorageBindings.add(parameter.name.text);
            }
            if (carriesUnsupportedStorageNamespace) {
              next.unsupportedStorageNamespaceBindings.add(parameter.name.text);
            }
            if (
              !carriesDb &&
              !carriesStorage &&
              !carriesStorageNamespace &&
              !carriesUnsupportedStorage &&
              !carriesUnsupportedStorageNamespace &&
              this.expressionContainsTrackedCapability(
                callerFrame,
                argumentNode,
                state,
              )
            ) {
              // The carrier shape is outside the bounded capability model. Keep it
              // tainted across the remaining call boundary so it cannot disappear.
              next.dbBindings.add(parameter.name.text);
            }
            if (
              (ts.isIdentifier(argumentNode) && state.queueBindings.has(argumentNode.text)) ||
              this.isGetBossCall(callerFrame, argumentNode)
            ) {
              next.queueBindings.add(parameter.name.text);
            }
            if (principalKind === "derived") {
              next.principalDerivedBindings.add(parameter.name.text);
            } else if (principalKind === "object" || parameterShape?.kind === "object") {
              if (principalKind) next.principalObjects.add(parameter.name.text);
            } else if (principalKind === "binding") {
              next.principalBindings.add(parameter.name.text);
            }
            const aliasSource = directAliasIdentifier(argumentNode);
            if (aliasSource) {
              copySignedMediaTrust(
                next,
                state,
                aliasSource,
                parameter.name.text,
              );
            }
            if (
              aliasSource &&
              principalNameIsObjectTainted(state, aliasSource) &&
              (
                principalKind === "object" ||
                principalKind === "derived" ||
                state.signedMediaClaims.has(aliasSource)
              )
            ) {
              if (principalKind === "derived") {
                next.principalDerivedObjects.add(parameter.name.text);
              }
            }
          }
        }
        callerOriginsByLineage.set(lineage, callerOrigins);
        return next;
      });
      const inheritedFunctions =
        info.path === callerFrame.info.path
          ? new Map(callerFrame.localFunctions)
          : new Map();
      for (const [localName, localNode] of scopedFunctionBindings(node)) {
        inheritedFunctions.set(localName, localNode);
      }
      const frame = makeFrame(info, node, name, callbacks, inheritedFunctions);
      let preparedStates = calleeStates;
      for (const parameter of node.parameters ?? []) {
        if (!parameter.initializer) continue;
        preparedStates = await this.asyncExpression(
          parameter.initializer,
          preparedStates,
          frame,
          { kind: "consumed" },
          importDepth,
        );
      }
      let flow;
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        let returned = await this.asyncExpression(
          node.body,
          preparedStates,
          frame,
          { kind: "consumed" },
          importDepth,
        );
        returned = returned.map((state) => {
          const next = cloneState(state);
          const expressionKind = principalExpressionKind(
            node.body,
            state,
            this.principalDerivedExpressions,
          ) ?? principalCollectionExpressionKind(
            node.body,
            state,
            this.principalDerivedExpressions,
          );
          const authorityKind = principalOwnerAuthorityKind(
            node.body,
            state,
            this.principalDerivedExpressions,
          );
          const kind = expressionKind ?? (authorityKind ? "derived" : null);
          next.returnedPrincipalKind = kind;
          next.returnedDerived = kind === "derived";
          next.returnedCapability = this.expressionContainsTrackedCapability(
            frame,
            node.body,
            state,
          );
          return next;
        });
        flow = { continuing: [], returned };
      } else {
        flow = await this.analyzeBlock(node.body, preparedStates, frame, importDepth);
      }
      const exits = dedupeStates([...flow.returned, ...flow.continuing]);
      return exits.map((state) => {
        const next = cloneState(state);
        const lineage = next.callLineage.pop();
        const callerBase =
          callerStatesByLineage.get(lineage) ??
          states[0] ??
          createState(callerFrame.info);
        const callerOrigins = callerOriginsByLineage.get(lineage) ?? [];
        next.dbBindings = new Set(callerBase.dbBindings);
        next.storageBindings = new Set(callerBase.storageBindings);
        next.storageNamespaceBindings = new Set(
          callerBase.storageNamespaceBindings,
        );
        next.unsupportedStorageBindings = new Set(
          callerBase.unsupportedStorageBindings,
        );
        next.unsupportedStorageNamespaceBindings = new Set(
          callerBase.unsupportedStorageNamespaceBindings,
        );
        next.queueBindings = new Set(callerBase.queueBindings);
        next.pending = new Set(callerBase.pending);
        next.principalBindings = new Set(callerBase.principalBindings);
        next.principalObjects = new Set(callerBase.principalObjects);
        next.principalCarrierObjects = new Set(callerBase.principalCarrierObjects);
        next.principalDerivedBindings = new Set(callerBase.principalDerivedBindings);
        next.principalDerivedObjects = new Set(callerBase.principalDerivedObjects);
        next.principalAuthorityBindings = new Map(callerBase.principalAuthorityBindings);
        next.booleanFacts = new Map(callerBase.booleanFacts);
        next.principalPropertyBindings = new Map(
          callerBase.principalPropertyBindings,
        );
        next.principalCollectionPropertyBindings = new Map(
          callerBase.principalCollectionPropertyBindings,
        );
        next.principalOwnerNeutralBindings = new Set(
          callerBase.principalOwnerNeutralBindings,
        );
        next.principalImmutableObjectBindings = new Set(
          callerBase.principalImmutableObjectBindings,
        );
        next.principalAliases = clonePrincipalAliases(callerBase.principalAliases);
        next.invalidatedPrincipalAliases = new Set(callerBase.invalidatedPrincipalAliases);
        next.signedMediaClaims = new Set(callerBase.signedMediaClaims);
        next.nonNullableSignedMediaClaims = new Set(
          callerBase.nonNullableSignedMediaClaims,
        );
        next.authorizedSignedMediaClaims = new Set(
          callerBase.authorizedSignedMediaClaims,
        );
        next.optionalPrincipalParameters = new Set(callerBase.optionalPrincipalParameters);
        next.knownPrincipalBindings = new Set(callerBase.knownPrincipalBindings);
        next.nullableDerivedBindings = new Set(callerBase.nullableDerivedBindings);
        next.safeDerivedCollections = new Set(callerBase.safeDerivedCollections);
        next.knownNonEmptyCollections = new Set(
          callerBase.knownNonEmptyCollections,
        );
        next.definitelyEmptyCollections = new Set(
          callerBase.definitelyEmptyCollections,
        );
        next.poisonedCollections = new Set(callerBase.poisonedCollections);
        if (info.path === callerFrame.info.path) {
          for (const name of callerBase.definitelyEmptyCollections) {
            if (!state.definitelyEmptyCollections.has(name)) {
              next.definitelyEmptyCollections.delete(name);
            }
          }
          for (const name of state.poisonedCollections) {
            if (
              !callerBase.poisonedCollections.has(name) &&
              this.collectionAliasesForState(callerBase, name).size
            ) {
              next.poisonedCollections.add(name);
            }
          }
          for (const invalidated of state.invalidatedPrincipalAliases) {
            if (callerBase.invalidatedPrincipalAliases.has(invalidated)) continue;
            if (
              principalNameIsTainted(next, invalidated) ||
              next.principalAliases.has(invalidated)
            ) {
              invalidatePrincipalAlias(next, invalidated);
            }
          }
        }
        for (const { parameterName, origins } of callerOrigins) {
          for (const origin of origins.values()) {
            if (
              callerBase.definitelyEmptyCollections.has(origin.name) &&
              !state.definitelyEmptyCollections.has(parameterName)
            ) {
              next.definitelyEmptyCollections.delete(origin.name);
            }
            if (state.knownNonEmptyCollections.has(parameterName)) {
              next.knownNonEmptyCollections.add(origin.name);
            }
            if (state.poisonedCollections.has(parameterName)) {
              invalidatePrincipalAlias(next, origin.name);
              next.poisonedCollections.add(origin.name);
              continue;
            }
            if (state.invalidatedPrincipalAliases.has(parameterName)) {
              invalidatePrincipalAlias(next, origin.name);
            }
          }
        }
        return next;
      });
    } finally {
      this.callStack.pop();
    }
  }

  async analyzeVariableDeclaration(declaration, states, frame, importDepth) {
    const names = identifierNames(declaration.name);
    let current = states.map((state) => {
      const next = cloneState(state);
      for (const name of names) {
        detachPrincipalAlias(next, name);
        clearPrincipalName(next, name);
        next.poisonedCollections.delete(name);
      }
      return next;
    });
    if (!declaration.initializer) return current;
    const emptySafeCollection =
      ts.isIdentifier(declaration.name) &&
      ts.isArrayLiteralExpression(unwrapped(declaration.initializer)) &&
      unwrapped(declaration.initializer).elements.length === 0;
    if (
      ts.isIdentifier(declaration.name) &&
      unwrapped(declaration.initializer).kind === ts.SyntaxKind.NullKeyword
    ) {
      current = current.map((state) => {
        const next = cloneState(state);
        next.nullableDerivedBindings.add(declaration.name.text);
        return next;
      });
    }
    if (isFunctionLike(unwrapped(declaration.initializer))) return current;
    const dbLoad = dbPackageLoadCall(declaration.initializer);
    const dynamicDbNames = dbLoad ? dynamicDbBindingNames(declaration.name) : [];
    if (dynamicDbNames.length) {
      return current.map((state) => {
        const next = cloneState(state);
        for (const name of dynamicDbNames) next.dbBindings.add(name);
        return next;
      });
    }
    const ownerNames = ts.isObjectBindingPattern(declaration.name)
      ? declaration.name.elements.flatMap((element) =>
          propertyNameText(element.propertyName ?? element.name) === "ownerId"
            ? identifierNames(element.name)
            : [],
        )
      : [];
    const context = ts.isIdentifier(declaration.name)
      ? { kind: "assigned", name: declaration.name.text, derivedNames: names }
      : ts.isObjectBindingPattern(declaration.name)
        ? { kind: "destructured", ownerNames, derivedNames: names }
        : { kind: "consumed", derivedNames: names };
    current = await this.asyncExpression(
      declaration.initializer,
      current,
      frame,
      context,
      importDepth,
    );
    if (names.length === 1) {
      const name = names[0];
      current = current.map((state) => {
        const next = cloneState(state);
        if (
          this.expressionContainsTrackedCapability(
            frame,
            declaration.initializer,
            state,
          )
        ) {
          next.dbBindings.add(name);
        }
        if (this.expressionTaintsDb(frame, declaration.initializer, state)) next.dbBindings.add(name);
        if (this.expressionTaintsStorage(frame, declaration.initializer, state)) {
          next.storageBindings.add(name);
        }
        if (
          this.expressionTaintsStorageNamespace(
            frame,
            declaration.initializer,
            state,
          )
        ) {
          next.storageNamespaceBindings.add(name);
        }
        if (
          this.expressionTaintsUnsupportedStorage(
            frame,
            declaration.initializer,
            state,
          )
        ) {
          next.unsupportedStorageBindings.add(name);
        }
        if (
          this.expressionTaintsUnsupportedStorageNamespace(
            frame,
            declaration.initializer,
            state,
          )
        ) {
          next.unsupportedStorageNamespaceBindings.add(name);
        }
        if (this.isGetBossCall(frame, declaration.initializer)) next.queueBindings.add(name);
        const principalKind = principalExpressionKind(
          declaration.initializer,
          state,
          this.principalDerivedExpressions,
        );
        const initializerNode = unwrapped(declaration.initializer);
        const derivedObjectExpression =
          this.principalDerivedObjectExpressions.has(initializerNode);
        const derivedObjectMember = isCanonicalDerivedObjectMember(
          initializerNode,
          state,
          this.principalDerivedObjectExpressions,
        );
        const authorityKind =
          ts.isObjectLiteralExpression(initializerNode) ||
          (ts.isIdentifier(initializerNode) &&
            state.principalAuthorityBindings.has(initializerNode.text))
            ? principalOwnerAuthorityKind(
                declaration.initializer,
                state,
                this.principalDerivedExpressions,
              )
            : null;
        const ownerNeutral = expressionIsOwnerNeutral(
          declaration.initializer,
          state.principalOwnerNeutralBindings,
        );
        const immutablePrincipalObject =
          Boolean(authorityKind) &&
          isImmutablePrincipalObjectDeclaration(
            declaration,
            state,
            frame,
            this.principalDerivedExpressions,
          );
        next.principalImmutableObjectBindings.delete(name);
        if (principalKind === "object" && ts.isObjectBindingPattern(declaration.name)) {
          for (const element of declaration.name.elements) {
            if (propertyNameText(element.propertyName ?? element.name) !== "ownerId") continue;
            for (const binding of identifierNames(element.name)) {
              next.principalBindings.add(binding);
            }
          }
        } else if (principalKind === "object") {
          next.principalObjects.add(name);
        } else if (principalKind === "binding") {
          next.principalBindings.add(name);
        } else if (principalKind === "derived") {
          next.principalDerivedBindings.add(name);
        }
        if (derivedObjectMember) {
          next.principalDerivedObjects.add(name);
        }
        if (principalKind === "derived" && derivedObjectExpression) {
          next.principalDerivedObjects.add(name);
        }
        if (authorityKind && ts.isIdentifier(declaration.name)) {
          next.principalAuthorityBindings.set(name, authorityKind);
        }
        if (
          ts.isIdentifier(declaration.name) &&
          this.project.isWorkspacePackageModule(frame.info)
        ) {
          for (const [propertyName, propertyKind] of principalPropertiesForExpression(
            declaration.initializer,
            state,
            this.principalDerivedExpressions,
          )) {
            next.principalPropertyBindings.set(
              principalPropertyKey(name, propertyName),
              propertyKind,
            );
          }
        }
        if (ownerNeutral && ts.isIdentifier(declaration.name)) {
          next.principalOwnerNeutralBindings.add(name);
        }
        if (immutablePrincipalObject) {
          next.principalImmutableObjectBindings.add(name);
        }
        const aliasSource = ts.isIdentifier(declaration.name)
          ? directAliasIdentifier(declaration.initializer)
          : null;
        if (aliasSource && principalNameIsObjectTainted(state, aliasSource)) {
          copySignedMediaTrust(next, state, aliasSource, name);
          if (principalKind === "derived") next.principalDerivedObjects.add(name);
          linkPrincipalAliases(next, name, aliasSource);
        }
        if (
          aliasSource &&
          state.definitelyEmptyCollections.has(aliasSource)
        ) {
          next.definitelyEmptyCollections.add(name);
        }
        if (aliasSource && state.poisonedCollections.has(aliasSource)) {
          next.poisonedCollections.add(name);
        }
        if (next.principalBindings.has(name)) {
          next.knownPrincipalBindings.add(name);
        }
        return next;
      });
      if (emptySafeCollection) {
        current = current.map((state) => {
          const next = cloneState(state);
          next.principalDerivedBindings.add(name);
          next.principalDerivedObjects.add(name);
          next.safeDerivedCollections.add(name);
          next.definitelyEmptyCollections.add(name);
          return next;
        });
      }
    } else if (names.length) {
      current = current.map((state) => {
        const next = cloneState(state);
        const principalKind = principalExpressionKind(
          declaration.initializer,
          state,
          this.principalDerivedExpressions,
        );
        if (principalKind === "binding") {
          for (const name of names) next.principalBindings.add(name);
        } else if (principalKind === "derived") {
          if (ts.isObjectBindingPattern(declaration.name)) {
            for (const element of declaration.name.elements) {
              if (
                !isPrincipalIdentityKeyName(
                  propertyNameText(element.propertyName ?? element.name) ?? "",
                )
              ) {
                continue;
              }
              for (const name of identifierNames(element.name)) {
                next.principalDerivedBindings.add(name);
              }
            }
          } else {
            for (const name of names) next.principalDerivedBindings.add(name);
          }
        } else if (
          principalKind === "object" &&
          ts.isObjectBindingPattern(declaration.name)
        ) {
          for (const element of declaration.name.elements) {
            if (propertyNameText(element.propertyName ?? element.name) !== "ownerId") continue;
            for (const name of identifierNames(element.name)) next.principalBindings.add(name);
          }
        }
        if (
          ts.isObjectBindingPattern(declaration.name) &&
          this.project.isWorkspacePackageModule(frame.info)
        ) {
          const initializerProperties = principalPropertiesForExpression(
            declaration.initializer,
            state,
            this.principalDerivedExpressions,
          );
          for (const element of declaration.name.elements) {
            const sourceName = propertyNameText(
              element.propertyName ?? element.name,
            );
            const propertyKind = sourceName
              ? initializerProperties.get(sourceName)
              : null;
            if (!propertyKind) continue;
            for (const bindingName of identifierNames(element.name)) {
              if (propertyKind === "binding") {
                next.principalBindings.add(bindingName);
              } else if (propertyKind === "object") {
                next.principalObjects.add(bindingName);
              } else {
                next.principalDerivedBindings.add(bindingName);
              }
            }
          }
        }
        return next;
      });
    }
    return current;
  }

  async analyzeStatement(statement, states, frame, importDepth) {
    if (!states.length) return { continuing: [], returned: [] };

    if (ts.isBlock(statement)) return this.analyzeBlock(statement, states, frame, importDepth);
    if (ts.isVariableStatement(statement)) {
      let current = states;
      for (const declaration of statement.declarationList.declarations) {
        current = await this.analyzeVariableDeclaration(declaration, current, frame, importDepth);
      }
      return { continuing: current, returned: [] };
    }
    if (ts.isExpressionStatement(statement)) {
      const continuing = await this.asyncExpression(
        statement.expression,
        states,
        frame,
        { kind: "discarded" },
        importDepth,
      );
      return { continuing, returned: [] };
    }
    if (ts.isReturnStatement(statement)) {
      let returned = statement.expression
        ? await this.asyncExpression(
            statement.expression,
            states,
            frame,
            { kind: "consumed" },
            importDepth,
          )
        : states;
      if (statement.expression) {
        returned = returned.map((state) => {
          const next = cloneState(state);
          const expressionKind = principalExpressionKind(
            statement.expression,
            state,
            this.principalDerivedExpressions,
          ) ?? principalCollectionExpressionKind(
            statement.expression,
            state,
            this.principalDerivedExpressions,
          );
          const authorityKind = principalOwnerAuthorityKind(
            statement.expression,
            state,
            this.principalDerivedExpressions,
          );
          const kind = expressionKind ?? (authorityKind ? "derived" : null);
          next.returnedPrincipalKind = kind;
          next.returnedDerived = kind === "derived";
          next.returnedCapability = this.expressionContainsTrackedCapability(
            frame,
            statement.expression,
            state,
          );
          return next;
        });
      }
      return { continuing: [], returned };
    }
    if (ts.isThrowStatement(statement)) {
      let returned = await this.asyncExpression(
        statement.expression,
        states,
        frame,
        { kind: "consumed" },
        importDepth,
      );
      returned = returned.map((state) => {
        const next = cloneState(state);
        next.returnedPrincipalKind = "abrupt";
        next.returnedDerived = false;
        next.returnedCapability = false;
        return next;
      });
      return { continuing: [], returned };
    }
    if (ts.isIfStatement(statement)) {
      let condition = await this.asyncExpression(
        statement.expression,
        states,
        frame,
        { kind: "consumed" },
        importDepth,
      );
      if (statement.expression.kind === ts.SyntaxKind.TrueKeyword) {
        return this.analyzeStatement(statement.thenStatement, condition, frame, importDepth);
      }
      if (statement.expression.kind === ts.SyntaxKind.FalseKeyword) {
        return statement.elseStatement
          ? this.analyzeStatement(statement.elseStatement, condition, frame, importDepth)
          : { continuing: condition, returned: [] };
      }
      let thenStates = this.applyAdminNonErrorBranch(
        condition.map(cloneState),
        statement.expression,
        true,
      );
      thenStates = this.applyBooleanFactBranch(
        thenStates,
        statement.expression,
        true,
      );
      thenStates = this.applyQueueTruthiness(
        thenStates,
        statement.expression,
        true,
      );
      thenStates = this.applySignedMediaTruthiness(
        thenStates,
        statement.expression,
        true,
      );
      thenStates = this.applyOwnerMatchBranch(
        thenStates,
        frame,
        statement.expression,
        true,
      );
      thenStates = thenStates.map((state) => {
        const next = cloneState(state);
        const expression = unwrapped(statement.expression);
        if (
          ts.isIdentifier(expression) &&
          state.knownPrincipalBindings.has(expression.text)
        ) {
          next.principalBindings.add(expression.text);
        }
        if (
          ts.isIdentifier(expression) &&
          state.nullableDerivedBindings.has(expression.text)
        ) {
          next.principalDerivedBindings.add(expression.text);
        }
        return next;
      });
      thenStates = this.applyValidatedInputs(
        thenStates,
        this.truthyResultNames(statement.expression, true),
      );
      const thenNonEmptyCollection = collectionAssertedNonEmpty(
        statement.expression,
        true,
      );
      thenStates = correlateNonEmptyCollectionStates(
        thenStates,
        thenNonEmptyCollection?.name,
      );
      const thenFlow = await this.analyzeStatement(
        statement.thenStatement,
        thenStates,
        frame,
        importDepth,
      );
      let elseStates = this.applyAdminNonErrorBranch(
        condition.map(cloneState),
        statement.expression,
        false,
      );
      elseStates = this.applyBooleanFactBranch(
        elseStates,
        statement.expression,
        false,
      );
      elseStates = this.applyQueueTruthiness(
        elseStates,
        statement.expression,
        false,
      );
      elseStates = this.applySignedMediaTruthiness(
        elseStates,
        statement.expression,
        false,
      );
      elseStates = this.applyOwnerMatchBranch(
        elseStates,
        frame,
        statement.expression,
        false,
      );
      elseStates = this.applyValidatedInputs(
        elseStates,
        this.truthyResultNames(statement.expression, false),
      );
      const elseNonEmptyCollection = collectionAssertedNonEmpty(
        statement.expression,
        false,
      );
      elseStates = correlateNonEmptyCollectionStates(
        elseStates,
        elseNonEmptyCollection?.name,
      );
      const elseFlow = statement.elseStatement
        ? await this.analyzeStatement(
            statement.elseStatement,
            elseStates,
            frame,
            importDepth,
          )
        : { continuing: elseStates, returned: [] };
      return {
        continuing: dedupeStates([...thenFlow.continuing, ...elseFlow.continuing]),
        returned: dedupeStates([...thenFlow.returned, ...elseFlow.returned]),
      };
    }
    if (
      ts.isWhileStatement(statement) ||
      ts.isDoStatement(statement) ||
      ts.isForStatement(statement) ||
      ts.isForInStatement(statement) ||
      ts.isForOfStatement(statement)
    ) {
      let entered = states.map(cloneState);
      if (
        (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) &&
        !ts.isVariableDeclarationList(statement.initializer)
      ) {
        const assignedNames = assignmentTargetRootNames(statement.initializer);
        const memberRoots = assignmentTargetMemberRootNames(statement.initializer);
        for (const name of memberRoots) {
          entered = this.invalidatePrincipalRoot(entered, name);
        }
        entered = entered.map((state) => {
          const next = cloneState(state);
          for (const name of assignedNames) {
            if (memberRoots.has(name)) continue;
            detachPrincipalAlias(next, name);
            clearPrincipalName(next, name);
          }
          return next;
        });
      }
      if (
        (ts.isForOfStatement(statement) || ts.isForInStatement(statement)) &&
        ts.isVariableDeclarationList(statement.initializer)
      ) {
        entered = entered.map((state) => {
          const next = cloneState(state);
          for (const declaration of statement.initializer.declarations) {
            for (const name of identifierNames(declaration.name)) {
              detachPrincipalAlias(next, name);
              clearPrincipalName(next, name);
              next.poisonedCollections.delete(name);
            }
          }
          const iterableKind = principalExpressionKind(
            statement.expression,
            state,
            this.principalDerivedExpressions,
          );
          const iterableRoot = ts.isIdentifier(unwrapped(statement.expression))
            ? unwrapped(statement.expression).text
            : null;
          const iterableIsDerivedObject = Boolean(
            iterableRoot &&
            state.principalDerivedObjects.has(iterableRoot),
          );
          if (iterableKind === "derived") {
            for (const declaration of statement.initializer.declarations) {
              for (const name of identifierNames(declaration.name)) {
                next.principalDerivedBindings.add(name);
                if (
                  iterableIsDerivedObject &&
                  ts.isIdentifier(declaration.name)
                ) {
                  next.principalDerivedObjects.add(name);
                }
              }
            }
          } else if (
            ts.isIdentifier(unwrapped(statement.expression)) &&
            state.safeDerivedCollections.has(unwrapped(statement.expression).text)
          ) {
            for (const declaration of statement.initializer.declarations) {
              for (const name of identifierNames(declaration.name)) {
                next.principalDerivedBindings.add(name);
              }
            }
          }
          if (iterableRoot) {
            const collectionProperties = principalPropertiesForRoot(
              state.principalCollectionPropertyBindings,
              iterableRoot,
            );
            for (const declaration of statement.initializer.declarations) {
              if (ts.isIdentifier(declaration.name)) {
                for (const [propertyName, propertyKind] of collectionProperties) {
                  next.principalPropertyBindings.set(
                    principalPropertyKey(
                      declaration.name.text,
                      propertyName,
                    ),
                    propertyKind,
                  );
                }
                continue;
              }
              if (!ts.isObjectBindingPattern(declaration.name)) continue;
              for (const element of declaration.name.elements) {
                const sourceName = propertyNameText(
                  element.propertyName ?? element.name,
                );
                const propertyKind = sourceName
                  ? collectionProperties.get(sourceName)
                  : null;
                if (!propertyKind) continue;
                for (const bindingName of identifierNames(element.name)) {
                  if (propertyKind === "binding") {
                    next.principalBindings.add(bindingName);
                  } else if (propertyKind === "object") {
                    next.principalObjects.add(bindingName);
                  } else {
                    next.principalDerivedBindings.add(bindingName);
                  }
                }
              }
            }
          }
          return next;
        });
      }
      if (ts.isForStatement(statement) && statement.initializer) {
        if (ts.isVariableDeclarationList(statement.initializer)) {
          for (const declaration of statement.initializer.declarations) {
            entered = await this.analyzeVariableDeclaration(
              declaration,
              entered,
              frame,
              importDepth,
            );
          }
        } else {
          entered = await this.asyncExpression(
            statement.initializer,
            entered,
            frame,
            { kind: "discarded" },
            importDepth,
          );
        }
      }
      const condition =
        ts.isForStatement(statement) ? statement.condition : statement.expression;
      if (condition) {
        entered = await this.asyncExpression(
          condition,
          entered,
          frame,
          { kind: "consumed" },
          importDepth,
        );
      }
      const body = await this.analyzeStatement(statement.statement, entered, frame, importDepth);
      let oneIteration = body.continuing;
      if (ts.isForStatement(statement) && statement.incrementor) {
        oneIteration = await this.asyncExpression(
          statement.incrementor,
          oneIteration,
          frame,
          { kind: "discarded" },
          importDepth,
        );
      }
      return {
        continuing: dedupeStates([...states.map(cloneState), ...oneIteration]),
        returned: body.returned,
      };
    }
    if (ts.isTryStatement(statement)) {
      const tryFlow = await this.analyzeBlock(
        statement.tryBlock,
        states.map(cloneState),
        frame,
        importDepth,
      );
      const catchStates =
        statement.catchClause?.variableDeclaration
          ? states.map((state) => {
              const next = cloneState(state);
              for (const name of identifierNames(
                statement.catchClause.variableDeclaration.name,
              )) {
                detachPrincipalAlias(next, name);
                clearPrincipalName(next, name);
                next.poisonedCollections.delete(name);
              }
              return next;
            })
          : states.map(cloneState);
      const catchFlow = statement.catchClause
        ? await this.analyzeBlock(
            statement.catchClause.block,
            catchStates,
            frame,
            importDepth,
          )
        : { continuing: [], returned: [] };
      let continuing = dedupeStates([...tryFlow.continuing, ...catchFlow.continuing]);
      let returned = dedupeStates([...tryFlow.returned, ...catchFlow.returned]);
      if (statement.finallyBlock) {
        const finalContinuing = await this.analyzeBlock(
          statement.finallyBlock,
          continuing,
          frame,
          importDepth,
        );
        const finalReturned = await this.analyzeBlock(
          statement.finallyBlock,
          returned,
          frame,
          importDepth,
        );
        continuing = finalContinuing.continuing;
        returned = dedupeStates([
          ...finalContinuing.returned,
          ...finalReturned.continuing,
          ...finalReturned.returned,
        ]);
      }
      return { continuing, returned };
    }
    if (ts.isSwitchStatement(statement)) {
      const base = await this.asyncExpression(
        statement.expression,
        states,
        frame,
        { kind: "consumed" },
        importDepth,
      );
      const branches = [];
      const returned = [];
      for (const clause of statement.caseBlock.clauses) {
        let clauseStates = base.map(cloneState);
        if (ts.isCaseClause(clause)) {
          clauseStates = await this.asyncExpression(
            clause.expression,
            clauseStates,
            frame,
            { kind: "consumed" },
            importDepth,
          );
        }
        const flow = await this.analyzeStatements(
          clause.statements,
          clauseStates,
          frame,
          importDepth,
        );
        branches.push(...flow.continuing);
        returned.push(...flow.returned);
      }
      if (!statement.caseBlock.clauses.some(ts.isDefaultClause)) branches.push(...base);
      return { continuing: dedupeStates(branches), returned: dedupeStates(returned) };
    }
    if (
      ts.isFunctionDeclaration(statement) ||
      ts.isClassDeclaration(statement) ||
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isImportDeclaration(statement) ||
      ts.isExportDeclaration(statement) ||
      ts.isEmptyStatement(statement)
    ) {
      return { continuing: states, returned: [] };
    }

    let current = states;
    for (const child of statement.getChildren(frame.info.sourceFile)) {
      current = await this.asyncExpression(
        child,
        current,
        frame,
        { kind: "consumed" },
        importDepth,
      );
    }
    return { continuing: current, returned: [] };
  }

  async analyzeStatements(statements, states, frame, importDepth) {
    let continuing = states;
    const returned = [];
    for (const statement of statements) {
      const flow = await this.analyzeStatement(statement, continuing, frame, importDepth);
      continuing = flow.continuing;
      returned.push(...flow.returned);
    }
    return { continuing: dedupeStates(continuing), returned: dedupeStates(returned) };
  }

  async analyzeBlock(block, states, frame, importDepth) {
    if (!block) return { continuing: states, returned: [] };
    const scopedDeclarationNames = block.statements.flatMap((statement) =>
      ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)
        ? identifierNames(statement.name)
        : [],
    );
    const scopedStates = scopedDeclarationNames.length
      ? states.map((state) => {
          const next = cloneState(state);
          for (const name of scopedDeclarationNames) {
            detachPrincipalAlias(next, name);
            clearPrincipalName(next, name);
          }
          return next;
        })
      : states;
    return this.analyzeStatements(block.statements, scopedStates, frame, importDepth);
  }

  async analyzeTarget(target) {
    if (target.unknown || !isFunctionLike(unwrapped(target.node))) {
      if (this.project.moduleMayReachSensitive(target.info)) {
        this.covered = true;
        this.addDiagnostic(
          target.info,
          target.node,
          REASON.UNPROVABLE,
          "exported value is callable or dispatches dynamically, but its body cannot be resolved",
        );
      }
      return;
    }
    const node = unwrapped(target.node);
    const localFunctions = new Map(target.localFunctions ?? []);
    for (const [localName, localNode] of scopedFunctionBindings(node)) {
      localFunctions.set(localName, localNode);
    }
    const frame = makeFrame(target.info, node, target.name, new Map(), localFunctions);
    this.originResolvesPrincipal = this.frameContainsPrincipalResolver(frame);
    let states = [
      this.internalAllowed
        ? applyPrincipalParameters(
            createState(target.info),
            node,
            target.inheritedPrincipal ?? null,
            target.info,
          )
        : createState(target.info),
    ];
    const importDepth = target.info.path === this.originInfo.path ? 0 : 1;
    this.callStack.push(`${target.info.path}:${node.pos}:${target.name}`);
    try {
      for (const parameter of node.parameters ?? []) {
        if (!parameter.initializer) continue;
        states = await this.asyncExpression(
          parameter.initializer,
          states,
          frame,
          { kind: "consumed" },
          importDepth,
        );
      }
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        await this.asyncExpression(
          node.body,
          states,
          frame,
          { kind: "consumed" },
          importDepth,
        );
      } else {
        await this.analyzeBlock(
          node.body,
          states,
          frame,
          importDepth,
        );
      }
    } finally {
      this.callStack.pop();
    }
  }
}

function returnedObjectLiterals(node) {
  if (!node.body || !ts.isBlock(node.body)) return [];
  const objects = [];
  const localObjects = new Map();
  for (const statement of node.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        ts.isObjectLiteralExpression(unwrapped(declaration.initializer))
      ) {
        localObjects.set(declaration.name.text, unwrapped(declaration.initializer));
      }
    }
  }
  const visit = (child, isRoot = false) => {
    if (!isRoot && isFunctionLike(child)) return;
    if (ts.isReturnStatement(child) && child.expression) {
      const expression = unwrapped(child.expression);
      if (ts.isObjectLiteralExpression(expression)) objects.push(expression);
      else if (ts.isIdentifier(expression) && localObjects.has(expression.text)) {
        objects.push(localObjects.get(expression.text));
      }
      return;
    }
    ts.forEachChild(child, (nested) => visit(nested));
  };
  visit(node.body, true);
  return objects;
}

function factorySurfaceTargets(target) {
  if (target.unknown || !isFunctionLike(unwrapped(target.node))) return [];
  const node = unwrapped(target.node);
  const localFunctions = scopedFunctionBindings(node);
  const inheritedState = target.info.isEntry
    ? createState(target.info)
    : applyPrincipalParameters(createState(target.info), node);
  const inheritedPrincipal = {
    principalBindings: [...inheritedState.principalBindings],
    principalObjects: [...inheritedState.principalObjects],
    principalDerivedBindings: [...inheritedState.principalDerivedBindings],
    principalDerivedObjects: [...inheritedState.principalDerivedObjects],
    optionalPrincipalParameters: [...inheritedState.optionalPrincipalParameters],
  };
  const targets = [];
  for (const object of returnedObjectLiterals(node)) {
    for (const property of object.properties) {
      let name = null;
      let functionNode = null;
      if (ts.isShorthandPropertyAssignment(property)) {
        name = property.name.text;
        functionNode = localFunctions.get(name) ?? null;
      } else if (ts.isPropertyAssignment(property)) {
        name = propertyNameText(property.name);
        const initializer = unwrapped(property.initializer);
        if (isFunctionLike(initializer)) functionNode = initializer;
        else if (ts.isIdentifier(initializer)) {
          functionNode = localFunctions.get(initializer.text) ?? null;
        }
      } else if (ts.isMethodDeclaration(property)) {
        name = propertyNameText(property.name);
        functionNode = property;
      }
      if (!name || !functionNode) continue;
      targets.push({
        info: target.info,
        node: functionNode,
        name: `${target.name}.${name}`,
        unknown: false,
        localFunctions,
        inheritedPrincipal,
      });
    }
  }
  return targets;
}

function parseExemptions(path) {
  if (!path || !existsSync(path)) return [];
  const entries = [];
  for (const [index, raw] of readFileSync(path, "utf8").split(/\r?\n/u).entries()) {
    if (!raw || raw.startsWith("#")) continue;
    const fields = raw.split("\t");
    if (fields.length !== 4 || fields.some((field) => !field.trim())) {
      throw new Error(
        `${slash(path)}:${index + 1}: expected path<TAB>export<TAB>reason<TAB>justification`,
      );
    }
    const [entryPath, exportName, reason, justification] = fields;
    if (!Object.values(REASON).includes(reason)) {
      throw new Error(`${slash(path)}:${index + 1}: unknown reason ${reason}`);
    }
    entries.push({
      path: entryPath,
      exportName,
      reason,
      justification,
      line: index + 1,
      key: `${entryPath}\0${exportName}\0${reason}`,
    });
  }
  return entries;
}

function productionSourceFiles(repoRoot, sourceRoots) {
  const out = [];
  for (const root of sourceRoots) {
    const absoluteRoot = isAbsolute(root) ? root : join(repoRoot, root);
    for (const file of walkSourceFiles(absoluteRoot)) {
      const relPath = slash(relative(repoRoot, file));
      if (isTestOrFixturePath(file) || EXCLUDED_PRODUCTION_FILES.has(relPath)) continue;
      out.push(file);
    }
  }
  return [...new Set(out)].sort();
}

export async function analyzeAuthGuards({
  repoRoot = REPO_ROOT,
  sourceRoots = DEFAULT_SOURCE_ROOTS,
  entryFiles = null,
  exemptionsPath = DEFAULT_EXEMPTIONS_PATH,
  trustedAuthGuardPaths = DEFAULT_TRUSTED_AUTH_GUARD_PATHS,
  trustedStoragePaths = null,
} = {}) {
  const absoluteRoot = resolve(repoRoot);
  const configuredTrustedStoragePaths =
    trustedStoragePaths ??
    (absoluteRoot === REPO_ROOT ? DEFAULT_TRUSTED_STORAGE_PATHS : []);
  const files = entryFiles
    ? entryFiles.map((file) => (isAbsolute(file) ? file : join(absoluteRoot, file)))
    : productionSourceFiles(absoluteRoot, sourceRoots);
  const exemptionFile = exemptionsPath
    ? isAbsolute(exemptionsPath)
      ? exemptionsPath
      : join(absoluteRoot, exemptionsPath)
    : null;
  const exemptions = parseExemptions(exemptionFile);
  const project = new SemanticProject({
    repoRoot: absoluteRoot,
    sourceFiles: files,
    trustedAuthGuardPaths,
    trustedStoragePaths: configuredTrustedStoragePaths,
    reviewedExemptions: exemptions,
  });
  const fileResults = [];

  for (const file of files) {
    const info = project.getModule(file);
    if (!info) continue;
    const exports = project.exportTargets(info);
    const entries = [];
    for (const [exportName, target] of exports) {
      if (target.unknown && !ROUTE_EXPORT_NAMES.has(exportName)) continue;
      const analyzer = new EntryAnalyzer(project, info, exportName);
      await analyzer.analyzeTarget(target);
      if (analyzer.covered || analyzer.diagnostics.length) {
        entries.push({
          exportName,
          covered: analyzer.covered,
          classification: analyzer.adminCovered
            ? "ADMIN-PASS"
            : analyzer.internalCovered
              ? "INTERNAL-PASS"
              : "PASS",
          diagnostics: analyzer.diagnostics,
        });
      }
      for (const surfaceTarget of factorySurfaceTargets(target)) {
        const surfaceName = surfaceTarget.name;
        const surfaceAnalyzer = new EntryAnalyzer(project, info, surfaceName);
        await surfaceAnalyzer.analyzeTarget(surfaceTarget);
        if (surfaceAnalyzer.covered || surfaceAnalyzer.diagnostics.length) {
          entries.push({
            exportName: surfaceName,
            covered: surfaceAnalyzer.covered,
            classification: surfaceAnalyzer.adminCovered
              ? "ADMIN-PASS"
              : surfaceAnalyzer.internalCovered
                ? "INTERNAL-PASS"
                : "PASS",
            diagnostics: surfaceAnalyzer.diagnostics,
          });
        }
      }
    }

    const diagnosedUnboundLoads = new Set(
      entries
        .flatMap((entry) => entry.diagnostics)
        .filter((diagnostic) => diagnostic.reason === REASON.UNPROVABLE)
        .map((diagnostic) => `${diagnostic.implementationPath}:${diagnostic.line}`),
    );
    const uncoveredDbLoads = info.unboundDbLoads.filter(
      (node) => !diagnosedUnboundLoads.has(`${info.relPath}:${lineOf(info, node)}`),
    );
    if (uncoveredDbLoads.length) {
      const analyzer = new EntryAnalyzer(project, info, "<dynamic-db-load>");
      for (const node of uncoveredDbLoads) {
        analyzer.addDiagnostic(
          info,
          node,
          REASON.UNPROVABLE,
          "dynamic @fikirtive/db load cannot be bound to a statically tracked Prisma alias",
        );
      }
      entries.push({
        exportName: "<dynamic-db-load>",
        covered: true,
        classification: "PASS",
        diagnostics: analyzer.diagnostics,
      });
    }

    // A sensitive construct that exists in a callable closure but could not be connected to a
    // concrete export is not invisible: the file is covered and must be refactored or exempted.
    const hasCallableExport = [...exports].some(
      ([exportName, target]) => !target.unknown || ROUTE_EXPORT_NAMES.has(exportName),
    );
    if (info.directSensitive && !entries.length && hasCallableExport) {
      const analyzer = new EntryAnalyzer(project, info, "<exports>");
      analyzer.addDiagnostic(
        info,
        info.firstSensitiveNode,
        REASON.UNPROVABLE,
        "sensitive operation exists but no exported callable path could be resolved",
      );
      entries.push({
        exportName: "<exports>",
        covered: true,
        classification: "PASS",
        diagnostics: analyzer.diagnostics,
      });
    }

    if (entries.length) {
      fileResults.push({
        path: info.relPath,
        entries,
        diagnostics: entries.flatMap((entry) => entry.diagnostics),
      });
    }
  }

  const rawDiagnostics = fileResults.flatMap((file) => file.diagnostics);
  const exemptionByKey = new Map(exemptions.map((entry) => [entry.key, entry]));
  const matchedExemptionKeys = new Set();
  const unexpected = [];
  const exempted = [];

  for (const diagnostic of rawDiagnostics) {
    const key = `${diagnostic.path}\0${diagnostic.exportName}\0${diagnostic.reason}`;
    const exemption = exemptionByKey.get(key);
    if (exemption) {
      matchedExemptionKeys.add(key);
      exempted.push({ diagnostic, exemption });
    } else {
      unexpected.push(diagnostic);
    }
  }
  const staleExemptions = exemptions.filter((entry) => !matchedExemptionKeys.has(entry.key));

  return {
    ok: unexpected.length === 0 && staleExemptions.length === 0,
    files: fileResults,
    diagnostics: rawDiagnostics,
    unexpected,
    exempted,
    staleExemptions,
    exemptions,
    sourceFiles: files,
  };
}

export function formatResult(result) {
  const lines = [];
  const counts = {
    PASS: 0,
    "INTERNAL-PASS": 0,
    "ADMIN-PASS": 0,
    EXEMPT: 0,
    FINDING: 0,
  };
  lines.push(`auth-guard-fence: ${result.ok ? "PASS" : "FAIL"}`);
  for (const file of result.files) {
    const unexpected = result.unexpected.filter((entry) => entry.path === file.path);
    const exempted = result.exempted.filter(({ diagnostic }) => diagnostic.path === file.path);
    if (unexpected.length) {
      counts.FINDING += 1;
      lines.push(`FINDING ${file.path}`);
      for (const diagnostic of unexpected) {
        const location = `${diagnostic.implementationPath}:${diagnostic.line}`;
        const via =
          diagnostic.implementationPath === diagnostic.path
            ? ""
            : ` (via ${diagnostic.path}#${diagnostic.exportName})`;
        lines.push(
          `  ${location}${via} ${diagnostic.exportName} ${diagnostic.reason}: ${diagnostic.detail}`,
        );
      }
    } else if (exempted.length) {
      counts.EXEMPT += 1;
      const entries = exempted
        .map(
          ({ diagnostic }) =>
            `${diagnostic.implementationPath}:${diagnostic.line} ${diagnostic.exportName}:${diagnostic.reason}`,
        )
        .join(", ");
      lines.push(`EXEMPT ${file.path} [${entries}]`);
    } else if (file.entries.some((entry) => entry.classification === "ADMIN-PASS")) {
      counts["ADMIN-PASS"] += 1;
      const entries = file.entries
        .filter((entry) => entry.classification === "ADMIN-PASS")
        .map((entry) => entry.exportName)
        .join(", ");
      lines.push(`ADMIN-PASS ${file.path} [${entries}]`);
    } else if (file.entries.some((entry) => entry.classification === "INTERNAL-PASS")) {
      counts["INTERNAL-PASS"] += 1;
      const entries = file.entries
        .filter((entry) => entry.classification === "INTERNAL-PASS")
        .map((entry) => entry.exportName)
        .join(", ");
      lines.push(`INTERNAL-PASS ${file.path} [${entries}]`);
    } else {
      counts.PASS += 1;
      lines.push(`PASS ${file.path}`);
    }
  }
  for (const exemption of result.staleExemptions) {
    lines.push(
      `STALE ${exemption.path}:${exemption.line} ${exemption.exportName} ${exemption.reason}: ${exemption.justification}`,
    );
  }
  lines.push(
    `summary: PASS=${counts.PASS} INTERNAL-PASS=${counts["INTERNAL-PASS"]} ADMIN-PASS=${counts["ADMIN-PASS"]} EXEMPT=${counts.EXEMPT} FINDING=${counts.FINDING}; ${result.files.length} covered files; ${result.unexpected.length} finding(s); ${result.exempted.length} reviewed exemption(s); ${result.staleExemptions.length} stale exemption(s)`,
  );
  return lines.join("\n");
}

function parseCliArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--root") options.repoRoot = argv[++index];
    else if (flag === "--source") (options.sourceRoots ??= []).push(argv[++index]);
    else if (flag === "--entry") (options.entryFiles ??= []).push(argv[++index]);
    else if (flag === "--no-exemptions") options.exemptionsPath = null;
    else if (flag === "--exemptions") options.exemptionsPath = argv[++index];
    else throw new Error(`unknown argument: ${flag}`);
  }
  return options;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === SCRIPT_PATH;
if (isMain) {
  try {
    const result = await analyzeAuthGuards(parseCliArgs(process.argv.slice(2)));
    const output = formatResult(result);
    (result.ok ? console.log : console.error)(output);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error("auth-guard-fence: FAIL");
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  }
}
