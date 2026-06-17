import { redirect } from "next/navigation";
import { prisma } from "@artlio/db";
import { COWORK_PLANNER_SYSTEM } from "@artlio/core";
import { requireRole } from "@/lib/auth-guard";
import { KnowledgeAdmin } from "@/components/admin/KnowledgeAdmin";

// reads the DB at request time — never prerender
export const dynamic = "force-dynamic";
export const metadata = { title: "Knowledge · Artlio admin" };

async function readText(key: string): Promise<string | null> {
  try {
    const row = await prisma.runtimeConfig.findUnique({ where: { key }, select: { valueJson: true } });
    const t = (row?.valueJson as { text?: unknown } | null)?.text;
    return typeof t === "string" ? t : null;
  } catch { return null; }
}

export default async function KnowledgePage() {
  // §⑥ Prompt & knowledge read = viewer/ops (or super-admin). requireRole re-asserts
  // the allowlist outer wall + the section→role matrix, and audits a denied read.
  const gate = await requireRole("knowledge", "read");
  if ("error" in gate) redirect("/login?from=/admin/knowledge");
  const plannerSystem = (await readText("planner_system")) ?? COWORK_PLANNER_SYSTEM;
  const briefDefault = (await readText("brief_default")) ?? "";
  const descriptionTemplate = (await readText("description_template")) ?? "";
  return <KnowledgeAdmin plannerSystem={plannerSystem} briefDefault={briefDefault} descriptionTemplate={descriptionTemplate} codeDefaultPlanner={COWORK_PLANNER_SYSTEM} />;
}
