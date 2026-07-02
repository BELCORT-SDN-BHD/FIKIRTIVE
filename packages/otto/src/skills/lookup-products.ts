/** lookupProducts — $0 read skill: on-demand catalog retrieval so a growing product list never bloats the prompt. */
import type { RunContext } from "@openai/agents";
import { defineOttoSkill } from "../skill.js";
import { z } from "zod";
import { prisma } from "@fikirtive/db";
import type { OttoContext } from "../context.js";

const params = z.object({ query: z.string().min(1).max(80) });

export async function executeLookupProducts(
  input: z.infer<typeof params>,
  runContext: Pick<RunContext<OttoContext>, "context">,
): Promise<{ matches: Record<string, unknown>[] }> {
  const ctx = runContext.context as OttoContext;
  const q = input.query.trim().toLowerCase();
  const rows = await prisma.brandRecord.findMany({
    where: { ownerId: ctx.orgId, brandId: null, kind: "product", deletedAt: null, status: "active" },
    orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }],
    select: { data: true },
    take: 200, // catalog design bound (founder decision 6); substring match in app code
  });
  const hit = (d: Record<string, unknown>): boolean => {
    const hay = [d.name, d.description, d.sellingAngle, d.category, ...(Array.isArray(d.tags) ? d.tags : [])]
      .filter((v): v is string => typeof v === "string").join(" ").toLowerCase();
    return hay.includes(q);
  };
  const matches = rows.map((r) => r.data as Record<string, unknown>).filter(hit).slice(0, 5);
  return { matches };
}

export const lookupProductsSkill = defineOttoSkill({
  name: "lookupProducts",
  cost: "free",
  effect: "read",
  reach: "internal",
  description:
    "Look up the user's saved products by name, category, tag or description (returns up to 5 full records). $0. " +
    "Your context only shows a summary of the catalog — call this BEFORE naming, pricing or featuring a specific product that isn't already in your context.",
  parameters: params,
  execute: executeLookupProducts,
});

export const lookupProducts = lookupProductsSkill.tool;
