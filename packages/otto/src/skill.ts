/**
 * defineOttoSkill — the fail-closed skill factory (the "standard").
 *
 * A BUILD-TIME wrapper: it derives needsApproval from a 3-field declaration,
 * enforces fail-closed rules at definition time, and returns an OttoSkill whose
 * `.tool` is a plain @openai/agents tool() — identical in shape to a hand-written one.
 * It sits ON the runtime; it does not run the agent loop.
 *
 * What it enforces (definition time): see docs/superpowers/specs/2026-06-26-otto-skill-framework-design.md §3.1.
 * What it CANNOT enforce (#5/#6 — inside execute): fenced by scripts/check-skill-imports.sh + tests.
 */
import { tool } from "@openai/agents";
import type { RunContext, FunctionTool } from "@openai/agents";
import { z } from "zod";
import type { OttoContext } from "./context.js";

export type Cost = "free" | "spend";
export type Effect = "read" | "write";
export type Reach = "internal" | "external";

export interface OttoSkillSpec<P extends z.ZodObject<any>> {
  name: string;
  description: string;
  parameters: P;
  cost: Cost;
  effect: Effect;
  reach: Reach;
  execute: (input: z.infer<P>, runContext: RunContext<OttoContext>) => Promise<unknown>;
  /** Required when cost === "spend": documents/justifies the exactly-once key. */
  idempotencyKey?: (input: z.infer<P>) => string;
  /** 可选：此 skill 动手前需要的资讯。每个 field 必须也是 `parameters` 的一个 key。
   *  工厂据此 (a) 把问题追加进 description 让模型先问，(b) 在 execute 前预检——
   *  缺字段则跳过 execute、返回 { needMoreInfo }，让 agent 去追问。 */
  requires?: { field: string; question: string }[];
  /** ENGINE-A4 可选：这把工具下**只读**的那几个动作。多动作技能（`manageCanvas` 的
   *  `view`、`manageLibrary` 的 `history`…）整体声明 `effect:"write"`，但其中几个动作只查
   *  不写——轮子死了商家手里什么都没多，按 §7.2⑤ 的口径**不算交付**。
   *  `field` 必须是 `parameters` 的一个 key（就是那个动作判别键，工厂校验），`actions` 是
   *  其中纯读的取值。声明在技能自己家里，所以 runtime 不需要第二份手抄名册。 */
  readOnlyActions?: { field: string; actions: readonly string[] };
}

export interface OttoSkill {
  name: string;
  cost: Cost;
  effect: Effect;
  reach: Reach;
  needsApproval: boolean;
  description: string;
  /** 声明的资讯门（空数组表示无）。 */
  requires: { field: string; question: string }[];
  /** ENGINE-A4：这把工具下只读的那几个动作（未声明则为 null＝每个动作都可能落盘）。 */
  readOnlyActions: { field: string; actions: readonly string[] } | null;
  /** The @openai/agents tool, ready for the agent's `tools` array. */
  tool: FunctionTool<OttoContext, any, unknown>;
}

const IDENTITY_KEYS = [
  "orgId",
  "ownerId",
  "userId",
  "organizationId",
  "tenantId",
  "accountId",
  "org_id",
  "owner_id",
  "user_id",
  "organization_id",
  "tenant_id",
  "account_id",
];

/** Pure: spend OR (external write) needs the boss's approval. */
export function deriveNeedsApproval(cost: Cost, effect: Effect, reach: Reach): boolean {
  return cost === "spend" || (effect === "write" && reach === "external");
}

/**
 * The ONLY strings this module may write into a log line as a category. Every entry is a source
 * literal in this file; none is ever read off the failure value. Built-in error classes only — a
 * custom subclass is deliberately absent and collapses to the generic "Error" (#566 R3 review).
 */
const ERROR_CATEGORIES: ReadonlyArray<readonly [abstract new (...args: never[]) => Error, string]> = [
  [TypeError, "TypeError"],
  [RangeError, "RangeError"],
  [SyntaxError, "SyntaxError"],
  [ReferenceError, "ReferenceError"],
  [EvalError, "EvalError"],
  [URIError, "URIError"],
];

/**
 * Reduce ANY failure value to a fixed, content-free category token for the server log (#566 R2/R3).
 *
 * Skill failure messages routinely carry merchant-controlled text: assertPublicHttpUrl throws
 * `Invalid URL: "<the whole submitted URL>"` and `URL hostname "<host>" is not allowed`, so a
 * private customer domain, an internal service name, or a secret encoded in a subdomain / query
 * string would land in the logs verbatim.
 *
 * R3 review corrected the mechanism, and the correction matters: the previous version READ the
 * instance's `.name` and accepted it if a regex liked its shape. `Error.name` is writable, so
 * `err.name = "TenantSecret123"` passed that regex and was logged verbatim — a regex validates
 * SHAPE, never PROVENANCE. This version reads NOTHING off the value. It tests class membership with
 * `instanceof` and returns a literal defined above, so no string originating from the instance —
 * including one a getter could synthesize on access — can reach the log. `instanceof` triggers no
 * user code beyond a `Symbol.hasInstance` on the built-in classes, which cannot be redefined here.
 *
 * The merchant-facing reason still reaches the merchant: it is the tool's return value, which the
 * model reads and answers with. This function governs the LOG, not the conversation.
 */
export function skillErrorCategory(value: unknown): string {
  if (value instanceof Error) {
    for (const [cls, category] of ERROR_CATEGORIES) if (value instanceof cls) return category;
    return "Error"; // includes every custom subclass and any spoofed `.name`
  }
  if (value === null) return "null";
  return typeof value; // "string" | "object" | "number" | "undefined" | …
}

/** 纯：返回 input 中缺失（undefined/null/空串）的必要字段。空 requires → []。 */
export function missingRequired(
  requires: { field: string; question: string }[],
  input: Record<string, unknown>,
): { field: string; question: string }[] {
  return requires.filter((r) => {
    const v = input[r.field];
    return v == null || (typeof v === "string" && v.trim() === "");
  });
}

export function defineOttoSkill<P extends z.ZodObject<any>>(spec: OttoSkillSpec<P>): OttoSkill {
  // Fail-closed: any missing classification → most-dangerous value.
  const cost: Cost = spec.cost ?? "spend";
  const effect: Effect = spec.effect ?? "write";
  const reach: Reach = spec.reach ?? "external";

  // Guard: parameters must be a z.object({...}) — we inspect its .shape below. A non-object
  // schema (e.g. a JS/`as any` caller passing z.string()) would otherwise hit Object.keys(undefined)
  // and throw an opaque TypeError instead of this fail-loud, agent-readable message.
  const shape = (spec.parameters as z.ZodObject<any> | undefined)?.shape;
  if (!shape || typeof shape !== "object") {
    throw new Error(
      `[defineOttoSkill] "${spec.name}" parameters must be a z.object({...}) schema. ` +
        `Skills declare their inputs as an object so identity fields can be checked.`,
    );
  }

  // #3 — identity must come from ctx, never the model.
  const leaked = Object.keys(shape).filter((k) => IDENTITY_KEYS.includes(k));
  if (leaked.length > 0) {
    throw new Error(
      `[defineOttoSkill] "${spec.name}" parameters must not include identity field(s): ${leaked.join(", ")}. ` +
        `Identity comes from ctx (orgId/userId), never the model. Remove them from the schema.`,
    );
  }

  // #4 — a spend skill must declare an idempotency key.
  if (cost === "spend" && !spec.idempotencyKey) {
    throw new Error(
      `[defineOttoSkill] "${spec.name}" is cost:"spend" but declares no idempotencyKey.\n` +
        "Add:  idempotencyKey: (i) => `...:${i.id}`",
    );
  }

  // requires: 每个声明的 field 必须存在于 parameters 的 shape（fail-loud，同 #3 身份键检查）。
  const requires = spec.requires ?? [];
  const unknownReq = requires.filter((r) => !Object.keys(shape).includes(r.field));
  if (unknownReq.length > 0) {
    throw new Error(
      `[defineOttoSkill] "${spec.name}" declares requires field(s) not in parameters: ` +
        `${unknownReq.map((r) => r.field).join(", ")}. Add them to the z.object({...}) schema.`,
    );
  }

  // ENGINE-A4 readOnlyActions: 判别键必须真在 parameters 里（同上，fail-loud）。改了动作名却忘了
  // 改这里的人，要在定义期就撞上，而不是在某一轮结算时静静多收一笔。
  const readOnlyActions = spec.readOnlyActions ?? null;
  if (readOnlyActions && !Object.keys(shape).includes(readOnlyActions.field)) {
    throw new Error(
      `[defineOttoSkill] "${spec.name}" declares readOnlyActions.field "${readOnlyActions.field}" ` +
        "which is not in parameters. Add it to the z.object({...}) schema.",
    );
  }

  const needsApproval = deriveNeedsApproval(cost, effect, reach);

  // requires 非空时，把"先确认什么"追加进 model-facing description（单一事实源：同一份 requires）。
  const modelDescription =
    requires.length > 0
      ? `${spec.description}\n\nBefore calling, make sure you have (ask the user for anything still missing; ` +
        `autofill from brand memory when you can): ${requires.map((r) => r.question).join(" ")}`
      : spec.description;

  // Use a concrete ZodObject<any> at the SDK boundary: the SDK's ToolOptions does
  // `Extract<TParameters, ToolInputParametersStrict>`, which TS cannot resolve for a
  // *free* generic P. The public OttoSkillSpec<P> stays strongly typed for authors;
  // only this internal call widens to the SDK's object-schema shape.
  const built = tool<z.ZodObject<any>, OttoContext>({
    name: spec.name,
    description: modelDescription,
    parameters: spec.parameters,
    needsApproval, // literal boolean — SDK normalizes to an async () => needsApproval
    execute: async (input, runContext) => {
      if (!runContext) throw new Error("OttoContext required");
      if (requires.length > 0) {
        const missing = missingRequired(requires, input as Record<string, unknown>);
        if (missing.length > 0) return { needMoreInfo: missing };
      }
      // #566: a skill failure is INVISIBLE server-side by default — the SDK folds a thrown error
      // into the tool's return value the model reads, and a returned { error } never leaves the
      // conversation either. That is why a broken spend gate ran silently in production for five
      // weeks. One line per failure, here in our own wrapper, so every skill is covered at once.
      //
      // The line carries ONLY the skill name and a fixed category (#566 R2 review): failure
      // messages routinely embed merchant-controlled text (submitted URLs, private hostnames),
      // so no message, no thrown value, and no field of either is ever interpolated here. What
      // this buys is the signal that was missing — WHICH skill is failing, and how often.
      try {
        const out = await spec.execute(input as z.infer<P>, runContext);
        if (out && typeof out === "object" && "error" in out) {
          console.warn(`[otto:skill] ${spec.name} refused (category=${skillErrorCategory((out as { error: unknown }).error)})`);
        }
        return out;
      } catch (e) {
        console.error(`[otto:skill] ${spec.name} threw (category=${skillErrorCategory(e)})`);
        throw e;
      }
    },
  });

  return { name: spec.name, cost, effect, reach, needsApproval, description: spec.description, requires, readOnlyActions, tool: built };
}
