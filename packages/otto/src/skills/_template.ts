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
  // cost:   does it spend FIKIRTIVE credits?      "free" | "spend"   (spend ⇒ also add idempotencyKey)
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
