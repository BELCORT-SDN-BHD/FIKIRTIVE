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
      try {
        const out = await spec.execute(input as z.infer<P>, runContext);
        if (out && typeof out === "object" && "error" in out) {
          console.warn(`[otto:skill] ${spec.name} refused: ${String((out as { error: unknown }).error)}`);
        }
        return out;
      } catch (e) {
        console.error(`[otto:skill] ${spec.name} threw:`, e instanceof Error ? e.message : e);
        throw e;
      }
    },
  });

  return { name: spec.name, cost, effect, reach, needsApproval, description: spec.description, requires, tool: built };
}
