# G5b — Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Templates gallery of 4 built-in i2i guided presets; each runs through a Upload→Question→Generate→Done modal that reuses the existing generation engine and spend gate.

**Architecture:** A static catalog + pure helpers (`templates.ts`), a `<TemplateModal>` that wraps the existing `Dialog` and chains the existing uploader → `startGen` → `getGenJob` poll → `DetailPanel`, a `<OttoTemplates>` gallery view, and three lines of nav wiring. No new money path, no new model, no new engine work.

**Tech Stack:** Next.js App Router, React `useState` + `al-*`/`ds.tsx` styling, the existing `startGen`/`getGenJob` spend+poll actions and `uploadFilesDirect`/`finalizeCandidateUploads` upload chain, vitest 3.2.

## Global Constraints

- **One spend path, unchanged** — a template run is exactly one `startGen({ kind:"image", sourceGenerationId, prompt, model: activeImageModel(), count:1, idempotencyKey })` call. Do NOT touch `reserveCredits`/charge/grant/settle, and do NOT add a new model. The deliberate **Generate** click is the approval; the button shows the cost (1 credit).
- **Owner + project scoped** — `startGen`, `finalizeCandidateUploads`, and `getGenJob` already gate `requireOwner` + project ownership; the worker validates `sourceGenerationId` owner-side. The catalog is static and carries no identity.
- **Static built-in catalog** — 4 templates in code; no DB model, no admin UI, no `TemplateBundle`.
- **All v1 templates edit an uploaded image** (`needsImage: true`); the festival question is free-text.
- **Reuse, don't rebuild** — `Dialog` (named export, `@/components/fk/Dialog`), `DetailPanel` (default export, `@/components/asset/DetailPanel`, props `{ generationId, projectId, onClose, entities? }`), `startGen`/`getGenJob` (`@/lib/gen-actions`), `uploadFilesDirect` (`@/lib/direct-upload`) + `finalizeCandidateUploads` (`@/lib/upload-actions`), `activeImageModel` + `GEN_PRICE_USD_PER_IMAGE` (`@fikirtive/core`), the `OttoViewKey`/`OttoNav`/`OttoView` pattern.
- **Canonical upload sequence** — mirror `OttoChatStream.tsx:355-360`: `const outcome = await uploadFilesDirect([file], () => {})` then `await finalizeCandidateUploads(projectId, "", [], outcome.files)`; `generationIds[0]` is the source.
- **Test runner** — `cd apps/web && pnpm exec vitest run <relative path>`.
- **Build gate** — `pnpm -r build` must show `├ ƒ /otto` and `Done`. Grep the log; don't trust the pipe exit code.
- **Out of scope:** user-authored/DB templates, t2i templates, select-type questions, batch runs, canvas auto-placement.

---

### Task 1: Template catalog + pure helpers

**Files:**
- Create: `apps/web/lib/templates.ts`
- Test: `apps/web/lib/__tests__/templates.test.ts`

**Interfaces:**
- Produces:
  - `type TemplateQuestion = { label: string; placeholder: string }`
  - `type Template = { id: string; name: string; description: string; needsImage: boolean; question?: TemplateQuestion; promptTemplate: string }`
  - `const TEMPLATES: Template[]` (4 entries)
  - `buildTemplatePrompt(t: Template, answer?: string): string`
  - `templateRunCredits(): number`

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TEMPLATES, buildTemplatePrompt, templateRunCredits } from "../templates";

describe("buildTemplatePrompt", () => {
  it("fills {q} with the trimmed answer", () => {
    const t = TEMPLATES.find((x) => x.id === "remove-object")!;
    expect(buildTemplatePrompt(t, "  the logo  ")).toBe(
      "remove the the logo from the image and fill the area naturally, photorealistic",
    );
  });
  it("returns the template verbatim when there is no question (ignores any answer)", () => {
    const t = TEMPLATES.find((x) => x.id === "remove-bg")!;
    expect(buildTemplatePrompt(t, "anything")).toBe(t.promptTemplate);
    expect(buildTemplatePrompt(t)).toBe(t.promptTemplate);
  });
});

describe("templateRunCredits", () => {
  it("is 1 credit for a single image", () => {
    expect(templateRunCredits()).toBe(1);
  });
});

describe("TEMPLATES catalog", () => {
  it("has 4 entries with unique ids and non-empty name/promptTemplate", () => {
    expect(TEMPLATES).toHaveLength(4);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(4);
    for (const t of TEMPLATES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.promptTemplate.length).toBeGreaterThan(0);
      expect(t.needsImage).toBe(true);
    }
  });
  it("has {q} in the prompt iff the template has a question", () => {
    for (const t of TEMPLATES) {
      expect(t.promptTemplate.includes("{q}")).toBe(Boolean(t.question));
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/templates.test.ts`
Expected: FAIL — cannot find module `../templates`.

- [ ] **Step 3: Implement the catalog + helpers**

Create `apps/web/lib/templates.ts`:

```ts
// Static built-in template catalog (G5b). Pure — no DB, no React, no server.
// Each template is an image-to-image preset run through the existing startGen spend gate.
import { GEN_PRICE_USD_PER_IMAGE } from "@fikirtive/core";

export type TemplateQuestion = { label: string; placeholder: string };
export type Template = {
  id: string;
  name: string;
  description: string;
  needsImage: boolean;
  question?: TemplateQuestion;
  promptTemplate: string; // contains "{q}" iff `question` is present
};

export const TEMPLATES: Template[] = [
  {
    id: "remove-bg",
    name: "Remove background",
    description: "Drop in a product photo, get it on a clean white studio backdrop.",
    needsImage: true,
    promptTemplate:
      "remove the background and place the product on a clean white studio backdrop, keep the product edges sharp, photorealistic",
  },
  {
    id: "remove-object",
    name: "Remove object",
    description: "Upload an image and tell me what to take out.",
    needsImage: true,
    question: { label: "What should I remove?", placeholder: "e.g. the person in the back" },
    promptTemplate: "remove the {q} from the image and fill the area naturally, photorealistic",
  },
  {
    id: "product-in-scene",
    name: "Product in a scene",
    description: "Place your product into any setting you describe.",
    needsImage: true,
    question: {
      label: "Describe the scene / background",
      placeholder: "e.g. on a marble kitchen counter, soft morning light",
    },
    promptTemplate:
      "place this product in {q}, professional product photography, realistic lighting and shadows",
  },
  {
    id: "festival-makeover",
    name: "Festival makeover",
    description: "Give your product a festive look — Raya, CNY, Deepavali and more.",
    needsImage: true,
    question: { label: "Which festival?", placeholder: "e.g. Hari Raya, CNY, Deepavali" },
    promptTemplate:
      "restyle this image with a festive {q} theme — tasteful decorations and lighting, keep the product clear and centered",
  },
];

/** Fill "{q}" with the trimmed answer; no-question templates return their prompt verbatim. */
export function buildTemplatePrompt(t: Template, answer?: string): string {
  if (!t.question) return t.promptTemplate;
  return t.promptTemplate.replace("{q}", (answer ?? "").trim());
}

const USD_PER_DISPLAY_CREDIT = 0.1; // mirrors @fikirtive/core spend.ts display denomination
/** Displayed-credit cost of one template run (1 image): max(1, ceil($0.04 / $0.10)) = 1. */
export function templateRunCredits(): number {
  return Math.max(1, Math.ceil(GEN_PRICE_USD_PER_IMAGE / USD_PER_DISPLAY_CREDIT));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/templates.test.ts`
Expected: PASS (all helper + catalog tests green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/templates.ts apps/web/lib/__tests__/templates.test.ts
git commit -m "feat(g5b): template catalog + buildTemplatePrompt + templateRunCredits (pure)"
```

---

### Task 2: `<TemplateModal>` guided flow

**Files:**
- Create: `apps/web/components/otto/TemplateModal.tsx`

**Interfaces:**
- Consumes: `Template`, `buildTemplatePrompt`, `templateRunCredits` (Task 1); `Dialog` (`@/components/fk/Dialog`, named); `DetailPanel` (`@/components/asset/DetailPanel`, default); `startGen`, `getGenJob` (`@/lib/gen-actions`); `uploadFilesDirect` (`@/lib/direct-upload`); `finalizeCandidateUploads` (`@/lib/upload-actions`); `activeImageModel` (`@fikirtive/core`); `EntityDTO` (`@/lib/types`).
- Produces: `TemplateModal({ template, projectId, entities, onClose })` — default export.

> No unit test (the testable logic — `buildTemplatePrompt`/`templateRunCredits` — is Task 1). Verified by `tsc` here and the build gate in Task 3.

- [ ] **Step 1: Confirm the upload + DetailPanel shapes**

Read `apps/web/components/otto/OttoChatStream.tsx` around lines 350-362 to confirm the `uploadFilesDirect([file], () => {})` → `finalizeCandidateUploads(projectId, "", [], outcome.files)` → `generationIds` sequence and `uploadFilesDirect`'s return shape (`outcome.files`). Read `apps/web/components/asset/DetailPanel.tsx:70-80` to confirm the default-export props. Adapt the code below to the real shapes if they differ; note any adaptation.

- [ ] **Step 2: Implement the modal**

Create `apps/web/components/otto/TemplateModal.tsx`:

```tsx
"use client";
import React, { useState } from "react";
import { Dialog } from "@/components/fk/Dialog";
import DetailPanel from "@/components/asset/DetailPanel";
import { startGen, getGenJob } from "@/lib/gen-actions";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
import { activeImageModel } from "@fikirtive/core";
import type { EntityDTO } from "@/lib/types";
import { type Template, buildTemplatePrompt, templateRunCredits } from "@/lib/templates";

type Phase = "form" | "generating" | "done";

export default function TemplateModal({
  template,
  projectId,
  entities = [],
  onClose,
}: {
  template: Template;
  projectId: string;
  entities?: EntityDTO[];
  onClose: () => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [sourceGenId, setSourceGenId] = useState<string | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultGenId, setResultGenId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const outcome = await uploadFilesDirect([file], () => {});
      const res = await finalizeCandidateUploads(projectId, "", [], outcome.files);
      if ("error" in res) {
        setError(res.error);
      } else if (res.generationIds.length === 0) {
        setError("Upload failed — please try another image.");
      } else {
        setSourceGenId(res.generationIds[0]);
        setThumbUrl(URL.createObjectURL(file));
      }
    } catch {
      setError("Upload failed — please try again.");
    } finally {
      setUploading(false);
    }
  }

  async function pollJob(jobId: string): Promise<{ url: string; genId: string } | null> {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      let job;
      try {
        job = await getGenJob(jobId);
      } catch {
        return null;
      }
      if (!job) return null;
      if (job.status === "DONE") {
        const url = job.urls[0];
        const genId = job.generationIds[0];
        return url && genId ? { url, genId } : null;
      }
      if (job.status === "FAILED") return null;
    }
    return null;
  }

  const canGenerate =
    !uploading && !!sourceGenId && (!template.question || answer.trim().length > 0) && phase === "form";

  async function onGenerate() {
    if (!sourceGenId) return;
    setError(null);
    setPhase("generating");
    const started = await startGen({
      projectId,
      kind: "image",
      sourceGenerationId: sourceGenId,
      prompt: buildTemplatePrompt(template, answer),
      model: activeImageModel(),
      count: 1,
      idempotencyKey: `tpl-${template.id}-${Date.now()}`,
    });
    if ("error" in started) {
      setError(started.error);
      setPhase("form");
      return;
    }
    const out = await pollJob(started.id);
    if (!out) {
      setError("Generation failed — please try again.");
      setPhase("form");
      return;
    }
    setResultUrl(out.url);
    setResultGenId(out.genId);
    setPhase("done");
  }

  const footer =
    phase === "done" ? (
      <>
        <button type="button" className="al-btn al-btn-sm" onClick={() => setDetailOpen(true)}>Open in detail</button>
        <button type="button" className="al-btn al-btn-sm" onClick={() => { setPhase("form"); setResultUrl(null); setResultGenId(null); }}>Make another</button>
        <button type="button" className="al-btn al-btn-primary al-btn-sm" onClick={onClose}>Close</button>
      </>
    ) : (
      <button type="button" className="al-btn al-btn-primary al-btn-sm" disabled={!canGenerate} onClick={onGenerate}>
        {phase === "generating" ? "Generating…" : `Generate · ${templateRunCredits()} credit`}
      </button>
    );

  return (
    <>
      <Dialog open onClose={onClose} title={template.name} description={template.description} footer={footer}>
        {phase === "done" && resultUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={resultUrl} alt="result" style={{ width: "100%", borderRadius: "var(--radius-md)", display: "block" }} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
            <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Product image</span>
              {thumbUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumbUrl} alt="upload" style={{ width: 120, height: 120, objectFit: "cover", borderRadius: "var(--radius-md)" }} />
              ) : (
                <input type="file" accept="image/*" onChange={onPickFile} disabled={uploading} />
              )}
              {uploading && <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Uploading…</span>}
            </label>
            {template.question && (
              <label style={{ display: "flex", flexDirection: "column", gap: "var(--space-1)" }}>
                <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{template.question.label}</span>
                <input className="al-input" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={template.question.placeholder} />
              </label>
            )}
            {error && <div style={{ color: "var(--danger, #d65a5a)", fontSize: 13 }}>{error}</div>}
          </div>
        )}
      </Dialog>
      {detailOpen && resultGenId && (
        <DetailPanel generationId={resultGenId} projectId={projectId} entities={entities} onClose={() => setDetailOpen(false)} />
      )}
    </>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: 0 errors. (If `uploadFilesDirect`'s return isn't `{ files }`, or `Dialog`/`DetailPanel` props differ, adapt to the real shapes confirmed in Step 1. `al-input`/`al-btn`/`al-btn-primary`/`al-btn-sm` are real classes in `apps/web/app/globals.css`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/otto/TemplateModal.tsx
git commit -m "feat(g5b): TemplateModal — upload → question → startGen → poll → DetailPanel (reuses spend gate)"
```

---

### Task 3: `<OttoTemplates>` gallery + nav wiring + final build gate

**Files:**
- Create: `apps/web/components/otto/OttoTemplates.tsx`
- Modify: `apps/web/components/otto/OttoApp.tsx` (`OttoViewKey`)
- Modify: `apps/web/components/otto/OttoNav.tsx` (icon + NavItem)
- Modify: `apps/web/components/otto/OttoView.tsx` (view branch)

**Interfaces:**
- Consumes: `TEMPLATES`, `Template` (Task 1); `TemplateModal` (Task 2, default export). `OttoView` already receives `projectId` + `entities`.
- Produces: `OttoTemplates({ projectId, entities })` — default export.

> Gallery + integration wiring. Verified by `tsc` + the full build gate.

- [ ] **Step 1: Implement the gallery view**

Create `apps/web/components/otto/OttoTemplates.tsx`:

```tsx
"use client";
import React, { useState } from "react";
import type { EntityDTO } from "@/lib/types";
import { TEMPLATES, type Template } from "@/lib/templates";
import TemplateModal from "./TemplateModal";

export default function OttoTemplates({ projectId, entities = [] }: { projectId: string; entities?: EntityDTO[] }) {
  const [active, setActive] = useState<Template | null>(null);
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto", padding: "var(--space-5)" }}>
      <div style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-body)" }}>Templates</h2>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: 14 }}>
          Pick a template, upload your product, get a polished image.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "var(--space-3)" }}>
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setActive(t)}
            style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", color: "var(--text-body)" }}
          >
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t.name}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: "var(--space-1)" }}>{t.description}</div>
          </button>
        ))}
      </div>
      {active && (
        <TemplateModal template={active} projectId={projectId} entities={entities} onClose={() => setActive(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the view key**

In `apps/web/components/otto/OttoApp.tsx`, change the `OttoViewKey` union to add `"templates"` after `"library"`:

```ts
export type OttoViewKey = "otto" | "stuff" | "library" | "templates" | "memory" | "account";
```

- [ ] **Step 3: Add the nav item**

In `apps/web/components/otto/OttoNav.tsx`, add an icon near the other icon functions:

```tsx
function IconTemplates() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M3 9h18M9 21V9" />
    </svg>
  );
}
```

And add to `NAV_ITEMS` after the `library` entry:

```tsx
  { key: "templates", label: "Templates", icon: <IconTemplates /> },
```

- [ ] **Step 4: Add the view branch**

In `apps/web/components/otto/OttoView.tsx`, import the view near the other otto imports:

```tsx
import OttoTemplates from "./OttoTemplates";
```

And add a branch alongside the existing `library`/`stuff`/`memory`/`account` blocks (before the `view === "otto"` two-pane return):

```tsx
  if (view === "templates") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoTemplates projectId={projectId} entities={entities} />
      </div>
    );
  }
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: 0 errors; `OttoViewKey` union, NavItem, and OttoView branch line up.

- [ ] **Step 6: Run the whole web test suite**

Run: `cd apps/web && pnpm exec vitest run`
Expected: `templates.test.ts` passes; the only failures are the pre-existing `DATABASE_URL`-not-set integration tests (`require-owner`, `tenant-guard`, `files route`, `isolation`).

- [ ] **Step 7: Full monorepo build gate**

Run: `pnpm -r build 2>&1 | tee /tmp/g5b-build.log; grep -E "ƒ /otto|Done|error TS|Failed to compile" /tmp/g5b-build.log`
Expected: the log shows `├ ƒ /otto` and `Done`, and NO `error TS` / `Failed to compile`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/otto/OttoTemplates.tsx apps/web/components/otto/OttoApp.tsx apps/web/components/otto/OttoNav.tsx apps/web/components/otto/OttoView.tsx
git commit -m "feat(g5b): Templates gallery + nav wiring; build-verified"
```

---

## Self-Review

**Spec coverage:**
- §2.1 catalog + helpers → Task 1. ✓
- §2.2 `<TemplateModal>` (upload · question · generate · poll · done · DetailPanel) → Task 2. ✓
- §2.3 `<OttoTemplates>` gallery → Task 3 Step 1. ✓
- §2.4 nav wiring → Task 3 Steps 2-4. ✓
- §5 money/safety → only `startGen` spends (Task 2 `onGenerate`); cost shown via `templateRunCredits()`; insufficient-balance surfaced; no spend file touched. ✓
- §6 testing → Task 1 unit tests (helpers + catalog); Task 3 runs suite + build gate. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. The Task 2 Step 1 "confirm the real shapes" note is a drift guard (the uploader/DetailPanel signatures), not missing content — the code is fully written.

**Type consistency:** `Template`/`TemplateQuestion`/`buildTemplatePrompt`/`templateRunCredits` defined in Task 1 are consumed verbatim in Tasks 2-3. `TemplateModal({ template, projectId, entities, onClose })` (Task 2 default export) matches the call in `OttoTemplates` (Task 3). `startGen` request shape (`kind:"image"`, `sourceGenerationId`, `prompt`, `model`, `count`, `idempotencyKey`) matches the `GenRequest` zod (the canvas uses the same fields). `getGenJob` returns `{ status, urls, generationIds }` consumed in `pollJob`. `OttoViewKey` gains `"templates"` (Task 3 Step 2), consumed by the NavItem (Step 3) and the OttoView branch (Step 4). `DetailPanel` props `{ generationId, projectId, onClose, entities }` match the real default export.

**Note:** `GEN_PRICE_USD_PER_IMAGE` is re-exported by `@fikirtive/core` (`packages/core/src/index.ts:74` `export * from "./gen.js"`), so the Task 1 import resolves. `templateRunCredits()` is deterministically 1 today; the unit test pins it.
