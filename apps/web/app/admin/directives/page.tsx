import { redirect } from "next/navigation";
import { MODEL_FAMILIES, GEN_MODES } from "@artlio/core";
import { requireRole } from "@/lib/auth-guard";
import { listDirectives } from "@/lib/cowork-knowledge";
import { DirectivesAdmin, type AdminCell } from "@/components/admin/DirectivesAdmin";

export const dynamic = "force-dynamic";
export const metadata = { title: "Model directives · Artlio admin" };

/**
 * cowork knowledge-base admin (Phase 0B). R7: the page re-asserts auth() + the
 * allowlist INSIDE the handler — independent of the opt-in middleware wall — and
 * the save/seed actions do the same. Renders the full family×mode grid (unseeded
 * cells appear blank/"unset"); the founder edits a cell and the next Enhance
 * reflects it.
 */
export default async function AdminDirectivesPage() {
  // §⑥ Prompt & knowledge read = viewer/ops (or super-admin). requireRole re-asserts
  // the allowlist outer wall + the section→role matrix, and audits a denied read.
  const gate = await requireRole("knowledge", "read");
  if ("error" in gate) redirect("/login?from=/admin/directives");

  const rows = await listDirectives();
  const byKey = new Map(rows.map((r) => [`${r.family}:${r.mode}`, r]));

  // full matrix — every (family, mode) cell is editable; existing rows fill in,
  // the rest render blank ("unset" → the skill uses its family-neutral base)
  const cells: AdminCell[] = MODEL_FAMILIES.flatMap((family) =>
    GEN_MODES.map((mode) => {
      const r = byKey.get(`${family}:${mode}`);
      return {
        family, mode,
        directive: r?.directive ?? "",
        confidence: r?.confidence ?? "untested",
        enabled: r?.enabled ?? true,
        notes: r?.notes ?? "",
        source: r?.source ?? "founder",
        rules: r?.rules ?? null,
        exists: !!r,
      };
    }),
  );

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 4 }}>
        <h1 style={{ font: "var(--text-display)", color: "var(--fg-1)", margin: 0 }}>Model directives</h1>
        <p style={{ font: "var(--text-body)", color: "var(--fg-3)", margin: 0 }}>
          Per-(family × mode) prompt knowledge the cowork skills read. Edit a cell and the next ✨ Enhance reflects it (no redeploy). Seeded cells are research-grade and <strong>untested</strong> — sharpen them as you verify.
        </p>
      </header>
      <DirectivesAdmin families={[...MODEL_FAMILIES]} modes={[...GEN_MODES]} cells={cells} />
    </main>
  );
}
