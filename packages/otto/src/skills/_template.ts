/**
 * _template.ts — copy this file to skills/<your-skill>.ts and fill the blanks.
 * Do NOT add this template to registry.ts. Steps: see skills/AGENTS.md.
 */
import { z } from "zod";
import { defineOttoSkill } from "../skill.js";

const templateInput = z.object({
  // Your params. NEVER include orgId/ownerId/userId — identity comes from ctx.
  example: z.string().min(1),
});

export const templateSkill = defineOttoSkill({
  name: "TODO_rename",
  // cost:   does THIS skill approve + reserve on its own?  "free" | "spend"  (spend ⇒ also add
  //         idempotencyKey). "free" ≠ "the merchant is not billed" — the turn's own money leg may
  //         still charge for it (researchWeb, importMedia). Full definition: AGENTS.md.
  // effect: does it change state (our DB OR outside)? "read" | "write"
  // reach:  does it touch the outside world?       "internal" | "external"
  cost: "free",
  effect: "read",
  reach: "internal",
  description: "TODO: one or two sentences telling Otto when to use this.",
  parameters: templateInput,
  execute: async (input, { context }) => {
    // Reach the outside world ONLY through an injected ctx port (e.g. context.somePort),
    // never by importing the generation provider / reserveCredits / Prisma directly (see AGENTS.md).
    void context;
    return { ok: true, echoed: input.example };
  },
});
