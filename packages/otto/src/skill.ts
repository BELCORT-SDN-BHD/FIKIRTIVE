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
import type { RunContext } from "@openai/agents";
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
}

export interface OttoSkill {
  name: string;
  cost: Cost;
  effect: Effect;
  reach: Reach;
  needsApproval: boolean;
  description: string;
  /** The @openai/agents tool, ready for the agent's `tools` array. */
  tool: ReturnType<typeof tool>;
}

const IDENTITY_KEYS = ["orgId", "ownerId", "userId"];

/** Pure: spend OR (external write) needs the boss's approval. */
export function deriveNeedsApproval(cost: Cost, effect: Effect, reach: Reach): boolean {
  return cost === "spend" || (effect === "write" && reach === "external");
}

export function defineOttoSkill<P extends z.ZodObject<any>>(spec: OttoSkillSpec<P>): OttoSkill {
  // Fail-closed: any missing classification → most-dangerous value.
  const cost: Cost = spec.cost ?? "spend";
  const effect: Effect = spec.effect ?? "write";
  const reach: Reach = spec.reach ?? "external";

  // #3 — identity must come from ctx, never the model.
  const leaked = Object.keys(spec.parameters.shape).filter((k) => IDENTITY_KEYS.includes(k));
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

  const needsApproval = deriveNeedsApproval(cost, effect, reach);

  const built = tool<P, OttoContext>({
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    needsApproval, // literal boolean — SDK normalizes to an async () => needsApproval
    execute: async (input, runContext) => {
      if (!runContext) throw new Error("OttoContext required");
      return spec.execute(input as z.infer<P>, runContext);
    },
  });

  return { name: spec.name, cost, effect, reach, needsApproval, description: spec.description, tool: built };
}
