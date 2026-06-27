# G5c — Discover (Inspiration Gallery) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static Inspiration Gallery "Discover" view — pick an ad idea, see its prompt, and either Copy it or pre-fill the Otto front-door composer to make your own version.

**Architecture:** A static catalog + a pure category helper (`inspirations.ts`), an `<OttoDiscover>` gallery that opens a `Dialog` per idea, a `seedText` prop on `OttoFrontDoor` that pre-fills its composer, and nav + seed wiring in `OttoApp`/`OttoView`/`OttoNav`. No user data, no generation, no spend in Discover.

**Tech Stack:** Next.js App Router, React `useState`/`useEffect` + `al-*`/`ds.tsx` styling, the existing `Dialog`, vitest 3.2.

## Global Constraints

- **Zero spend, zero generation in Discover** — no `startGen`/charge/grant/reserve anywhere in this branch. "Use in Otto" only sets a text string and switches the view; the eventual send happens in Otto through the existing gate, unchanged.
- **No user data / no tenant surface** — the catalog is static module data; Discover reads nothing owner-scoped and exposes nothing cross-tenant.
- **Static built-in catalog** — ideas live in code; no DB, no user-authored content, no community feed.
- **Text-only idea cards** in v1 (title + description + prompt); no example images.
- **"Use in Otto" pre-fills the front-door composer** (no auto-send — the user reviews/edits, then sends).
- **Reuse, don't rebuild** — `Dialog` (`@/components/fk/Dialog`, named export), the `OttoViewKey`/`OttoNav`/`OttoView` pattern, and the existing `OttoFrontDoor` send chain.
- **Test runner** — `cd apps/web && pnpm exec vitest run <relative path>`.
- **Build gate** — `pnpm -r build` must show `├ ƒ /otto` and `Done`. Grep the log; don't trust the pipe exit code.
- **Out of scope:** community/cross-user feed, publishing/moderation, example images, DB-backed or user-authored inspirations, any money-path/model change.

---

### Task 1: Inspiration catalog + category helper

**Files:**
- Create: `apps/web/lib/inspirations.ts`
- Test: `apps/web/lib/__tests__/inspirations.test.ts`

**Interfaces:**
- Produces:
  - `type Inspiration = { id: string; category: string; title: string; description: string; prompt: string }`
  - `const INSPIRATIONS: Inspiration[]` (9 entries across 5 categories)
  - `inspirationCategories(list: Inspiration[]): string[]` (unique, first-seen order)

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/__tests__/inspirations.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { INSPIRATIONS, inspirationCategories, type Inspiration } from "../inspirations";

describe("INSPIRATIONS catalog", () => {
  it("is non-empty with unique ids and non-empty fields", () => {
    expect(INSPIRATIONS.length).toBeGreaterThan(0);
    expect(new Set(INSPIRATIONS.map((i) => i.id)).size).toBe(INSPIRATIONS.length);
    for (const i of INSPIRATIONS) {
      expect(i.category.length).toBeGreaterThan(0);
      expect(i.title.length).toBeGreaterThan(0);
      expect(i.description.length).toBeGreaterThan(0);
      expect(i.prompt.length).toBeGreaterThan(0);
    }
  });
});

describe("inspirationCategories", () => {
  it("returns unique categories in first-seen order", () => {
    const list: Inspiration[] = [
      { id: "a", category: "X", title: "t", description: "d", prompt: "p" },
      { id: "b", category: "Y", title: "t", description: "d", prompt: "p" },
      { id: "c", category: "X", title: "t", description: "d", prompt: "p" },
    ];
    expect(inspirationCategories(list)).toEqual(["X", "Y"]);
  });
  it("covers the real catalog with unique categories", () => {
    const cats = inspirationCategories(INSPIRATIONS);
    expect(cats.length).toBeGreaterThan(0);
    expect(new Set(cats).size).toBe(cats.length);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/inspirations.test.ts`
Expected: FAIL — cannot find module `../inspirations`.

- [ ] **Step 3: Implement the catalog + helper**

Create `apps/web/lib/inspirations.ts`:

```ts
// Static Inspiration Gallery catalog (G5c). Pure — no DB, no React, no user data.
// Each prompt is a ready idea the user runs in Otto; "[your product]" is a fill-in hint.
export type Inspiration = {
  id: string;
  category: string;
  title: string;
  description: string;
  prompt: string;
};

export const INSPIRATIONS: Inspiration[] = [
  { id: "hero-white", category: "Product shots", title: "Clean hero shot", description: "Your product on a crisp white studio background.", prompt: "a professional product hero shot of [your product] on a clean white studio background, soft shadows, sharp focus, high detail" },
  { id: "hero-gradient", category: "Product shots", title: "Bold gradient backdrop", description: "Eye-catching colored gradient behind the product.", prompt: "product photo of [your product] centered on a smooth vibrant gradient backdrop, studio lighting, premium look" },
  { id: "raya", category: "Festival / Seasonal", title: "Hari Raya scene", description: "Festive Raya styling around your product.", prompt: "[your product] styled for Hari Raya — ketupat, warm lights, green and gold accents, festive and tasteful, product clearly visible" },
  { id: "cny", category: "Festival / Seasonal", title: "Chinese New Year scene", description: "Red-and-gold CNY mood.", prompt: "[your product] styled for Chinese New Year — red and gold decor, lanterns, prosperity mood, festive yet clean, product front and center" },
  { id: "deepavali", category: "Festival / Seasonal", title: "Deepavali scene", description: "Diya lights and rangoli warmth.", prompt: "[your product] styled for Deepavali — glowing diya lamps, colorful rangoli, warm festive lighting, product clearly visible" },
  { id: "ugc-hand", category: "Social / UGC", title: "In-hand UGC", description: "Authentic hand-held lifestyle look.", prompt: "casual UGC-style photo of a hand holding [your product], natural daylight, real and relatable, slightly imperfect for authenticity" },
  { id: "flatlay", category: "Social / UGC", title: "Flatlay", description: "Top-down styled flatlay with props.", prompt: "top-down flatlay of [your product] with complementary props on a textured surface, soft natural light, instagram-ready" },
  { id: "sale-banner", category: "Promotions / Sale", title: "Sale promo", description: "Bold discount-ready promo image.", prompt: "eye-catching promotional image for [your product] with empty space for a big sale headline, bold colors, high contrast, ad-ready" },
  { id: "lifestyle-scene", category: "Lifestyle", title: "Lifestyle in use", description: "Product in a real everyday setting.", prompt: "lifestyle photo of [your product] being used in a cozy real-world setting, warm natural light, aspirational but believable" },
];

/** Unique categories in first-seen order (for a filter row). */
export function inspirationCategories(list: Inspiration[]): string[] {
  const seen: string[] = [];
  for (const i of list) if (!seen.includes(i.category)) seen.push(i.category);
  return seen;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run lib/__tests__/inspirations.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/inspirations.ts apps/web/lib/__tests__/inspirations.test.ts
git commit -m "feat(g5c): inspiration catalog + inspirationCategories (pure, static)"
```

---

### Task 2: `<OttoDiscover>` gallery

**Files:**
- Create: `apps/web/components/otto/OttoDiscover.tsx`

**Interfaces:**
- Consumes: `INSPIRATIONS`, `inspirationCategories`, `Inspiration` (Task 1); `Dialog` (`@/components/fk/Dialog`, named export).
- Produces: `OttoDiscover({ onUseInOtto })` — default export; `onUseInOtto: (prompt: string) => void`.

> No unit test (testable logic is Task 1's helper). Verified by `tsc` here and the build gate in Task 3.

- [ ] **Step 1: Implement the gallery**

Create `apps/web/components/otto/OttoDiscover.tsx`:

```tsx
"use client";
import React, { useState } from "react";
import { Dialog } from "@/components/fk/Dialog";
import { INSPIRATIONS, inspirationCategories, type Inspiration } from "@/lib/inspirations";

export default function OttoDiscover({ onUseInOtto }: { onUseInOtto: (prompt: string) => void }) {
  const [cat, setCat] = useState<string>("All");
  const [active, setActive] = useState<Inspiration | null>(null);
  const [copied, setCopied] = useState(false);

  const cats = ["All", ...inspirationCategories(INSPIRATIONS)];
  const shown = cat === "All" ? INSPIRATIONS : INSPIRATIONS.filter((i) => i.category === cat);

  async function copy(prompt: string) {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be unavailable; ignore (Copy is best-effort)
    }
  }

  return (
    <div style={{ flex: 1, overflow: "auto", padding: "var(--space-5)" }}>
      <div style={{ marginBottom: "var(--space-4)" }}>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text-body)" }}>Discover</h2>
        <p style={{ margin: "var(--space-1) 0 0", color: "var(--text-muted)", fontSize: 14 }}>
          Ideas to start from — pick one, tweak it, make it yours.
        </p>
      </div>

      <div style={{ display: "flex", gap: "var(--space-2)", marginBottom: "var(--space-4)", flexWrap: "wrap" }}>
        {cats.map((c) => (
          <button key={c} type="button" onClick={() => setCat(c)} className="al-btn al-btn-sm" style={{ background: cat === c ? "var(--surface-raised)" : "transparent" }}>
            {c}
          </button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "var(--space-3)" }}>
        {shown.map((i) => (
          <button
            key={i.id}
            type="button"
            onClick={() => setActive(i)}
            style={{ textAlign: "left", cursor: "pointer", border: "1px solid var(--border-subtle)", background: "var(--surface-card)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", color: "var(--text-body)" }}
          >
            <div style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.4 }}>{i.category}</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>{i.title}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: "var(--space-1)" }}>{i.description}</div>
          </button>
        ))}
      </div>

      {active && (
        <Dialog
          open
          onClose={() => setActive(null)}
          title={active.title}
          description={active.category}
          footer={
            <>
              <button type="button" className="al-btn al-btn-sm" onClick={() => copy(active.prompt)}>{copied ? "Copied" : "Copy prompt"}</button>
              <button type="button" className="al-btn al-btn-primary al-btn-sm" onClick={() => { onUseInOtto(active.prompt); setActive(null); }}>Use in Otto</button>
            </>
          }
        >
          <p style={{ color: "var(--text-body)", fontSize: 14, marginTop: 0 }}>{active.description}</p>
          <div style={{ background: "var(--surface-raised)", borderRadius: "var(--radius-md)", padding: "var(--space-3)", fontSize: 13, color: "var(--text-body)", whiteSpace: "pre-wrap" }}>{active.prompt}</div>
          <p style={{ color: "var(--text-muted)", fontSize: 12, marginTop: "var(--space-2)" }}>Tip: replace [your product] with your product name.</p>
        </Dialog>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: 0 errors. (`al-btn`/`al-btn-sm`/`al-btn-primary` are real classes in `apps/web/app/globals.css`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/otto/OttoDiscover.tsx
git commit -m "feat(g5c): OttoDiscover gallery — idea cards + Dialog with Use-in-Otto / Copy"
```

---

### Task 3: Front-door seed + nav/seed wiring + final build gate

**Files:**
- Modify: `apps/web/components/otto/OttoFrontDoor.tsx` (add `seedText` prop)
- Modify: `apps/web/components/otto/OttoApp.tsx` (`OttoViewKey`, seed state + handler, pass-down)
- Modify: `apps/web/components/otto/OttoNav.tsx` (icon + NavItem)
- Modify: `apps/web/components/otto/OttoView.tsx` (props + discover branch + seed to front door)

**Interfaces:**
- Consumes: `<OttoDiscover>` (Task 2, default export, prop `onUseInOtto`).

> Integration wiring. Verified by `tsc` + the full build gate.

- [ ] **Step 1: Add `seedText` to `OttoFrontDoor`**

In `apps/web/components/otto/OttoFrontDoor.tsx`:
- Change the React import to include `useEffect`: `import React, { useEffect, useRef, useState } from "react";`
- In `OttoFrontDoorProps`, add: `/** When set (e.g. from Discover), pre-fills the composer. */ seedText?: string;`
- Destructure `seedText` in the function signature params.
- Immediately after `const [text, setText] = useState("");`, add:

```tsx
  // Discover "Use in Otto": pre-fill the composer when a seed arrives (no auto-send).
  useEffect(() => {
    if (seedText) setText(seedText);
  }, [seedText]);
```

- [ ] **Step 2: Wire the view key, seed state, and handler in `OttoApp`**

In `apps/web/components/otto/OttoApp.tsx`:
- Change the `OttoViewKey` union to add `"discover"` after `"templates"`:

```ts
export type OttoViewKey = "otto" | "stuff" | "library" | "templates" | "discover" | "memory" | "account";
```

- Add seed state near the other `useState`s:

```tsx
  const [seedText, setSeedText] = useState<string>("");
```

- Add the handler (near `handleDeleteThread`):

```tsx
  function handleUseInOtto(prompt: string) {
    setSeedText(prompt);
    setActiveThreadId(null);
    setView("otto");
  }
```

- Pass both to `<OttoView ... />`:

```tsx
          seedText={seedText}
          onUseInOtto={handleUseInOtto}
```

- [ ] **Step 3: Add the nav item in `OttoNav`**

In `apps/web/components/otto/OttoNav.tsx`, add an icon near the other icon functions:

```tsx
function IconCompass() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}
```

And add to `NAV_ITEMS` after the `templates` entry:

```tsx
  { key: "discover", label: "Discover", icon: <IconCompass /> },
```

- [ ] **Step 4: Add the discover branch + seed the front door in `OttoView`**

In `apps/web/components/otto/OttoView.tsx`:
- Import the view near the other otto imports: `import OttoDiscover from "./OttoDiscover";`
- Add to `OttoViewProps`: `seedText?: string;` and `onUseInOtto: (prompt: string) => void;` and destructure them in the function signature.
- Add a branch alongside the existing `library`/`stuff`/`memory`/`account` blocks (before the `view === "otto"` two-pane return):

```tsx
  if (view === "discover") {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <OttoDiscover onUseInOtto={onUseInOtto} />
      </div>
    );
  }
```

- Add `seedText={seedText}` to the existing `<OttoFrontDoor ... />` render (the one in the `showFrontDoor` branch). Do NOT change its other props.

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && pnpm exec tsc -p tsconfig.json --noEmit`
Expected: 0 errors; `OttoViewKey` union, NavItem, OttoView props/branch, `OttoFrontDoor` `seedText`, and the `OttoApp` pass-down all line up.

- [ ] **Step 6: Run the whole web test suite**

Run: `cd apps/web && pnpm exec vitest run`
Expected: `inspirations.test.ts` passes; the only failures are the pre-existing `DATABASE_URL`-not-set integration tests (`require-owner`, `tenant-guard`, `files route`, `isolation`).

- [ ] **Step 7: Full monorepo build gate**

Run: `pnpm -r build 2>&1 | tee /tmp/g5c-build.log; grep -E "ƒ /otto|Done|error TS|Failed to compile" /tmp/g5c-build.log`
Expected: the log shows `├ ƒ /otto` and `Done`, and NO `error TS` / `Failed to compile`.

- [ ] **Step 8: Commit**

```bash
git add apps/web/components/otto/OttoFrontDoor.tsx apps/web/components/otto/OttoApp.tsx apps/web/components/otto/OttoNav.tsx apps/web/components/otto/OttoView.tsx
git commit -m "feat(g5c): Discover nav + front-door seed wiring; build-verified"
```

---

## Self-Review

**Spec coverage:**
- §2.1 catalog + helper → Task 1. ✓
- §2.2 `<OttoDiscover>` (grid · Dialog · Use in Otto · Copy) → Task 2. ✓
- §2.3 front-door seed → Task 3 Step 1. ✓
- §2.4 nav + seed wiring → Task 3 Steps 2-4. ✓
- §5 money/safety → no `startGen`/charge/grant anywhere; Discover reads only static module data; "Use in Otto" sets a string + switches view. ✓
- §6 testing → Task 1 unit tests (catalog + helper); Task 3 runs suite + build gate. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. (The `[your product]` strings are intentional fill-in hints in user-facing copy, not plan placeholders.)

**Type consistency:** `Inspiration`/`INSPIRATIONS`/`inspirationCategories` (Task 1) are consumed verbatim in Task 2. `OttoDiscover({ onUseInOtto: (prompt: string) => void })` (Task 2) matches the `OttoView` branch and the `OttoApp` `handleUseInOtto` passed down (Task 3). `OttoViewKey` gains `"discover"` (Task 3 Step 2), consumed by the NavItem (Step 3) and the OttoView branch (Step 4). `seedText?: string` is added on `OttoFrontDoorProps` (Step 1), passed by `OttoView` (Step 4), sourced from `OttoApp` state (Step 2).
