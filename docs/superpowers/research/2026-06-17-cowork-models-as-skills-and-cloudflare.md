# Two architecture questions — research synthesis (for Codex validation)

Date: 2026-06-17. Status: DISCUSSION ONLY (no build). Synthesised from 4 grounded research passes
(2 web + 2 codebase via codegraph). This doc is the input for a Codex adversarial review: **challenge
the conclusions, find where the reasoning is wrong, optimistic, or missing a money-safety angle.**

---

## Idea 1 — Make each generation model a "skill" the cowork agent operates

Reference the user gave: `github.com/Emily2040/seedance-2.0` — an "Agent Skill OS" for ONE model
(SKILL.md router + 24 sub-skills + 70 reference docs + evals + CI), MIT.

### What the research found
- The pattern is **Anthropic Agent Skills / progressive disclosure**: a thin router (`name`+`description`
  ~80 tokens loaded at startup) → fat specialist sub-skills (loaded on match) → dense reference docs
  (loaded only when cited). Token economics flip from "pay for all models every request" to "pay per use."
- seedance-2.0 is the **single-model deep** template. The architecturally relevant one for us is
  **`Square-Zero-Labs/video-prompting-skill` (Apache-2.0)**: ONE shared router/workflow + a thin
  per-model reference folder each (`references/models/{seedance2,sora,veo3,wan22,ltx2,ovi}/prompting.md`).
  That is exactly cowork's "one agent juggling ~14 models" shape. Also `OSideMedia/higgsfield-ai-prompt-skill`
  (MIT) aligns with our Higgsfield-mode reference work. Licenses are SaaS-friendly (MIT/Apache-2.0).
- ~80% of a model-skill is **model-agnostic scaffolding** (router contract, the sub-skill *categories*:
  interview/prompt/camera/motion/lighting/characters/style/vfx/audio/recipes/troubleshoot + governance:
  copyright/antislop/filter; generic craft refs; the eval+CI harness). ~20% is **bespoke per-model**
  (capability map, volatile platform facts, mode quirks, strong-vs-avoid phrase tables) — the part that
  decides quality AND rots fastest.

### What cowork ALREADY has (≈60% of the idea)
- **`ModelDirective`** (Prisma) — DB-backed, founder-editable, versioned (`ModelDirectiveRevision`),
  audited, admin-UI'd (`/admin/directives`), keyed **`@@unique([ownerId, family, mode])`** (family×mode,
  not per-model-id). Columns: `directive` (≤2000 prose), `rules` (JSON), confidence, enabled, source.
- **`DIRECTIVE_SEED`** (`cowork-directives.ts:66`) — 7 research-backed family×mode cells with real prompting
  recipes ("lead with motion and camera", "no comma-tag soup", "LTX face-merges multiple characters").
  This is already prose prompting-knowledge per family — the embryo of a SKILL.md.
- Resolution (fresh-on-read, no cache): `getEnhanceDirective(family,mode)`, `getCastRule`, `getRulesMap`
  in `cowork-knowledge.ts`.
- Typed per-model capability surface: `GEN_VIDEO_MODEL_OPTIONS` / `GEN_VIDEO_MODEL_INFO` / `VIDEO_CFG`
  (durations/resolutions/aspect/fps/audioToggle/maxCount + fal endpoints + param-name mapping).
- Deterministic capability-aware router: `suggestModel` (`cowork-route.ts:33`) — **no LLM**, filters by
  capability then picks cheapest, snaps params to the model's option lists.

### The genuine gaps (what "models-as-skills" actually adds)
1. **Knowledge does NOT reach the planner.** Directives feed only Enhance (`enhancePromptSkill`),
   the Guardian (`getCastRule`), and the offline composer coach (`getRulesMap`). The cowork **planner**
   sees only a flat model-name string (`modelSummary` = "image: …; video: … (agent picks by capability)").
   Routing per-model capability + recipe text INTO the planner is the biggest behaviour change.
2. **Richer per-model content** beyond a ≤2000-char directive + 5-field rules object (recipes,
   troubleshooting decision-tree, golden examples, capability narrative).
3. **Per-model-id granularity** (today `kling-2.6` and `kling-3` collapse to one `kling` family directive —
   a deliberate simplification per `MODEL_FAMILIES`).
4. **Eval harness** — `evals.json` + rubric (release passes only if every case ≥2, avg ≥2.6) + CI.
   This converts "is the prompt good?" into an enforceable regression gate per model. Directly targets
   our logged cowork quality audit (~6.8/10).

### Money-safety boundary (LOAD-BEARING — must survive any skill redesign)
- The ONLY spend path: user clicks Generate → `coworkGenerate` → `startGen` → `genRequest` zod
  `superRefine` + `checkCast` Guardian → `GenJob`. The planner is told NOT to pick a model; `suggestModel`
  (deterministic) does; the typed gate re-validates every (model, params) at spend.
- **The authoritative capability declaration + validation MUST stay typed TS** (`GEN_VIDEO_MODEL_OPTIONS`,
  `VIDEO_CFG`, `genRequest.superRefine`). A SKILL.md may *describe* capabilities for the planner's benefit,
  but must never BE the validation. If a skill's prose disagreed with the typed config, the zod gate still
  wins (worst case = a confusing out-of-bounds rejection, never a mispriced spend).
- Risk to watch: a skill registry that **re-declares** capabilities = a third source of truth that can
  drift from `GEN_VIDEO_MODEL_OPTIONS` (gen.ts) and `VIDEO_CFG` (generation). Skills must **reference**,
  not duplicate, the typed config.

### Recommendation (Idea 1)
Adopt the **spirit**, not a framework install (cowork is a bespoke server-side agent loop; there's no
Claude-Code filesystem auto-loader — we'd build the loader). Concretely:
- **Extend the existing `ModelDirective` seam**, don't reinvent. Use the `video-prompting-skill` shape:
  shared craft skills (camera/lighting/motion/anti-slop/IP reused across models) + **thin** per-model refs
  (capability map + quirks + 5–10 golden examples + param schema-by-reference). **Do NOT 24×14.**
- **Route this knowledge into the planner** (the real new wiring) — likely on-demand (only the routed/
  in-play model's skill), preserving the progressive-disclosure token win.
- Keep typed config = enforced gate; skill markdown = advisory prompting knowledge. Separate, non-negotiable.
- **Adopt the eval harness** even if we author content ourselves — it's the highest-value piece for quality.
- Consider re-keying directives family→model-id where per-version skill differs.
- Fold into OPT-6 (admin model registry/dashboard). Vendor MIT/Apache-2.0 refs with attribution; own the
  router + evals.
- Freshness is the #1 operational cost at ~14 models — scope per-model depth to slow-changing craft + a
  tiny dated volatile-facts file, or you ship confidently-wrong stale facts.

---

## Idea 2 — Move EVERYTHING (incl. the worker) to Cloudflare for centralized management

### Verdict: No. Status quo + selective consolidation at most.

### The three independent dealbreakers (each alone rules out all-Workers), grounded
1. **Native ffmpeg/ffprobe binaries.** `apps/worker/src/jobs/render.ts:166` spawns `ffmpeg` via
   `execa` (10-min timeout, filter_complex, `-progress` parsing); `ingest.ts:29` spawns `ffprobe`.
   Installed via **apt in `apps/worker/Dockerfile`**. Cloudflare Workers = V8 isolates: no `child_process`,
   no native binaries, no filesystem; `ffmpeg.wasm` is blocked by workerd + wouldn't fit 128 MB / 10 MB
   bundle. **Definitively impossible in Workers.**
2. **Long, synchronous, blocking fal calls.** `packages/generation/src/index.ts:229` (image) and `:321`
   (video) use fal's sync `fal.run/<model>` endpoint and `await` until done — **minutes** for video.
   Workers' CPU/wall limits (30s default, 5 min max; Cron consumer 15 min) + exactly-once spend invariants
   are fundamentally incompatible with a short-lived retry-on-timeout isolate. (Workflows V2 durable
   execution could re-model this, but that's a rewrite, not a lift.)
3. **pg-boss is IN Postgres + the schema can't go to D1.** Queue lives in the `pgboss` schema; worker is
   the consumer, web is a send-only producer (`apps/web/lib/queue.ts`). Schema = **21 models, 9 enums**,
   String[] arrays, 15+ JSON columns, BigInt, and **partial-unique indexes that are load-bearing for
   money-safety** (double-spend guards) — none portable to D1/SQLite (no arrays/enums/real transactions;
   Prisma can't do transactions on D1). The Cloudflare-native way to keep Postgres is **Hyperdrive in
   front of Neon** — i.e. you KEEP Postgres, so it's already not "all-Cloudflare."

### What "move the workers to Cloudflare" actually means
Cloudflare **Containers** (GA 2026-04) — not Workers. Containers can run the apt-ffmpeg image and long
jobs (≈ "lift the existing Dockerfile"). But Containers is **a container host like Railway/Fly** (it's
DO+Worker-fronted, scale-to-zero). So the heaviest workload's architectural gain is **mostly cosmetic** —
you'd trade Railway for an equivalent container runtime, plus take on the queue rewrite + DB bridging.

### What genuinely ports
- **R2** — already on Cloudflare (`packages/storage` r2 driver via S3 SDK). The one clean win, already done.
- **Web** — Node-runtime Next 16 (Prisma adapter + `pg` + pg-boss producer, explicitly externalized;
  no edge runtime). Portable via OpenNext 1.0 (GA Feb 2026) with real QA risk on a *customized* Next, or
  lift to Containers. Medium effort, modest benefit over Railway.
- Cron sweeps → Cron Triggers; fal-polling orchestration → Workflows V2 (genuinely better durability).
  But neither helps the CPU-heavy ffmpeg work.

### Recommendation (Idea 2)
**Keep the best-of-breed stack** (Railway web + worker, Neon, pg-boss, R2). The worker's job (native
ffmpeg + minutes-long blocking gen + DB-transaction-coupled queue) is exactly what a normal container host
does well and what Cloudflare *compute* does worst. The "集中式管理 / centralized management" the user wants
is better delivered by the **admin dashboard + unified observability (OPT-6)** — one control plane over the
existing services — NOT by single-vendor lock-in to a runtime that can't run the heaviest workload.
Pursue hybrid (web→Workers/OpenNext, worker→Containers+Workflows, Neon via Hyperdrive) ONLY if a concrete
pain appears (Railway cost, global latency) — it's a multi-week migration with real risk and no correctness
upside, on a path where we've already fought double-spend bugs.

---

## Questions for Codex
1. Idea 1: Is "extend ModelDirective + route into planner + adopt eval harness, keep typed gate separate"
   the right call, or is there a cleaner architecture? Any money-safety hole in letting per-model skill
   *prose* influence the planner while the zod gate stays authoritative?
2. Idea 1: Is re-keying directives family→model-id worth the added tuning surface, or is family-level
   enough? Any risk in feeding per-model skill text into the planner on-demand (freshness, injection)?
3. Idea 2: Are the three dealbreakers actually independent and correct? Any way all-Cloudflare-Workers
   could work that we dismissed too fast (e.g. Workflows + Containers combo)? Is "status quo" too
   conservative given Containers GA?
4. Either: what's the strongest counterargument to our recommendation that we haven't addressed?
