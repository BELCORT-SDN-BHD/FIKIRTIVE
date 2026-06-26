# Otto Skill Framework — `defineOttoSkill()` + Registry + Authoring Standard — Design

**Status:** Approved design (brainstorm complete 2026-06-26). Next step: implementation plan via `writing-plans`. Final PR goes to 总司令 for merge.

**Goal:** Turn Otto's today-informal "tool + port + instruction + gate" convention into a **standard**: a fail-closed `defineOttoSkill()` wrapper that derives `needsApproval` from a 3-field declaration, a registry that auto-wires skills into the agent, and an **authoring standard** that is both (a) reliably followable by an AI coding agent (Claude Code / Codex) and (b) skimmable by a human reviewer. Migrate the existing 5–6 tools onto it as proof, with **zero runtime behavior change**.

**Architecture:** This is a **layer that sits ON the agent runtime, not the runtime itself.** The runtime stays `@openai/agents` (`run()`, `RunState`, `tool()`, the approval-interrupt engine) — untouched, per the locked decision to keep it and *not* swap to HERMES. `defineOttoSkill()` is a build-time factory: each skill is "stamped" with its gate when it is *defined* (module load), and the factory still returns a plain SDK `tool()` whose shape is byte-for-byte what Otto gets today. There is **no new runtime dispatcher / interceptor**; the money path (`ctx.startGen`) gets no new code on it.

**Tech stack:** `@openai/agents` (existing, pinned), Zod (existing), TypeScript, `packages/otto`. No new runtime dependencies.

---

## Global Constraints (hard)

- **Do NOT touch the agent runtime.** `@openai/agents` `run()`/`RunState`/approval engine is unchanged. This PR adds a layer above it.
- **Behavior-preserving refactor.** Migrating the existing tools must not change what the SDK receives. In particular `generate` must keep: `needsApproval` resolving to **literal `true`**, the `cardId`-only anti-flip input, the `cowork:<cardId>` exactly-once guard, and owner-scoping by `ctx.orgId`. Existing tests stay green (`generate.test.ts`, `propose` tests, otto suite).
- **Do NOT touch the money/generation path internals.** The factory wraps the *definition* of `generate`; it does not alter `executeGenerate`, `ctx.startGen`, `reserveCredits`, `packages/otto/src/meter.ts`, or the worker. The spend stays exactly where it is, behind `needsApproval: true`.
- **No new external network calls in this PR.** The `searchWeb` "联网" skill in §9 is a *worked example/template* of how a future skill is authored — it is **not** implemented or wired in this PR.

---

## 1. Why now

The locked product direction (`2026-06-24-fikirtive-product-concept.md:53`) says to build the `defineOttoSkill()` scaffold **before skill #6, not earlier**. Otto today has 5 wired tools (`propose`, `generate`, `updateBrief`, `describeRefs`, `setTitle`) and `rememberBrandFact` (PR #16, off-main) is #6. We are at the threshold. The trigger condition is met.

The future workflow is explicit: **BELCORT authors new Otto skills one at a time, assisted by Claude Code / Codex.** So the standard has two readers — the AI agent that writes the skill, and the human (founder) who reviews it — and must serve both.

---

## 2. The gate taxonomy (the heart)

North star: *"before any step that spends money or is irreversible/external, he checks with the boss."* Mirrors Claude Code's permission model (read-class tools auto-run; write/execute-class tools prompt).

Every skill declares **three fields**:

```ts
cost:   "free" | "spend"        // spends FIKIRTIVE credits?
effect: "read" | "write"        // changes state (own DB OR the outside world)?
reach:  "internal" | "external" // touches the outside world?
```

`needsApproval` is **derived, never hand-written**:

```ts
needsApproval = (cost === "spend") || (effect === "write" && reach === "external")
```

Validation across current + illustrative skills:

| skill | cost | effect | reach | needsApproval | rationale |
|---|---|---|---|---|---|
| `rememberBrandFact` | free | write | internal | ❌ | internal write, ours, reversible |
| `propose` | free | write | internal | ❌ | a draft card, nothing spent |
| `updateBrief` / `setTitle` | free | write | internal | ❌ | internal metadata |
| `describeRefs` | free | read | internal | ❌ | reads owned entities |
| `searchWeb` *(example only)* | free | **read** | external | ❌ | external **read** = like `WebFetch`, info in, nothing changed |
| `generate` | **spend** | write | internal | ✅ | spends credits |
| `postToMeta` *(future)* | free | write | **external** | ✅ | external **write** = publish, irreversible |
| `sendEmail` *(future)* | free | write | external | ✅ | external write, can't unsend |

**Fail-closed defaults:** if any field is missing / `undefined`, the factory treats it as the most dangerous value (`spend` / `write` / `external`) → `needsApproval: true`. Forgetting a field can only ever make Otto *ask more*, never *act unasked*.

> The `reach`/`effect` split was sharpened by the "联网" example: external **read** (web search) must NOT prompt (matches `WebFetch`), while external **write** (post/send) must. A 2-field model could not express that; the 3-field model does, with one boolean formula.

---

## 3. The `defineOttoSkill()` contract

Lives in `packages/otto/src/skill.ts`.

```ts
type Cost   = "free" | "spend";
type Effect = "read" | "write";
type Reach  = "internal" | "external";

interface OttoSkillSpec<P extends z.ZodType> {
  name: string;
  description: string;                 // instruction leg, shown to the model
  parameters: P;                       // Zod schema
  cost: Cost;                          // required — no default
  effect: Effect;                      // required — no default
  reach: Reach;                        // required — no default
  execute: (input: z.infer<P>, ctx: RunContext<OttoContext>) => Promise<unknown>;
  idempotencyKey?: (input: z.infer<P>) => string;  // REQUIRED when cost === "spend"
}

export function defineOttoSkill<P extends z.ZodType>(spec: OttoSkillSpec<P>): Tool;
```

### 3.1 What the factory enforces — and what it cannot (honest boundary)

Enforced at **definition time** (a violation throws on module load → the app fails to boot = fail-closed):

| # | Check | Enforceable? |
|---|---|---|
| 1 | `cost==="spend"` OR (`effect==="write"` && `reach==="external"`) → set `needsApproval: true` (**literal**, never a predicate) | ✅ fully |
| 2 | Any of `cost/effect/reach` missing/undefined → treat as most-dangerous → `needsApproval: true` | ✅ fully |
| 3 | `parameters` schema must NOT contain identity keys (`orgId`, `ownerId`, `userId`) — identity comes only from `ctx` | ✅ fully (inspect the Zod shape at registration) |
| 4 | `cost==="spend"` requires `idempotencyKey` — missing → throw | ✅ fully |
| 5 | "spend only via the metered port (`ctx.startGen`), never direct fal/`reserveCredits`" | ⚠️ **NOT** — the factory cannot see inside `execute`. Stays a test + code-review concern (as today). |
| 6 | "owner-scoped WHERE clauses are correct (e.g. `ownerId: ctx.orgId`)" | ⚠️ **NOT** — the factory doesn't know which tables a skill queries. It guarantees #3 (identity not from model) only; correct scoping stays a test concern. |

The factory makes the **gate decision** mechanical and unforgettable (#1–#4). **Business correctness** (#5–#6) remains the job of tests — exactly as it is today, so no regression. We do not oversell the wrapper as a silver bullet; it precisely kills the one accident class we fear most ("forgot the gate → silent spend / external action").

### 3.2 Fail-loud errors are written for the AI author

Definition-time throws use messages an agent can act on, e.g.:

```
[defineOttoSkill] "transferMoney" is cost:"spend" but declares no idempotencyKey.
Add:  idempotencyKey: (i) => `transfer:${i.id}`
```

This is the AI author's self-correction loop (it reads the error, fixes the file) and the human's safety net (a mis-declared skill cannot ship).

---

## 4. File system / the standard

```
packages/otto/src/
├── skill.ts            ★ defineOttoSkill() — the standard itself
├── registry.ts         ★ collects all skills → otto.tools + metadata for CATALOG/console
├── context.ts            OttoContext — every port (the seam to the outside) is declared here
├── instructions.ts       central identity + per-skill instruction snippets
├── otto.ts               the Agent — reads tools from the registry (no hand-keyed array)
└── skills/             ★ one file per skill (renamed from tools/)
    ├── AGENTS.md         the authoring rulebook (single source of truth)
    ├── CLAUDE.md         one line: @AGENTS.md   (Claude Code pointer; matches apps/web pattern)
    ├── _template.ts      heavily-commented copy-me skeleton
    ├── CATALOG.md        auto-generated table of every skill (CI-checked fresh)
    ├── propose.ts
    ├── generate.ts
    ├── remember-brand-fact.ts
    ├── update-brief.ts
    ├── describe-refs.ts
    └── set-title.ts
```

`skill.ts` + `registry.ts` + `skills/` is the whole "file system + standard." Adding a skill becomes filling in blanks.

### 4.1 Registry

`registry.ts` imports each skill explicitly (typed, no magic globbing), exposes:

```ts
export const allSkills: OttoSkill[] = [propose, generate, /* … */];
export const skillCatalog: SkillMeta[] = allSkills.map(toMeta); // name, cost, effect, reach, needsApproval, description
```

`otto.ts` becomes `tools: allSkills.map(s => s.tool)` (or the skills are already `Tool`s — see §8). Adding a skill = one import + one array entry.

---

## 5. Dual-audience authoring standard

The same artifacts serve the AI author (🤖) and the human reviewer (👁):

1. **Gate declared on the top lines of every skill** — 🤖 fills 3 answers, can't omit; 👁 reads 4 lines to know what it does + whether it's gated, without reading `execute`. This is the core readability choice.
2. **`skills/AGENTS.md` (+ `CLAUDE.md` → `@AGENTS.md`)** — the rulebook: the 5-step procedure, the 3 fields, fail-closed rules, where ports go, the test requirement, a pointer to `_template.ts`. 🤖 reads it automatically when working in the dir; 👁 reads it to recall the standard. Mirrors the existing `apps/web/{AGENTS.md,CLAUDE.md}` pattern.
3. **`skills/_template.ts`** — commented skeleton. 🤖 copies + fills; 👁 recognizes every skill's shape instantly.
4. **Fail-loud, agent-readable errors** (§3.2) — 🤖 self-corrects; 👁 trusts mis-declared skills can't ship.
5. **`skills/CATALOG.md`** — generated from `skillCatalog`, CI-verified up-to-date. 👁 reviews all capabilities in one 30-second table; 🤖 regenerates it when adding a skill.

### 5.1 The realistic future loop

```
You → Claude Code/Codex: "give Otto web search"
   → reads skills/AGENTS.md (the rules)
   → copies _template.ts
   → fills 3 gate fields + the port call + execute
   → adds the registry import + a gate test
   → mis-declared? fail-loud error points the fix → self-corrects
You review → CATALOG.md row + the file's top 4 lines → approve in seconds
```

---

## 6. Migration (behavior-preserving)

Move all existing tools onto `defineOttoSkill`. Each migration is mechanical: wrap the existing `execute` unchanged, add the 3 declaration fields, delete now-redundant hand-written gate lines.

| skill | cost | effect | reach | extra | risk |
|---|---|---|---|---|---|
| `setTitle` | free | write | internal | — | trivial |
| `updateBrief` | free | write | internal | — | trivial |
| `describeRefs` | free | read | internal | — | trivial |
| `propose` | free | write | internal | — | low |
| `rememberBrandFact` | free | write | internal | — | low (lands when #16 merges) |
| `generate` | spend | write | internal | `idempotencyKey: (i) => ``cowork:${i.cardId}``` | **high — money path** |

`generate` is migrated last and guarded: a test asserts the factory output still has `needsApproval` resolving to literal `true` and the same `cardId`-only schema. `executeGenerate` is imported and wrapped **unchanged** — the spend logic does not move.

Directory rename `tools/ → skills/` updates imports in `otto.ts`, `index.ts`, and tests; no logic changes.

---

## 7. Testing strategy

- **Factory unit tests** (`skill.test.ts`): the derivation truth table (all 8 rows of §2); fail-closed on missing fields; throw on identity-keys-in-params; throw on spend-without-idempotencyKey; `needsApproval` is literal `true` (not a predicate) for gated skills.
- **Migration regression**: existing `generate.test.ts` / `propose` / otto suites stay green unmodified (proof of behavior preservation). Add one assertion per migrated skill that its derived `needsApproval` matches the §2 table.
- **CATALOG freshness**: a test (or CI step) regenerates `CATALOG.md` and fails if the committed file is stale.
- 总司令 runs `pnpm -r typecheck` + the otto suite in the real env pre-merge (sandbox can't typecheck — env, not code).

---

## 8. Open implementation questions (resolve in `writing-plans`, not now)

1. **Return type of `defineOttoSkill`** — return the bare SDK `Tool` (simplest; `otto.tools = allSkills`) vs. a small `{ tool, meta }` wrapper object (richer registry/CATALOG, but `otto.ts` maps `.tool`). Leaning: return an object carrying both the `Tool` and the meta, so the CATALOG/console get metadata without re-deriving. Decide during planning.
2. **Identity-key inspection** — read the Zod schema's top-level keys to reject identity fields. The pinned version is `zod@^4.4.3` (`packages/otto/package.json`); Zod 4.x exposes `ZodObject.shape` as the public accessor, so inspect `(parameters as z.ZodObject<any>).shape`. Confirm the skill's `parameters` is a `ZodObject` (object schema) before inspecting.
3. **`rememberBrandFact` ordering** — #16 is off-main. Either land this framework first and migrate `rememberBrandFact` as it merges, or sequence after #16. Note for 总司令 (stacked-PR ordering).

---

## 9. Worked example — `searchWeb` ("联网") as the template (NOT shipped here)

Adding a future skill touches **5 places**; this is the canonical example the spec/template encodes.

**① `context.ts` — declare the port (the seam)**
```ts
searchWebPort?: (query: string) => Promise<WebResult[]>;
```

**② `buildOttoContext` (web/worker) — inject the real implementation** (API key, rate-limit, timeout, logging). The skill never calls `fetch()` directly — outbound access is concentrated on one controlled port, exactly like `ctx.startGen`.

**③ `skills/search-web.ts` — the skill**
```ts
export const searchWeb = defineOttoSkill({
  name: "searchWeb",
  cost: "free", effect: "read", reach: "external",   // → derived: no approval
  description: "Search the web for fresh info about a brand, competitor, or trend…",
  parameters: z.object({ query: z.string().min(1) }),
  execute: async (input, { context }) => {
    if (!context.searchWebPort) throw new Error("searchWeb port required");
    return context.searchWebPort(input.query);
  },
});
```

**④ `registry.ts` — one import + array entry.**

**⑤ `skills/search-web.test.ts`** — `expect(deriveNeedsApproval(searchWeb)).toBe(false)` + port-required guard.

To instead add `postToMeta`, the only change is `effect:"write", reach:"external"` → the factory makes it approval-gated automatically. The author never writes `needsApproval`.

---

## 10. Appendix — non-binding future skill catalog

Listed for orientation only; **none are built in this PR**. Each is a future BELCORT-authored skill = port + skill file + instruction + (derived) gate.

| skill | cost | effect | reach | needsApproval | notes |
|---|---|---|---|---|---|
| `searchWeb` | free | read | external | ❌ | research; the §9 example |
| `forgetBrandFact` / `updateBrandFact` | free | write | internal | ❌ | brand-memory CRUD (audit BMEM follow-ups) |
| `scheduleRun` | free | write | internal | ❌ | queue a future generation (autonomy) |
| `postToMeta` | free | write | external | ✅ | publish; needs Meta port + OAuth |
| `sendEmail` | free | write | external | ✅ | outreach |
| `analysePerformance` | free | read | external | ❌ | pull ad metrics (read-only) |
| `topUpCredits` | spend | write | external | ✅ | Stripe — gated, deferred (G4) |

Ordering, priority, and per-skill specs are out of scope here; this PR only makes adding any of them a fill-in-the-blanks operation.
