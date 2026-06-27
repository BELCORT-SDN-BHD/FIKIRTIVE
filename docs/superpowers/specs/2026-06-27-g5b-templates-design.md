# Design spec — G5b · Templates (G5 items 29 + 30)

Date: 2026-06-27
Status: approved by founder (design); autonomous build, batch-review at the end.
Branch: `claude/otto-g5b-templates` (off `claude/otto-g5a-library`). Grounded in the G1→G5a stack.

## 1. What this is

A new **Templates** view: a gallery of 4 built-in guided presets. Pick one → a modal walks the user
through **upload product image → (optional) answer one question → Generate → Done**. Each template is
an **image-to-image (i2i) prompt preset** that runs through the EXISTING generation engine and spend
gate. No new money path, no new model, no new engine work.

Founder decisions (brainstorming):
- **4 templates v1** (founder-picked): Remove background · Remove object · Product in scene ·
  Festival makeover (Raya / CNY / Deepavali).
- **Static built-in catalog in code** (recommended + accepted) — NOT a DB/admin-authored system. The
  dormant `TemplateBundle` model is for ComfyUI workflows (wrong shape/heavy). User-authored templates
  are a later option.
- **The "Generate" click is the spend approval** (the button shows the cost). Reuses `startGen`.

## 2. Scope (G5b)

1. **Template catalog + pure helpers** — `apps/web/lib/templates.ts`.
2. **`<TemplateModal>`** — the guided Upload→Question→Generate→Done flow (wraps the existing `Dialog`).
3. **`<OttoTemplates>`** — the gallery view (4 cards).
4. **Nav wiring** — `OttoViewKey` += `"templates"`, an `OttoNav` item, an `OttoView` branch.

### Out of scope (later / dropped)
- ❌ User-authored / DB-backed templates; the ComfyUI `TemplateBundle`.
- ❌ Text-only (t2i) templates — all v1 templates edit an uploaded image (`needsImage: true`).
- ❌ Select-type questions — the festival question is a free-text input in v1 (placeholder suggests
  Raya/CNY/Deepavali).
- ❌ Batch/multi-image runs, template editing, results auto-placed on the canvas.
- ❌ Any new money path, model, or engine change.

## 3. Current-stack seams (verified — what we reuse)

- **Spend gate (the ONLY money path)** — `apps/web/lib/gen-actions.ts` `startGen(req)`: reserves
  credits atomically with the `GenJob` insert; `getGenJob(jobId)` polls `status`
  (`QUEUED|GENERATING|DONE|FAILED`) + `urls`. A non-agent UI calls `startGen` directly (the canvas
  does) — the deliberate click IS the approval. `kind:"image"` + `sourceGenerationId` → i2i edit
  (`deriveMode` → `"i2i"`), so all 4 templates are possible today.
- **Upload → source generation** — the canvas/chat uploader: `uploadFilesDirect([file], () => {})`
  (`@/lib/direct-upload`, handles authorize→presigned-PUT→parts) then
  `finalizeCandidateUploads(projectId, "", [], outcome.files)` (`@/lib/upload-actions`) →
  `{ generationIds }`. `generationIds[0]` is the uploaded image's generation id → pass as
  `sourceGenerationId`. (Exactly the `OttoChatStream` upload sequence.)
- **Modal** — `apps/web/components/fk/Dialog.tsx` `Dialog({ open, onClose, title, description,
  children, footer })` (named export).
- **Result detail** — `DetailPanel({ generationId, projectId, onClose, entities? })` (G2a).
- **Model + price** — `activeImageModel()` and `GEN_PRICE_USD_PER_IMAGE` (= 0.04) from
  `@fikirtive/core`. Displayed credits for one image = `max(1, ceil(0.04 / 0.10))` = **1 credit**.
- **Nav pattern** — `OttoViewKey` (`OttoApp.tsx`), `OttoNav` `NAV_ITEMS`, `OttoView` if-chain (same as
  the G5a Library).

## 4. Architecture

### 4.1 Catalog + helpers — `apps/web/lib/templates.ts` (pure, no server)
```ts
export type TemplateQuestion = { label: string; placeholder: string };
export type Template = {
  id: string;            // stable, e.g. "remove-bg"
  name: string;
  description: string;
  needsImage: boolean;   // all v1 = true
  question?: TemplateQuestion; // present → modal shows one text input
  promptTemplate: string;      // contains "{q}" iff question present
};

export const TEMPLATES: Template[] = [ /* the 4 below */ ];

// fills "{q}" with the trimmed answer; no-question templates return promptTemplate verbatim.
export function buildTemplatePrompt(t: Template, answer?: string): string;

// per-run displayed-credit cost (1 image): max(1, ceil(GEN_PRICE_USD_PER_IMAGE / 0.10)) = 1.
export function templateRunCredits(): number;
```
The 4 catalog entries (starter prompts — founder may tune copy later):
- `remove-bg` — no question — `"remove the background and place the product on a clean white studio backdrop, keep the product edges sharp, photorealistic"`.
- `remove-object` — question `{ label: "What should I remove?", placeholder: "e.g. the person in the back" }` — `"remove the {q} from the image and fill the area naturally, photorealistic"`.
- `product-in-scene` — question `{ label: "Describe the scene/background", placeholder: "e.g. on a marble kitchen counter, soft morning light" }` — `"place this product in {q}, professional product photography, realistic lighting and shadows"`.
- `festival-makeover` — question `{ label: "Which festival?", placeholder: "e.g. Hari Raya, CNY, Deepavali" }` — `"restyle this image with a festive {q} theme — tasteful decorations and lighting, keep the product clear and centered"`.

### 4.2 `<TemplateModal>` — `apps/web/components/otto/TemplateModal.tsx` (client)
Props `{ template, projectId, entities, onClose }`. Wraps `<Dialog open onClose title={template.name}>`.
State machine: `idle → uploading → ready → generating → done | error`.
- **Upload step:** a file input; on pick → `uploadFilesDirect([file], () => {})` →
  `finalizeCandidateUploads(projectId, "", [], outcome.files)`; on success store
  `sourceGenerationId = generationIds[0]` + a local object-URL thumbnail; surface upload errors inline.
- **Question step:** if `template.question`, a text input (label + placeholder); `answer` state.
- **Generate (footer button):** label shows the cost (`Generate · ${templateRunCredits()} credit`).
  Disabled until `sourceGenerationId` set AND (no question OR `answer.trim()` non-empty). On click →
  `startGen({ projectId, kind: "image", sourceGenerationId, prompt: buildTemplatePrompt(template,
  answer), model: activeImageModel(), count: 1, idempotencyKey: \`tpl-${template.id}-${Date.now()}\` })`.
  If `{error}` (e.g. insufficient balance) → show it, stay on `ready`. Else poll `getGenJob(jobId)`
  until `DONE` (→ `done`, capture `urls[0]` + `generationIds[0]`) or `FAILED` (→ `error`).
- **Done step:** show the result image + buttons: **Open in detail** (renders `<DetailPanel
  generationId={resultGenId} projectId entities onClose=…>`), **Make another** (reset to `ready`,
  keep the uploaded source), **Close**. The result is already a saved `Generation` (so it appears in
  the Library automatically).

### 4.3 `<OttoTemplates>` — `apps/web/components/otto/OttoTemplates.tsx` (client)
Props `{ projectId, entities }`. A responsive grid of `TEMPLATES.map` cards (name + description + a
small icon). Clicking a card sets `active = template`; renders `<TemplateModal template={active} … onClose={() => setActive(null)} />`. Header copy explains "Pick a template, upload your product, get a polished image."

### 4.4 Nav wiring
- `OttoApp.tsx`: `OttoViewKey` gains `"templates"` (after `"library"`).
- `OttoNav.tsx`: an `IconTemplates` (small SVG) + `{ key: "templates", label: "Templates", icon: <IconTemplates /> }` in `NAV_ITEMS` after the `library` entry.
- `OttoView.tsx`: `if (view === "templates") return <…><OttoTemplates projectId={projectId} entities={entities} /></…>;`

## 5. Money / safety
- **One spend path, unchanged.** A template run is one `startGen` call — same reserve→settle, same
  idempotency, same priced credits as the canvas. No `reserveCredits`/charge/grant code is touched; no
  new model is added (uses `activeImageModel()`).
- **Informed spend.** The Generate button shows the cost (1 credit); the click is the approval
  (consistent with the canvas). Insufficient balance returns `startGen`'s `{error}`, shown inline — no
  partial/hidden charge.
- **Owner + project scoped.** `startGen`, `finalizeCandidateUploads`, and `getGenJob` all gate
  `requireOwner` + project ownership; `sourceGenerationId` is validated owner-side by the worker. The
  catalog is static and carries no identity.

## 6. Testing
- **Unit (`templates.test.ts`):** `buildTemplatePrompt` fills `{q}` with the trimmed answer; a
  no-question template returns its `promptTemplate` verbatim (ignores any answer); `templateRunCredits()
  === 1`. Catalog well-formed: 4 entries with unique ids; every entry has a non-empty `name` +
  `promptTemplate`; every entry with a `question` has `{q}` in its `promptTemplate` (and vice-versa).
- **Build:** full `pnpm -r build` shows `├ ƒ /otto` + `Done`; `tsc` 0 errors.
- **Manual (deployed — local is mock, so a real edit needs a deployed/real-fal env):** open Templates →
  pick "Remove object" → upload → answer → Generate (1 credit) → result → Open in detail; insufficient
  balance shows inline.

## 7. Open questions
None blocking. Festival uses a free-text question in v1 (a select is a later nicety). Prompt copy is
tunable without code-structure change.
