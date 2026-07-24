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

import { existsSync, readFileSync, readdirSync } from "node:fs";
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
export const DEFAULT_SOURCE_ROOTS = ["apps/web/lib", "apps/web/app/api"];
export const DEFAULT_EXEMPTIONS_PATH = "scripts/ci/auth-guard-exemptions.txt";
export const DEFAULT_TRUSTED_AUTH_GUARD_PATHS = ["apps/web/lib/auth-guard.ts"];

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

export const INTERNAL_OWNER_DERIVER_NAMES = Object.freeze(["requireWorker"]);

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
    normalized.includes("/fixtures/") ||
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

function rootIdentifier(expression) {
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
  return ts.isIdentifier(node) ? node.text : null;
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

function cloneState(state) {
  return {
    guarded: state.guarded,
    pending: new Set(state.pending),
    dbBindings: new Set(state.dbBindings),
    queueBindings: new Set(state.queueBindings),
    principalBindings: new Set(state.principalBindings),
    principalObjects: new Set(state.principalObjects),
    optionalPrincipalParameters: new Set(state.optionalPrincipalParameters),
    discardedResolver: state.discardedResolver,
    shadowedResolver: state.shadowedResolver,
  };
}

function dedupeStates(states) {
  const seen = new Set();
  const out = [];
  for (const state of states) {
    const key = [
      state.guarded ? "1" : "0",
      [...state.pending].sort().join(","),
      [...state.dbBindings].sort().join(","),
      [...state.queueBindings].sort().join(","),
      [...state.principalBindings].sort().join(","),
      [...state.principalObjects].sort().join(","),
      [...state.optionalPrincipalParameters].sort().join(","),
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
    guarded: false,
    pending: new Set(),
    dbBindings: new Set(info.staticDbAliases),
    queueBindings: new Set(),
    principalBindings: new Set(),
    principalObjects: new Set(),
    optionalPrincipalParameters: new Set(),
    discardedResolver: false,
    shadowedResolver: false,
  };
}

class SemanticProject {
  constructor({ repoRoot, sourceFiles, trustedAuthGuardPaths, reviewedExemptions = [] }) {
    this.repoRoot = resolve(repoRoot);
    this.requestedSourceFiles = [...new Set(sourceFiles.map((file) => resolve(file)))].sort();
    this.trustedAuthGuardPaths = new Set(trustedAuthGuardPaths.map(slash));
    this.reviewedExemptExports = new Set(
      reviewedExemptions.map((entry) => `${entry.path}\0${entry.exportName}`),
    );
    this.modules = new Map();
    this.moduleSensitivity = new Map();
  }

  isReviewedExemptExport(info, exportName) {
    return this.reviewedExemptExports.has(`${info.relPath}\0${exportName}`);
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
      prismaImports: new Set(),
      staticDbAliases: new Set(),
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

    info.staticDbAliases = new Set(info.prismaImports);
    let aliasesChanged = true;
    while (aliasesChanged) {
      aliasesChanged = false;
      for (const statement of info.sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const node of statement.declarationList.declarations) {
          if (!node.initializer) continue;
          let carriesDb = false;
          const inspect = (child, isRoot = false) => {
            if (!isRoot && isFunctionLike(child)) return;
            if (ts.isIdentifier(child) && info.staticDbAliases.has(child.text)) carriesDb = true;
            if (!carriesDb) ts.forEachChild(child, (nested) => inspect(nested));
          };
          inspect(node.initializer, true);
          if (carriesDb) {
            for (const name of identifierNames(node.name)) {
              if (!info.staticDbAliases.has(name)) {
                info.staticDbAliases.add(name);
                aliasesChanged = true;
              }
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

  resolveModuleSpecifier(info, source) {
    let base;
    if (source.startsWith("@/")) base = join(this.repoRoot, "apps/web", source.slice(2));
    else if (source.startsWith(".")) base = resolve(dirname(info.path), source);
    else return null;

    const candidates = [];
    if (SOURCE_EXTENSIONS.includes(extname(base))) candidates.push(base);
    else {
      for (const extension of SOURCE_EXTENSIONS) candidates.push(`${base}${extension}`);
      for (const extension of SOURCE_EXTENSIONS) candidates.push(join(base, `index${extension}`));
    }
    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  resolveLocalTarget(info, local, seen = new Set()) {
    const key = `${info.path}:${local}`;
    if (seen.has(key)) return null;
    seen.add(key);

    const functionNode = info.localFunctions.get(local);
    if (functionNode) return { info, node: functionNode, name: local, unknown: false };

    const initializer = info.localValues.get(local);
    if (initializer) {
      const node = unwrapped(initializer);
      if (isFunctionLike(node)) return { info, node, name: local, unknown: false };
      if (ts.isIdentifier(node)) return this.resolveLocalTarget(info, node.text, seen);
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
            ? { info, node: unwrapped(record.node), name: record.exported, unknown: false }
            : { info, node: record.node, name: record.exported, unknown: true });
        exports.set(record.exported, target);
      } else if (record.kind === "default-expression") {
        const expression = unwrapped(record.node);
        let target = null;
        if (isFunctionLike(expression)) {
          target = { info, node: expression, name: "default", unknown: false };
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
    if (ts.isElementAccessExpression(expression)) {
      const root = rootIdentifier(expression);
      if (root && state.dbBindings.has(root)) return "computed Prisma call";
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

function typeHasRequiredOwnerId(typeNode) {
  if (!typeNode) return false;
  if (ts.isParenthesizedTypeNode(typeNode)) return typeHasRequiredOwnerId(typeNode.type);
  const reference = typeReferenceName(typeNode);
  if (reference && INTERNAL_PRINCIPAL_TYPE_NAMES.includes(reference)) return true;
  if (ts.isIntersectionTypeNode(typeNode)) {
    return typeNode.types.some((part) => typeHasRequiredOwnerId(part));
  }
  if (!ts.isTypeLiteralNode(typeNode)) return false;
  return typeNode.members.some(
    (member) =>
      ts.isPropertySignature(member) &&
      propertyNameText(member.name) === "ownerId" &&
      !member.questionToken &&
      !typeAllowsMissing(member.type),
  );
}

function principalParameterShape(parameter) {
  const required =
    !parameter.questionToken &&
    !parameter.initializer &&
    !typeAllowsMissing(parameter.type);
  const typeName = typeReferenceName(parameter.type);
  const configuredType =
    Boolean(typeName) && INTERNAL_PRINCIPAL_TYPE_NAMES.includes(typeName);
  const structuredOwner = typeHasRequiredOwnerId(parameter.type);

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

function applyPrincipalParameters(state, node, inherited = null) {
  const next = cloneState(state);
  if (inherited) {
    for (const name of inherited.principalBindings ?? []) next.principalBindings.add(name);
    for (const name of inherited.principalObjects ?? []) next.principalObjects.add(name);
    for (const name of inherited.optionalPrincipalParameters ?? []) {
      next.optionalPrincipalParameters.add(name);
    }
  }
  for (const parameter of node.parameters ?? []) {
    const shape = principalParameterShape(parameter);
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

function principalExpressionKind(expression, state) {
  if (!expression) return null;
  const node = unwrapped(expression);
  if (ts.isIdentifier(node)) {
    if (state.principalBindings.has(node.text)) return "binding";
    if (state.principalObjects.has(node.text)) return "object";
    return null;
  }
  if (isFunctionLike(node) || ts.isClassExpression(node)) return null;
  if (ts.isCallExpression(node)) {
    const callee = unwrapped(node.expression);
    if (
      ts.isIdentifier(callee) &&
      INTERNAL_OWNER_DERIVER_NAMES.includes(callee.text) &&
      node.arguments.some(
        (argument) => principalExpressionKind(argument, state) === "object",
      )
    ) {
      return "binding";
    }
  }
  if (ts.isPropertyAccessExpression(node)) {
    const root = rootIdentifier(node.expression);
    if (root && state.principalObjects.has(root)) {
      return node.name.text === "ownerId" ? "binding" : null;
    }
    return principalExpressionKind(node.expression, state);
  }
  if (ts.isElementAccessExpression(node)) {
    const root = rootIdentifier(node.expression);
    if (root && state.principalObjects.has(root)) {
      return node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "ownerId"
        ? "binding"
        : null;
    }
  }

  let sawObject = false;
  for (const child of node.getChildren()) {
    if (child === node) continue;
    const kind = principalExpressionKind(child, state);
    if (kind === "binding") return "binding";
    if (kind === "object") sawObject = true;
  }
  return sawObject ? "object" : null;
}

function operationUsesPrincipal(node, state) {
  if (ts.isTaggedTemplateExpression(node)) {
    if (!ts.isTemplateExpression(node.template)) return false;
    return node.template.templateSpans.some(
      (span) => principalExpressionKind(span.expression, state) === "binding",
    );
  }
  if (!ts.isCallExpression(node) && !ts.isNewExpression(node)) return false;
  return [...(node.arguments ?? [])].some(
    (argument) => principalExpressionKind(argument, state) === "binding",
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
    this.internalAllowed = !originInfo.isEntry;
    this.knownPrincipalBindings = new Set();
    this.callStack = [];
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
    const key = `${diagnostic.path}\0${diagnostic.exportName}\0${diagnostic.reason}`;
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
    if (state.pending.size) return REASON.UNUSED;
    if (state.discardedResolver) return REASON.DISCARDED;
    if (state.shadowedResolver) return REASON.SHADOWED;
    if (this.hasResolverAfter(frame, node.getStart(frame.info.sourceFile))) return REASON.AFTER;
    return REASON.MISSING;
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

  recordSensitive(frame, node, states, detail, reasonOverride = null) {
    this.covered = true;
    for (const state of states) {
      if (reasonOverride) {
        this.addDiagnostic(frame.info, node, reasonOverride, detail);
        continue;
      }
      if (state.guarded) {
        this.resolvedCovered = true;
        continue;
      }
      if (this.internalAllowed && operationUsesPrincipal(node, state)) {
        this.internalCovered = true;
        continue;
      }
      let reason = this.reasonForUnguarded(frame, node, state);
      if (
        this.internalAllowed &&
        (state.principalBindings.size || state.principalObjects.size)
      ) {
        reason = REASON.PARAM_UNUSED;
      } else if (this.internalAllowed && state.optionalPrincipalParameters.size) {
        reason = REASON.PARAM_OPTIONAL;
      }
      this.addDiagnostic(frame.info, node, reason, detail);
    }
    return states;
  }

  recordDepthLimited(frame, node, states, detail, { trustedEntryBoundary = false } = {}) {
    this.covered = true;
    if (trustedEntryBoundary || states.every((state) => state.guarded)) {
      this.resolvedCovered = true;
      return states;
    }
    if (
      this.internalAllowed &&
      states.every((state) => operationUsesPrincipal(node, state))
    ) {
      this.internalCovered = true;
      return states;
    }
    return this.recordSensitive(frame, node, states, detail, REASON.UNPROVABLE);
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

  activateIdentifier(states, name) {
    return states.map((state) => {
      if (!state.pending.has(name)) return state;
      const next = cloneState(state);
      next.pending.delete(name);
      next.guarded = true;
      return next;
    });
  }

  applyResolverUse(states, context) {
    return states.map((state) => {
      const next = cloneState(state);
      if (context.kind === "discarded") {
        next.discardedResolver = true;
      } else if (context.kind === "assigned" && context.name) {
        next.pending.add(context.name);
      } else {
        next.guarded = true;
      }
      return next;
    });
  }

  async asyncExpression(node, states, frame, context, importDepth) {
    if (!node) return states;
    const expression = unwrapped(node);

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
      if (
        expression.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(unwrapped(expression.left))
      ) {
        const assignedName = unwrapped(expression.left).text;
        return right.map((state) => {
          const next = cloneState(state);
          const kind = principalExpressionKind(expression.right, state);
          if (kind === "binding") {
            next.principalBindings.add(assignedName);
            this.knownPrincipalBindings.add(assignedName);
          } else if (kind === "object") {
            next.principalObjects.add(assignedName);
          }
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
    if (
      ts.isPrefixUnaryExpression(expression) ||
      ts.isPostfixUnaryExpression(expression) ||
      ts.isDeleteExpression(expression) ||
      ts.isTypeOfExpression(expression) ||
      ts.isVoidExpression(expression)
    ) {
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
        }
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
          return {
            kind: "import-surface",
            binding: imported,
            targetInfo,
            name: `${imported.imported}.${expression.name.text}`,
          };
        }
      }
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

  async analyzeCallback(callback, states, frame, importDepth, { transaction = false } = {}) {
    const node = unwrapped(callback);
    if (!isFunctionLike(node)) return;
    const callbackStates = states.map((state) => {
      const next = cloneState(state);
      const txParameter = node.parameters?.[0];
      if (transaction && txParameter && ts.isIdentifier(txParameter.name)) {
        next.dbBindings.add(txParameter.name.text);
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
      await this.asyncExpression(
        node.body,
        callbackStates,
        callbackFrame,
        { kind: "consumed" },
        importDepth,
      );
    } else {
      await this.analyzeBlock(node.body, callbackStates, callbackFrame, importDepth);
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
        { kind: "consumed" },
        importDepth,
      );
    }

    for (const argument of args) {
      if (isFunctionLike(unwrapped(argument))) {
        if (transactionCall || !earlyBinding) {
          await this.analyzeCallback(
            argument,
            current,
            frame,
            importDepth,
            { transaction: transactionCall },
          );
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
    }

    if (trustedResolver) return this.applyResolverUse(current, context);

    const binding = earlyBinding;
    if (binding?.kind === "local" || binding?.kind === "callback" || localProducer) {
      const target = localProducer
        ? { info: frame.info, node: localProducer.target, name: localProducer.name }
        : binding;
      const incoming = current.map(cloneState);
      let invoked = await this.invokeFunction(
        target.info,
        target.node,
        target.name,
        args,
        frame,
        current,
        importDepth,
      );
      if (localProducer) {
        invoked = invoked.map((state, index) => {
          const before = incoming[Math.min(index, incoming.length - 1)] ?? createState(frame.info);
          const next = cloneState(state);
          const producedPrincipal = !before.guarded && state.guarded;
          if (!before.guarded && !producedPrincipal) {
            next.guarded = false;
            next.pending = new Set(before.pending);
            next.shadowedResolver = true;
            return next;
          }
          if (context.kind === "discarded") {
            next.guarded = before.guarded;
            next.pending = new Set(before.pending);
            next.discardedResolver = true;
          } else if (context.kind === "assigned" && context.name) {
            next.guarded = before.guarded;
            next.pending = new Set(before.pending);
            next.pending.add(context.name);
          }
          return next;
        });
      }
      return invoked;
    }

    if (binding?.kind === "import") {
      if (
        binding.targetInfo &&
        this.project.isReviewedExemptExport(binding.targetInfo, binding.name)
      ) {
        return current;
      }
      if (
        binding.target &&
        !binding.target.unknown &&
        isFunctionLike(unwrapped(binding.target.node))
      ) {
        if (importDepth >= MAX_SAME_PACKAGE_IMPORT_DEPTH) {
          if (this.project.moduleMayReachSensitive(binding.targetInfo)) {
            return this.recordDepthLimited(
              frame,
              call,
              current,
              `same-package call ${binding.name} exceeds the one-module analysis limit`,
              { trustedEntryBoundary: binding.targetInfo?.isEntry === true },
            );
          }
        } else {
          return this.invokeFunction(
            binding.target.info,
            unwrapped(binding.target.node),
            binding.name,
            args,
            frame,
            current,
            importDepth + 1,
          );
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
      binding.targetInfo &&
      this.project.moduleMayReachSensitive(binding.targetInfo)
    ) {
      const reason = importDepth >= MAX_SAME_PACKAGE_IMPORT_DEPTH ? REASON.UNPROVABLE : null;
      const detail = reason
        ? `dynamic service/repository surface ${binding.name} exceeds the one-module analysis limit`
        : `service/repository call ${binding.name} reaches ${binding.targetInfo.relPath}`;
      return reason
        ? this.recordDepthLimited(frame, call, current, detail, {
            trustedEntryBoundary: binding.targetInfo?.isEntry === true,
          })
        : this.recordSensitive(frame, call, current, detail);
    }

    const sensitive = this.project.directSensitiveKind(
      frame.info,
      call,
      current[0] ?? createState(frame.info),
    );
    if (sensitive) {
      if (transactionCall) return current;
      const computed = sensitive.startsWith("computed ");
      current = this.recordSensitive(
        frame,
        call,
        current,
        computed ? `${sensitive}; computed dispatch cannot be proven` : sensitive,
        computed ? REASON.UNPROVABLE : null,
      );
    }
    return current;
  }

  async invokeFunction(info, node, name, args, callerFrame, states, importDepth) {
    const stackKey = `${info.path}:${node.pos}:${name}`;
    if (this.callStack.includes(stackKey)) {
      if (this.project.moduleMayReachSensitive(info)) {
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
      const calleeStates = states.map((state) => {
        const next = cloneState(state);
        next.dbBindings = new Set(info.staticDbAliases);
        next.queueBindings = new Set();
        next.pending = new Set();
        if (info.path !== callerFrame.info.path) {
          next.principalBindings = new Set();
          next.principalObjects = new Set();
          next.optionalPrincipalParameters = new Set();
        }
        for (let index = 0; index < (node.parameters?.length ?? 0); index += 1) {
          const parameter = node.parameters[index];
          const argument = args[index];
          if (!argument) continue;
          const argumentNode = unwrapped(argument);
          const principalKind = principalExpressionKind(argumentNode, state);
          if (ts.isObjectBindingPattern(parameter.name)) {
            if (principalKind) {
              for (const element of parameter.name.elements) {
                if (propertyNameText(element.propertyName ?? element.name) !== "ownerId") continue;
                for (const name of identifierNames(element.name)) {
                  next.principalBindings.add(name);
                }
              }
            }
            continue;
          }
          if (!ts.isIdentifier(parameter.name)) continue;
          if (isFunctionLike(argumentNode)) {
            callbacks.set(parameter.name.text, {
              info: callerFrame.info,
              node: argumentNode,
              callerFrame,
            });
          } else {
            const inheritedCallback =
              ts.isIdentifier(argumentNode) && callerFrame.callbacks.get(argumentNode.text);
            if (inheritedCallback) callbacks.set(parameter.name.text, inheritedCallback);
            if (this.expressionTaintsDb(callerFrame, argumentNode, state)) {
              next.dbBindings.add(parameter.name.text);
            }
            if (
              (ts.isIdentifier(argumentNode) && state.queueBindings.has(argumentNode.text)) ||
              this.isGetBossCall(callerFrame, argumentNode)
            ) {
              next.queueBindings.add(parameter.name.text);
            }
            const parameterShape = principalParameterShape(parameter);
            if (principalKind === "object" || parameterShape?.kind === "object") {
              if (principalKind) next.principalObjects.add(parameter.name.text);
            } else if (principalKind === "binding") {
              next.principalBindings.add(parameter.name.text);
            }
          }
        }
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
      let flow;
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        const returned = await this.asyncExpression(
          node.body,
          calleeStates,
          frame,
          { kind: "consumed" },
          importDepth,
        );
        flow = { continuing: [], returned };
      } else {
        flow = await this.analyzeBlock(node.body, calleeStates, frame, importDepth);
      }
      const exits = dedupeStates([...flow.returned, ...flow.continuing]);
      return exits.map((state) => {
        const next = cloneState(state);
        const callerBase = states[0] ?? createState(callerFrame.info);
        next.dbBindings = new Set(callerBase.dbBindings);
        next.queueBindings = new Set(callerBase.queueBindings);
        next.pending = new Set(callerBase.pending);
        next.principalBindings = new Set(callerBase.principalBindings);
        next.principalObjects = new Set(callerBase.principalObjects);
        next.optionalPrincipalParameters = new Set(callerBase.optionalPrincipalParameters);
        return next;
      });
    } finally {
      this.callStack.pop();
    }
  }

  async analyzeVariableDeclaration(declaration, states, frame, importDepth) {
    if (!declaration.initializer) return states;
    const names = identifierNames(declaration.name);
    if (isFunctionLike(unwrapped(declaration.initializer))) return states;
    const context =
      names.length === 1 ? { kind: "assigned", name: names[0] } : { kind: "consumed" };
    let current = await this.asyncExpression(
      declaration.initializer,
      states,
      frame,
      context,
      importDepth,
    );
    if (names.length === 1) {
      const name = names[0];
      current = current.map((state) => {
        const next = cloneState(state);
        if (this.expressionTaintsDb(frame, declaration.initializer, state)) next.dbBindings.add(name);
        if (this.isGetBossCall(frame, declaration.initializer)) next.queueBindings.add(name);
        const principalKind = principalExpressionKind(declaration.initializer, state);
        if (principalKind === "object") next.principalObjects.add(name);
        else if (principalKind === "binding") next.principalBindings.add(name);
        return next;
      });
      if (current.some((state) => state.principalBindings.has(name))) {
        this.knownPrincipalBindings.add(name);
      }
    } else if (names.length) {
      current = current.map((state) => {
        const next = cloneState(state);
        const principalKind = principalExpressionKind(declaration.initializer, state);
        if (principalKind === "binding") {
          for (const name of names) next.principalBindings.add(name);
        } else if (
          principalKind === "object" &&
          ts.isObjectBindingPattern(declaration.name)
        ) {
          for (const element of declaration.name.elements) {
            if (propertyNameText(element.propertyName ?? element.name) !== "ownerId") continue;
            for (const name of identifierNames(element.name)) next.principalBindings.add(name);
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
      const returned = statement.expression
        ? await this.asyncExpression(
            statement.expression,
            states,
            frame,
            { kind: "consumed" },
            importDepth,
          )
        : states;
      return { continuing: [], returned };
    }
    if (ts.isThrowStatement(statement)) {
      const returned = await this.asyncExpression(
        statement.expression,
        states,
        frame,
        { kind: "consumed" },
        importDepth,
      );
      return { continuing: [], returned };
    }
    if (ts.isIfStatement(statement)) {
      const condition = await this.asyncExpression(
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
      const thenStates = condition.map((state) => {
        const next = cloneState(state);
        const expression = unwrapped(statement.expression);
        if (
          ts.isIdentifier(expression) &&
          this.knownPrincipalBindings.has(expression.text)
        ) {
          next.principalBindings.add(expression.text);
        }
        return next;
      });
      const thenFlow = await this.analyzeStatement(
        statement.thenStatement,
        thenStates,
        frame,
        importDepth,
      );
      const elseFlow = statement.elseStatement
        ? await this.analyzeStatement(
            statement.elseStatement,
            condition.map(cloneState),
            frame,
            importDepth,
          )
        : { continuing: condition.map(cloneState), returned: [] };
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
      const catchFlow = statement.catchClause
        ? await this.analyzeBlock(
            statement.catchClause.block,
            states.map(cloneState),
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
    return this.analyzeStatements(block.statements, states, frame, importDepth);
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
    const states = [
      applyPrincipalParameters(
        createState(target.info),
        node,
        target.inheritedPrincipal ?? null,
      ),
    ];
    this.callStack.push(`${target.info.path}:${node.pos}:${target.name}`);
    try {
      if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
        await this.asyncExpression(
          node.body,
          states,
          frame,
          { kind: "consumed" },
          target.info.path === this.originInfo.path ? 0 : 1,
        );
      } else {
        await this.analyzeBlock(
          node.body,
          states,
          frame,
          target.info.path === this.originInfo.path ? 0 : 1,
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
  const inheritedState = applyPrincipalParameters(createState(target.info), node);
  const inheritedPrincipal = {
    principalBindings: [...inheritedState.principalBindings],
    principalObjects: [...inheritedState.principalObjects],
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
} = {}) {
  const absoluteRoot = resolve(repoRoot);
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
          classification: analyzer.internalCovered ? "INTERNAL-PASS" : "PASS",
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
            classification: surfaceAnalyzer.internalCovered ? "INTERNAL-PASS" : "PASS",
            diagnostics: surfaceAnalyzer.diagnostics,
          });
        }
      }
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
  const counts = { PASS: 0, "INTERNAL-PASS": 0, EXEMPT: 0, FINDING: 0 };
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
          ({ diagnostic }) => `${diagnostic.exportName}:${diagnostic.reason}`,
        )
        .join(", ");
      lines.push(`EXEMPT ${file.path} [${entries}]`);
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
    `summary: PASS=${counts.PASS} INTERNAL-PASS=${counts["INTERNAL-PASS"]} EXEMPT=${counts.EXEMPT} FINDING=${counts.FINDING}; ${result.files.length} covered files; ${result.unexpected.length} finding(s); ${result.exempted.length} reviewed exemption(s); ${result.staleExemptions.length} stale exemption(s)`,
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
