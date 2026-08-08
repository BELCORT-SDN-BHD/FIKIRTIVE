import { createHash } from "node:crypto";

export const WORKFLOW_FORMAT_VERSION = "fikirtive-workflow/v1" as const;
export const WORKFLOW_COMPILER_VERSION = "fikirtive-workflow-compiler/v1" as const;
export const WORKFLOW_MAX_SOURCE_BYTES = 32 * 1024;
export const WORKFLOW_MAX_CONDITIONS = 16;
export const WORKFLOW_MAX_STEPS = 64;

export const WORKFLOW_TRIGGER_TYPES = ["manual", "schedule", "customer_message", "journey_due"] as const;
export type WorkflowTriggerType = (typeof WORKFLOW_TRIGGER_TYPES)[number];

export const WORKFLOW_ACTION_TYPES = ["conversation_reply", "broadcast_run", "wait", "complete"] as const;
export type WorkflowActionType = (typeof WORKFLOW_ACTION_TYPES)[number];

export const WORKFLOW_DEPENDENCY_KINDS = [
  "business_hours_policy",
  "customer_message_template_version",
] as const;
export type WorkflowDependencyKind = (typeof WORKFLOW_DEPENDENCY_KINDS)[number];

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function canonicalValue(value: unknown, depth = 0): JsonValue {
  if (depth > 32) throw new TypeError("Canonical JSON exceeds the maximum depth.");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON numbers must be finite.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalValue(item, depth + 1));
  if (typeof value !== "object") throw new TypeError("Canonical JSON accepts JSON values only.");
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Canonical JSON objects must be plain objects.");
  }
  const output: { [key: string]: JsonValue } = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new TypeError("Canonical JSON contains a forbidden object key.");
    }
    output[key] = canonicalValue((value as Record<string, unknown>)[key], depth + 1);
  }
  return output;
}

/** Deterministic JSON: object keys sorted recursively; array order is semantic and preserved. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

/** Domain-separated SHA-256 over `domain + NUL + canonicalJson(value)`. */
export function canonicalHash(domain: string, value: unknown): string {
  if (!domain || /[\u0000-\u001f\u007f]/.test(domain)) throw new TypeError("Hash domain must be compact text.");
  return createHash("sha256").update(domain).update("\0").update(canonicalJson(value)).digest("hex");
}

export type WorkflowSourceCondition = {
  type: "outside_business_hours";
  policyRef: string;
};

export type WorkflowSourceAction =
  | { type: "conversation_reply"; templateVersionRef: string }
  | { type: "broadcast_run"; templateVersionRef: string }
  | { type: "wait" }
  | { type: "complete" };

export type WorkflowSource = {
  version: typeof WORKFLOW_FORMAT_VERSION;
  name: string;
  trigger: { type: WorkflowTriggerType };
  conditions: WorkflowSourceCondition[];
  steps: Array<{ key: string; action: WorkflowSourceAction }>;
};

export type WorkflowValidationErrorCode =
  | "SOURCE_TOO_LARGE"
  | "UNSUPPORTED_YAML_FEATURE"
  | "MULTI_DOCUMENT"
  | "DUPLICATE_KEY"
  | "INVALID_YAML"
  | "UNKNOWN_KEY"
  | "MISSING_KEY"
  | "INVALID_VALUE"
  | "UNKNOWN_TYPE"
  | "LIMIT_EXCEEDED"
  // #723 — a rule with zero steps is not a rule over the limit. Sharing LIMIT_EXCEEDED with the
  // too-many case made the panel tell merchants to remove steps from a rule that had none.
  | "EMPTY_STEPS"
  | "DUPLICATE_STEP_KEY"
  | "DEPENDENCY_UNAVAILABLE";

export type WorkflowValidationError = {
  code: WorkflowValidationErrorCode;
  path: string;
  line?: number;
  column?: number;
};

export type WorkflowParseResult =
  | { ok: true; value: WorkflowSource; canonicalSourceJson: string }
  | { ok: false; validationState: "invalid"; errors: WorkflowValidationError[] };

type SourceLine = { number: number; indent: number; text: string };

class ParseFailure extends Error {
  constructor(readonly detail: WorkflowValidationError) {
    super(detail.code);
  }
}

const MAX_ERRORS = 32;
const KEY = /^[A-Za-z][A-Za-z0-9]*$|^<<$/;
const STEP_KEY = /^[a-z][a-z0-9_-]{0,63}$/;
const OPAQUE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const HASH_REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const EXPRESSION = /\$\{|\$\(|\{\{|\}\}|<%|%>|`/;
const FORBIDDEN_REF = /^(?:current|latest)$/i;

function pathText(parts: ReadonlyArray<string | number>): string {
  return parts.reduce<string>((path, part) => typeof part === "number" ? `${path}[${part}]` : `${path}.${part}`, "$");
}

function fail(code: WorkflowValidationErrorCode, path: string, line?: SourceLine): never {
  throw new ParseFailure({ code, path, ...(line ? { line: line.number, column: line.indent + 1 } : {}) });
}

function scalar(text: string, path: string, line: SourceLine): string | [] {
  if (text === "[]") return [];
  if (!text || text === "{}" || /^[\[\]{},|>]/.test(text)) fail("UNSUPPORTED_YAML_FEATURE", path, line);
  if (/^[&*!]/.test(text) || EXPRESSION.test(text) || (!text.startsWith('"') && /[#&*!]/.test(text))) {
    fail("UNSUPPORTED_YAML_FEATURE", path, line);
  }
  if (text.startsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== "string") fail("INVALID_YAML", path, line);
      if (EXPRESSION.test(parsed)) fail("UNSUPPORTED_YAML_FEATURE", path, line);
      return parsed;
    } catch (error) {
      if (error instanceof ParseFailure) throw error;
      fail("INVALID_YAML", path, line);
    }
  }
  if (text.startsWith("'") || /:\s/.test(text)) fail("UNSUPPORTED_YAML_FEATURE", path, line);
  return text;
}

function splitEntry(text: string, path: string, line: SourceLine): { key: string; value: string } {
  const colon = text.indexOf(":");
  if (colon < 1) fail("INVALID_YAML", path, line);
  const key = text.slice(0, colon).trim();
  if (!KEY.test(key)) fail("INVALID_YAML", path, line);
  if (key === "<<") fail("UNSUPPORTED_YAML_FEATURE", path, line);
  return { key, value: text.slice(colon + 1).trim() };
}

function parseYamlSubset(lines: SourceLine[]): unknown {
  let cursor = 0;

  const parseBlock = (indent: number, path: Array<string | number>): unknown => {
    const first = lines[cursor];
    if (!first || first.indent !== indent) fail("INVALID_YAML", pathText(path), first);
    if (first.text.startsWith("- ")) {
      const result: unknown[] = [];
      while (cursor < lines.length && lines[cursor]!.indent === indent) {
        const line = lines[cursor]!;
        if (!line.text.startsWith("- ")) fail("INVALID_YAML", pathText(path), line);
        const itemPath = [...path, result.length];
        const initial = splitEntry(line.text.slice(2).trim(), pathText(itemPath), line);
        if (!initial.value) fail("INVALID_YAML", pathText([...itemPath, initial.key]), line);
        const object: Record<string, unknown> = Object.create(null);
        object[initial.key] = scalar(initial.value, pathText([...itemPath, initial.key]), line);
        cursor += 1;
        while (cursor < lines.length && lines[cursor]!.indent === indent + 2) {
          const child = lines[cursor]!;
          if (child.text.startsWith("- ")) fail("INVALID_YAML", pathText(itemPath), child);
          const entry = splitEntry(child.text, pathText(itemPath), child);
          if (Object.hasOwn(object, entry.key)) fail("DUPLICATE_KEY", pathText([...itemPath, entry.key]), child);
          cursor += 1;
          if (entry.value) {
            object[entry.key] = scalar(entry.value, pathText([...itemPath, entry.key]), child);
          } else {
            const nested = lines[cursor];
            if (!nested || nested.indent !== indent + 4) fail("INVALID_YAML", pathText([...itemPath, entry.key]), nested ?? child);
            object[entry.key] = parseBlock(indent + 4, [...itemPath, entry.key]);
          }
        }
        result.push(object);
      }
      return result;
    }

    const result: Record<string, unknown> = Object.create(null);
    while (cursor < lines.length && lines[cursor]!.indent === indent) {
      const line = lines[cursor]!;
      if (line.text.startsWith("- ")) fail("INVALID_YAML", pathText(path), line);
      const entry = splitEntry(line.text, pathText(path), line);
      if (Object.hasOwn(result, entry.key)) fail("DUPLICATE_KEY", pathText([...path, entry.key]), line);
      cursor += 1;
      if (entry.value) {
        result[entry.key] = scalar(entry.value, pathText([...path, entry.key]), line);
      } else {
        const nested = lines[cursor];
        if (!nested || nested.indent !== indent + 2) fail("INVALID_YAML", pathText([...path, entry.key]), nested ?? line);
        result[entry.key] = parseBlock(indent + 2, [...path, entry.key]);
      }
    }
    return result;
  };

  const document = parseBlock(0, []);
  if (cursor !== lines.length) fail("INVALID_YAML", "$", lines[cursor]);
  return document;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addError(errors: WorkflowValidationError[], code: WorkflowValidationErrorCode, path: string): void {
  if (errors.length < MAX_ERRORS) errors.push({ code, path });
}

function closedKeys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[], path: string, errors: WorkflowValidationError[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) addError(errors, "UNKNOWN_KEY", `${path}.${key}`);
  for (const key of required) if (!Object.hasOwn(value, key)) addError(errors, "MISSING_KEY", `${path}.${key}`);
}

function opaqueRef(value: unknown): value is string {
  return typeof value === "string" && OPAQUE_REF.test(value) && !FORBIDDEN_REF.test(value) && !value.includes("://");
}

function validateDocument(document: unknown): WorkflowParseResult {
  const errors: WorkflowValidationError[] = [];
  if (!isRecord(document)) return { ok: false, validationState: "invalid", errors: [{ code: "INVALID_VALUE", path: "$" }] };
  closedKeys(document, ["version", "name", "trigger", "conditions", "steps"], ["version", "name", "trigger", "conditions", "steps"], "$", errors);

  if (document.version !== WORKFLOW_FORMAT_VERSION) addError(errors, "INVALID_VALUE", "$.version");
  const name = typeof document.name === "string" ? document.name.trim().normalize("NFC") : "";
  if (!name || name.length > 160 || /[\u0000-\u001f\u007f]/.test(name)) addError(errors, "INVALID_VALUE", "$.name");

  let trigger: WorkflowSource["trigger"] | undefined;
  if (!isRecord(document.trigger)) addError(errors, "INVALID_VALUE", "$.trigger");
  else {
    closedKeys(document.trigger, ["type"], ["type"], "$.trigger", errors);
    if (!(WORKFLOW_TRIGGER_TYPES as readonly unknown[]).includes(document.trigger.type)) addError(errors, "UNKNOWN_TYPE", "$.trigger.type");
    else trigger = { type: document.trigger.type as WorkflowTriggerType };
  }

  const conditions: WorkflowSourceCondition[] = [];
  if (!Array.isArray(document.conditions)) addError(errors, "INVALID_VALUE", "$.conditions");
  else if (document.conditions.length > WORKFLOW_MAX_CONDITIONS) addError(errors, "LIMIT_EXCEEDED", "$.conditions");
  else for (const [index, raw] of document.conditions.entries()) {
    const path = `$.conditions[${index}]`;
    if (!isRecord(raw)) { addError(errors, "INVALID_VALUE", path); continue; }
    closedKeys(raw, ["type", "policyRef"], ["type", "policyRef"], path, errors);
    if (raw.type !== "outside_business_hours") addError(errors, "UNKNOWN_TYPE", `${path}.type`);
    if (!opaqueRef(raw.policyRef)) addError(errors, "INVALID_VALUE", `${path}.policyRef`);
    if (raw.type === "outside_business_hours" && opaqueRef(raw.policyRef)) conditions.push({ type: raw.type, policyRef: raw.policyRef });
  }

  const steps: WorkflowSource["steps"] = [];
  const seenStepKeys = new Set<string>();
  if (!Array.isArray(document.steps)) addError(errors, "INVALID_VALUE", "$.steps");
  else if (document.steps.length === 0) addError(errors, "EMPTY_STEPS", "$.steps");
  else if (document.steps.length > WORKFLOW_MAX_STEPS) addError(errors, "LIMIT_EXCEEDED", "$.steps");
  else for (const [index, raw] of document.steps.entries()) {
    const path = `$.steps[${index}]`;
    if (!isRecord(raw)) { addError(errors, "INVALID_VALUE", path); continue; }
    closedKeys(raw, ["key", "action"], ["key", "action"], path, errors);
    const key = raw.key;
    if (typeof key !== "string" || !STEP_KEY.test(key)) addError(errors, "INVALID_VALUE", `${path}.key`);
    else if (seenStepKeys.has(key)) addError(errors, "DUPLICATE_STEP_KEY", `${path}.key`);
    else seenStepKeys.add(key);

    let action: WorkflowSourceAction | undefined;
    if (!isRecord(raw.action)) addError(errors, "INVALID_VALUE", `${path}.action`);
    else {
      const type = raw.action.type;
      if (!(WORKFLOW_ACTION_TYPES as readonly unknown[]).includes(type)) {
        closedKeys(raw.action, ["type"], ["type"], `${path}.action`, errors);
        addError(errors, "UNKNOWN_TYPE", `${path}.action.type`);
      } else if (type === "conversation_reply" || type === "broadcast_run") {
        closedKeys(raw.action, ["type", "templateVersionRef"], ["type", "templateVersionRef"], `${path}.action`, errors);
        if (!opaqueRef(raw.action.templateVersionRef)) addError(errors, "INVALID_VALUE", `${path}.action.templateVersionRef`);
        else action = { type, templateVersionRef: raw.action.templateVersionRef };
      } else {
        closedKeys(raw.action, ["type"], ["type"], `${path}.action`, errors);
        action = { type: type as "wait" | "complete" };
      }
    }
    if (typeof key === "string" && STEP_KEY.test(key) && action) steps.push({ key, action });
  }

  if (errors.length || !trigger) return { ok: false, validationState: "invalid", errors };
  const value: WorkflowSource = { version: WORKFLOW_FORMAT_VERSION, name, trigger, conditions, steps };
  return { ok: true, value, canonicalSourceJson: canonicalJson(value) };
}

export function parseWorkflowSource(source: string): WorkflowParseResult {
  if (typeof source !== "string" || Buffer.byteLength(source, "utf8") > WORKFLOW_MAX_SOURCE_BYTES) {
    return { ok: false, validationState: "invalid", errors: [{ code: "SOURCE_TOO_LARGE", path: "$" }] };
  }
  try {
    if (source.startsWith("\uFEFF") || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(source) || source.includes("\t")) {
      fail("UNSUPPORTED_YAML_FEATURE", "$", { number: 1, indent: 0, text: "" });
    }
    const lines: SourceLine[] = [];
    for (const [index, raw] of source.replace(/\r\n?/g, "\n").split("\n").entries()) {
      const trimmedRight = raw.trimEnd();
      const trimmed = trimmedRight.trimStart();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const indent = trimmedRight.length - trimmed.length;
      const line = { number: index + 1, indent, text: trimmed };
      if (trimmed === "---" || trimmed === "..." || trimmed.startsWith("%")) fail("MULTI_DOCUMENT", "$", line);
      if (indent % 2 !== 0 || indent > 8) fail("INVALID_YAML", "$", line);
      lines.push(line);
    }
    if (!lines.length) fail("INVALID_YAML", "$", { number: 1, indent: 0, text: "" });
    return validateDocument(parseYamlSubset(lines));
  } catch (error) {
    const detail = error instanceof ParseFailure ? error.detail : { code: "INVALID_YAML" as const, path: "$" };
    return { ok: false, validationState: "invalid", errors: [detail] };
  }
}

export type WorkflowDependencyResolverInput = {
  ownerId: string;
  kind: WorkflowDependencyKind;
  sourceRef: string;
};

export type ResolvedWorkflowDependency = {
  ownerId: string;
  kind: WorkflowDependencyKind;
  resourceId: string;
  resourceRevision: number;
  contentHash: string;
};

export type WorkflowDependencyResolver = (
  input: WorkflowDependencyResolverInput,
) => Promise<ResolvedWorkflowDependency | null>;

export type WorkflowDependencyManifestEntry = Omit<ResolvedWorkflowDependency, "ownerId">;

export type CompiledWorkflowRule = {
  version: typeof WORKFLOW_FORMAT_VERSION;
  name: string;
  trigger: { type: WorkflowTriggerType };
  conditions: Array<{ type: "outside_business_hours"; dependency: WorkflowDependencyManifestEntry }>;
  steps: Array<{
    key: string;
    action:
      | { type: "conversation_reply" | "broadcast_run"; dependency: WorkflowDependencyManifestEntry }
      | { type: "wait" | "complete" };
  }>;
};

export type WorkflowCompileResult =
  | {
      ok: true;
      validationState: "valid";
      formatVersion: typeof WORKFLOW_FORMAT_VERSION;
      compilerVersion: typeof WORKFLOW_COMPILER_VERSION;
      canonicalSourceJson: string;
      compiledRuleJson: CompiledWorkflowRule;
      canonicalCompiledRuleJson: string;
      dependencyManifestJson: WorkflowDependencyManifestEntry[];
      dependencyHash: string;
      contentHash: string;
    }
  | { ok: false; validationState: "invalid" | "unavailable"; errors: WorkflowValidationError[] };

function validResolvedDependency(
  value: ResolvedWorkflowDependency,
  ownerId: string,
  kind: WorkflowDependencyKind,
): boolean {
  return value.ownerId === ownerId && value.kind === kind && opaqueRef(value.resourceId)
    && Number.isSafeInteger(value.resourceRevision) && value.resourceRevision > 0
    && HASH_REF.test(value.contentHash) && !value.contentHash.includes("://") && !FORBIDDEN_REF.test(value.contentHash);
}

export async function compileWorkflowSource(
  input: { ownerId: string; source: string },
  resolveDependency: WorkflowDependencyResolver,
): Promise<WorkflowCompileResult> {
  const parsed = parseWorkflowSource(input.source);
  if (!parsed.ok) return parsed;
  if (!opaqueRef(input.ownerId) || typeof resolveDependency !== "function") {
    return { ok: false, validationState: "unavailable", errors: [{ code: "DEPENDENCY_UNAVAILABLE", path: "$" }] };
  }

  const cache = new Map<string, WorkflowDependencyManifestEntry>();
  const manifest: WorkflowDependencyManifestEntry[] = [];
  const resolve = async (kind: WorkflowDependencyKind, sourceRef: string, path: string): Promise<WorkflowDependencyManifestEntry | null> => {
    const cacheKey = `${kind}\0${sourceRef}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;
    try {
      const value = await resolveDependency({ ownerId: input.ownerId, kind, sourceRef });
      if (!value || !validResolvedDependency(value, input.ownerId, kind)) return null;
      const entry: WorkflowDependencyManifestEntry = {
        kind: value.kind,
        resourceId: value.resourceId,
        resourceRevision: value.resourceRevision,
        contentHash: value.contentHash,
      };
      cache.set(cacheKey, entry);
      manifest.push(entry);
      return entry;
    } catch {
      void path;
      return null;
    }
  };

  const compiledConditions: CompiledWorkflowRule["conditions"] = [];
  for (const [index, condition] of parsed.value.conditions.entries()) {
    const path = `$.conditions[${index}].policyRef`;
    const dependency = await resolve("business_hours_policy", condition.policyRef, path);
    if (!dependency) return { ok: false, validationState: "unavailable", errors: [{ code: "DEPENDENCY_UNAVAILABLE", path }] };
    compiledConditions.push({ type: condition.type, dependency });
  }

  const compiledSteps: CompiledWorkflowRule["steps"] = [];
  for (const [index, step] of parsed.value.steps.entries()) {
    if (step.action.type === "conversation_reply" || step.action.type === "broadcast_run") {
      const path = `$.steps[${index}].action.templateVersionRef`;
      const dependency = await resolve("customer_message_template_version", step.action.templateVersionRef, path);
      if (!dependency) return { ok: false, validationState: "unavailable", errors: [{ code: "DEPENDENCY_UNAVAILABLE", path }] };
      compiledSteps.push({ key: step.key, action: { type: step.action.type, dependency } });
    } else {
      compiledSteps.push({ key: step.key, action: { type: step.action.type } });
    }
  }

  const dependencyManifestJson = [...new Map(manifest.map((entry) => [canonicalJson(entry), entry])).values()]
    .sort((left, right) => {
      const leftJson = canonicalJson(left);
      const rightJson = canonicalJson(right);
      return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
    });
  const compiledRuleJson: CompiledWorkflowRule = {
    version: parsed.value.version,
    name: parsed.value.name,
    trigger: parsed.value.trigger,
    conditions: compiledConditions,
    steps: compiledSteps,
  };
  const dependencyHash = canonicalHash("fikirtive-workflow-dependencies/v1", dependencyManifestJson);
  const canonicalCompiledRuleJson = canonicalJson(compiledRuleJson);
  const contentHash = canonicalHash("fikirtive-workflow-content/v1", {
    compilerVersion: WORKFLOW_COMPILER_VERSION,
    source: parsed.value,
    compiledRule: compiledRuleJson,
    dependencyHash,
  });
  return {
    ok: true,
    validationState: "valid",
    formatVersion: WORKFLOW_FORMAT_VERSION,
    compilerVersion: WORKFLOW_COMPILER_VERSION,
    canonicalSourceJson: parsed.canonicalSourceJson,
    compiledRuleJson,
    canonicalCompiledRuleJson,
    dependencyManifestJson,
    dependencyHash,
    contentHash,
  };
}
