# LTX Studio Competitive UX Teardown — for Fikirtive

Grounded against Fikirtive's current M0 build (`01-empty.png`, `04-prompt-saved.png`, `06-attached.png`, `08-library.png`, `09-detail.png` in `/Users/winnin/.gstack/projects/fikirtive/m0-smoke/`) and the approved design doc (`/Users/winnin/.gstack/projects/fikirtive/winnin-master-design-20260610-024210.md`, UX 规格 section, D4–D19 decisions).

---

## 1. LTX Studio UX anatomy

**The IA, as evidenced:**

- **Home hub** = one decision: a 7-tile tool dock grouped CREATE (Gen Space, Canvas, Storyboard, Video Editor, Flows) vs SCALE (Dubbing, Caption), with try-before-you-click hover miniatures (12.57.13–12.57.23 screenshots). Projects are typed by originating tool ("Untitled Flow", 12.58.00).
- **Per-project surfaces**, ordered as a production pipeline in the sidebar: Gen Space → Canvas → Storyboard → Video editor → **Elements** (12.51.27, 1.01.43). Elements — the entity library — is a peer surface, project-scoped, with the @ glyph as its nav icon.
- **Global surfaces**: Assets (cross-project media files, 1.02.27), Brand Kits (Enterprise), Custom Training (a nav item that is purely a sales-modal trigger, 1.02.12/1.02.15), Education hub (1.02.21).
- **The floating composer is the real product.** One bottom-center bar follows the user across Gen Space and Canvas; a mode dropdown (Generate Images / Videos / TTS / Audio-to-Video / Video-to-Video / Retake / Extend / SDR-to-HDR / Upscale) re-templates the entire bar in place (12.51.25, 12.58.13, 12.59.57). Everything about a request is visible at the point of action: model chip, resolution, aspect, batch count, cost glyph, disabled-until-valid Generate.

**Why it lands (why Fikirtive's potential customer loves it):**

1. **Slots-top / text-middle / params-bottom never changes.** Modes swap the contents, never the shell (12.59.50, batch 7 insight). Muscle memory transfers across the whole suite.
2. **References are typed by role, not dumped in a bucket.** 'ADD IMAGE REFERENCE' vs 'CONSISTENT ELEMENT' (@ icon) as two side-by-side tiles (12.51.14, 1.01.43); 'ADD START FRAME' / 'ADD END FRAME' / 'ADD STYLE IMAGE' / 'POSE' control chip (12.59.43, 1.00.08–1.00.10). The slot name tells you how the model will use the asset.
3. **The UI teaches itself at the input.** Placeholder text rotates worked examples ('Use @Element to add characters, e.g., "@Character walking in the park"', 12.51.32); bracket-DSL tooltip on an (i) icon (12.51.48); control-mode picker with paired ORIGINAL/RESULT example videos (1.00.12–1.00.19); aspect ratios as true-proportion glyphs (12.51.35); camera moves previewed on an identical subject (12.59.46). Nothing requires docs.
4. **Validation is silent and visual.** Generate stays gray until required slots are filled; file formats are stated on hover before a wrong drop (1.00.02). No error dialogs.
5. **Identity = handle.** The element-creation NAME field is hard-prefixed with '@' and saving is blocked without a reference image ('Please pick a source image', 12.58.56, 12.59.06). What you type at creation is exactly what you @mention later.

The dissonance: the polish is real, but Trustpilot (1.5/5, 88% one-star) shows the *economics under the UX* poison it — opaque credits, retry death-spirals, entities that mutate between logins, @tags that silently break (trustpilot.com/review/ltx.studio, pages 1–3). The UX is good; the business model it serves makes users hate it.

---

## 2. Where LTX and Fikirtive overlap and where they fundamentally differ

**Overlap — Fikirtive's core bets, independently validated by the incumbent:**

- **@mention entities are proven UX.** LTX's @ syntax with autocomplete ("works like mentioning someone on social media", ltx.io/blog/getting-started-with-elements) is functionally identical to Fikirtive's @mention chips (`04-prompt-saved.png`). The market leader converged on the same grammar.
- **The taxonomy matches almost word-for-word.** "Save characters, props, products, or places you want to reuse" (Elements empty state, 12.52.29) ≈ Fikirtive's characters/locations/products/brands (`08-library.png`).
- **Reference-vs-entity is a real distinction.** LTX renders it as two separate composer tiles (1.01.43) — exactly the conceptual split Fikirtive is built on.
- **Model-neutrality at the reference layer is conceded by the vertically-integrated player itself.** LTX ships OpenAI/Google/BFL/Alibaba/Kling/Seedance models as swappable chips and nodes (12.51.23, 12.59.32–12.59.37, 12.57.36), and its own Flows Prompt node carries an '@' attach button (12.57.30). Even LTX treats prompt+references as the stable unit and the model as an interchangeable slot.

**Fundamental divergence — and what it means for borrowing:**

| Dimension | LTX | Fikirtive |
|---|---|---|
| Generation | In-house, credit-metered; every iteration is billable revenue (calcalistech, pricing page) | External (ComfyUI Phase 1; BYO keys Phase 2); zero metering |
| Entity scope | Per-project; cross-project only via Enterprise Brand Kit (12.52.29, 1.02.23) | Global library across projects (`08-library.png`: "shared across all projects") |
| Entity history | Live propagation — "update once, propagate everywhere"; no snapshots | Frozen entity snapshots in generation history (doc invariant #3) |
| Entity layer pricing | Paywalled: Elements at $35/mo Standard; brand assets and custom training at Enterprise (1.01.48, 1.02.12) | The free foundation — the wedge itself |
| Consistency mechanism | Reference conditioning + LoRA/Actor fine-tuning (model lock-in) | Pure reference management above any model |

The structural consequence: **LTX's UX is optimized to keep the loop inside the meter.** Externally-rendered content has no place in their model — their credit economics forbid it. That is exactly the door Fikirtive walks through (and their own open-source users are asking for it: github.com/Lightricks/ltx-desktop/issues/104 requests character consistency for local generation). So the borrowing rule is: **steal point-of-prompting interaction patterns and teaching mechanics freely; reject anything whose existence assumes in-platform, metered generation.**

---

## 3. BORROW list (prioritized)

**Quick wins:**

1. **@ hard-prefixed name field at entity creation** (12.58.56: NAME input literally starts with '@', placeholder '@Element'). Why: fuses handle and identity at the moment of creation — the user never has to "learn mention syntax" because they typed the handle themselves. Effort: **S**. Lands on: Workbench Subjects panel create form (`01-empty.png`) + Library "+ New character/location/…" forms.
2. **Worked-example teaching placeholders in the @composer** (12.51.32: '@Character walking in the park'; 12.51.48: just-in-time (i) tooltip for the bracket DSL). Why: the @ grammar is Fikirtive's one piece of syntax; teach it inside the input. Extends the doc's approved placeholder "Type @ to reference…" (48-state grid, D6) — consistent, not contradicting. Effort: **S**. Lands on: @composer empty/placeholder state.
3. **Reference-capture best-practice microcopy in upload zones** (12.58.56: "Upload multiple images from different angles for better results"; LTX blog: neutral backgrounds, varied framings, ltx.io/blog/how-to-create-a-consistent-character). Why: Fikirtive's value is reference quality; teach it where refs enter. `08-library.png` already does this for Products ("Clean studio shots from several angles") — extend to all four types and the entity detail "+ Add" (`09-detail.png`). Effort: **S**.
4. **Loud referential integrity.** Trustpilot's most damning entity complaints are silently broken @tags (Witek: "@tag system… doesn't work at all"; Michael Fierro: prompts referencing "@blah" that "does not exist"). Doc already specifies gray+strikethrough deleted chips (D6); go further: "Copy resolved prompt" must hard-validate every mention resolves to a live entity with ≥1 reference, and block-with-reason otherwise. Effort: **S**. Lands on: composer Copy/Save actions.
5. **"How to" one click from creation** (12.52.29: ghost 'ⓘ How to' beside '+ New Element'). Why: pairs education with the primary CTA without a docs site. For M0 this can be a popover, not a video. Effort: **S**. Lands on: Subjects panel + Library section headers.
6. **Mandatory-or-loud reference enforcement** (12.59.06: save blocked with inline "Please pick a source image"). ⚠️ **Flag, don't silently adopt:** the approved doc specifies a *missing-image warning* in the left rail (缺图警示), implying entities may exist ref-less (useful as placeholders during scripting). Recommendation: keep warn-not-block, but make the warning LTX-loud — badge on the entity chip AND on any shot that @mentions a ref-less entity, plus the validation in item 4. Effort: **S**. Founder should ratify this divergence explicitly.

**Medium / structural:**

7. **Prompt-anchoring in the resolved prompt / ComfyUI export pack.** LTX's documented consistency technique #4 is a standardized 50–80-word character description block reused verbatim (ltx.io/blog/how-to-maintain-character-consistency-in-ai-video). Fikirtive already stores Notes + Negative Constraints per entity (`09-detail.png`) — fold them into "Copy resolved prompt" output and the prompt-pack export as a per-entity anchor block + negative section. This makes Fikirtive's export measurably better than hand-copying. Effort: **M**. Lands on: composer copy action + export pipeline (doc 阶段一 ComfyUI prompt 包导出).
8. **Role tags on reference images** (LTX types every slot: START FRAME, STYLE IMAGE, POSE; teaches "varied framings — close-up, medium, full body"). For Fikirtive: tag each reference inside an entity (face close-up / full body / turnaround / style) so exports can say which ref serves which purpose in a ComfyUI graph (IPAdapter face vs style, etc. — the founder's home turf). Effort: **M**. Lands on: Library detail panel (`09-detail.png` REFERENCES grid).
9. **Status-bearing chip row as a "request sentence."** LTX's composer footer reads as the active configuration at a glance (12.58.32). Fikirtive's per-shot equivalent: shot card footer chips = entities used + version count + state badge (Draft → Exported → Attached → Final per doc state machine). `06-attached.png` is most of the way there; make the state chip carry the doc's four-state machine explicitly. Effort: **M**. Lands on: shot board cards.
10. **"Unattached · N" as the default-front filter with batch attach.** Already approved in the doc (D6 grid + batch-attach floating bar) — LTX's candidate-batch mental model (Flows fan-out, 12.57.23) confirms users think in batches of candidates. Note the delta: doc D4 places candidates as the bottom History panel's "Unattached" filter; current build (`01-empty.png`) shows a separate right-column Candidates zone. Reconcile toward the doc. Effort: **M** (already scheduled).
11. **Phase 2 prep — target/template as a composer chip.** LTX proves model-as-swappable-chip with one-line plain-language descriptors and per-row cost (12.51.23, 12.52.04). When Fikirtive Phase 2 adds BYO-key generation, the user's templates/models should appear as exactly such a chip row with one-clause descriptions — not a settings page. Effort: **L** (Phase 2). Lands on: composer footer. See section 5.
12. **Entity variants as first-class states (backlog).** LTX's documented workaround is duplicating elements (@Sarah_casual / @Sarah_formal — lightricks.zendesk.com character docs), which users find clunky. Fikirtive can beat it with variants under one entity (e.g., @Maya → outfit picker), and frozen snapshots already give the data model a head start. ⚠️ Not in the approved M0 scope — backlog item, must not block M0 per the doc's 施工顺序铁律. Effort: **L**.

---

## 4. REJECT list

1. **Any metering of the entity/reference layer.** LTX charges credits to *create* an actor (Patrick: "creating a professional actor burned $5"; Witek: 1,000 credits for one actor) and gates Elements to the $35 tier (1.01.48). This is their single most resented pattern and the exact inverse of Fikirtive's wedge. The reference layer stays free, always.
2. **Live propagation of entity edits into history.** LTX's "Replace Image… automatically applies anywhere that Element is tagged" produced Zoe Green's nightmare ("The system had decided of its own volition to edit my characters between logins"). Directly conflicts with Fikirtive's approved frozen-snapshot invariant (doc invariant #3). Edits propagate *forward* only; history is immutable.
3. **Project-scoped entities.** LTX's Elements live per project; cross-project reuse is an Enterprise Brand Kit upsell (1.02.23). Fikirtive's global library (`08-library.png`) is the differentiator — never scope it down, even "for tidiness."
4. **Consistency via fine-tuning (Actors/LoRA, immutable after training, Enterprise sales motion** — 1.02.12 "Unlock Custom Training"). Model-locked, compute-heavy, anti-thesis. Fikirtive's positioning statement writes itself against this: consistency from references, no training, any model.
5. **Multi-surface suite sprawl.** Seven tools, five per-project surfaces, Canvas + Flows + Pitch Decks. For a solo founder this is a scope trap, and the doc fixes Workbench as the 唯一主画面. Even LTX users complain about it (Richard Sudborough lost 6 hours finding the prompt field). One workbench, full stop.
6. **Generation parameter chips in Phase 1 (model / resolution / aspect / variations / cost).** Every one of these assumes in-platform generation. Premature in Phase 1; selectively revived in Phase 2 for BYO-key targets only.
7. **AI script-to-storyboard / auto cast extraction.** Attractive demo, but it's where LTX's referential integrity collapses (Fierro's broken "@blah" cast; FYV: "ate up all credits instantly by pressing one button") and it's a giant NLP scope item. Not Fikirtive's job.
8. **Opaque abstraction units.** LTX renamed "computing seconds" → "credits" mid-flight and needed an in-product FAQ to explain it (12.57.05); users called the opacity "100% by design" (Jens snej). If Fikirtive ever quotas anything (storage), use concrete units (GB, files).
9. **Teaser/upsell chrome:** permanently disabled "Collaborate" buttons, nav items that are sales modals (Custom Training, 1.02.15), "Book a demo" in the sidebar. Irrelevant for single-user Phase 1 and corrosive to trust.
10. **UI churn as a way of life.** Long-term subscribers' top complaint is "constant shifting sands every time you log in" (Alex H), silent feature removal (Cole). An entity layer is a system of record — Fikirtive should bias toward stability and migration paths over feature velocity. Process rule, not a feature.
11. **Variant-by-duplication** (@JohnSmith vs @JohnSmithBeach). Don't replicate the workaround; do variants properly later (Borrow #12) or not at all.

---

## 5. The one structural insight

**The composer is the stable shell that absorbs the roadmap; surfaces don't multiply — the footer re-templates.** LTX's deepest IA move is that one slots-top / text-middle / params-bottom composer carries the entire product: modes, models, references, validation, cost, and teaching all morph *inside* a fixed shell (batches 1, 6, 7). Users never relearn the room; only the furniture changes. Fikirtive's Phase 1 → Phase 2 transition (manual ComfyUI copy-out → BYO-key generation) is exactly the kind of evolution this shell is built for — and getting the shell right now means Phase 2 adds a dropdown, not a redesign.

Migration sketch (does not alter M0 scope; steps 1–2 are M0-compatible refinement, 3 is the gate, 4–5 are Phase 2):

1. **M0 as-is, plus the doc delta:** keep composer + shot board; move Candidates into the bottom History panel's "Unattached" filter per D4 (current right-column placement in `01-empty.png` diverges from the approved doc).
2. **Formalize the three-band composer shell:** top band = @mentioned entities rendered as reference thumbnails with role labels (read-only mirror of the chips in text — LTX's 'CONSISTENT ELEMENT' tile, made automatic); middle = prompt text with chips; bottom = action footer (Save prompt / Copy resolved prompt / shot state chip).
3. **Introduce an explicit "Target" chip in the footer, even though Phase 1 has exactly one value: `ComfyUI · manual`.** This costs almost nothing now but establishes the slot where model/template choice will live — the same move as LTX's model chip. Copy resolved prompt / Export pack become the "verb" of that target.
4. **Phase 2: the Target dropdown gains the user's own API templates/keys** (one-line plain-language descriptors per row, LTX-style); selecting an API target morphs the footer verb from Copy → Generate, and results auto-land in the same Unattached candidate flow manual drops use today. One ingestion path, two sources.
5. **Throughout: every version in History records the frozen composer state** — entities (snapshotted), references, resolved prompt, target — identical record shape for manual and API renders. This is the doc's snapshot invariant doing double duty as the Phase 2 data contract.

The strategic kicker: LTX built this composer to keep users inside the meter. Fikirtive builds the same shell to point *outward* — same ergonomics, inverted economics. That's the whole positioning in one component.