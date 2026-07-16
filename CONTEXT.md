# CONTEXT.md — FIKIRTIVE Domain Glossary 词汇表

This is a **derived vocabulary aid** for the agent and the user (founder) when talking about
FIKIRTIVE. It exists to reduce naming drift (one thing, one name) and to let a non-programmer
read the domain in plain language. It is not product authority or a current-status source. If
code, UI, an approved plan, or a current GitHub decision disagrees with this glossary, trace the
authoritative source and update this file only after the terminology is resolved; do not rename
anything merely because this file says so.

Glossary only — no implementation detail, no file paths. Each entry:
**Term** (中文) — one-line meaning. _Avoid:_ confusing synonyms.

Reading the table below:
- **preferred term** = the vocabulary derived from the cited product/code context; verify it
  against the current task before changing product or code.
- _Avoid_ = words that mean the same thing but cause confusion — do not introduce them.

---

## Tenancy & customer 租户与客户

- **Org / Organization** (组织 / 租户根) — The top-level tenant: the account that owns billing and
  contains one or more Brands. Today tenancy is flat (Org owns everything directly); the Brand tier
  is being introduced (thin first, full isolation later). _Avoid:_ account, workspace, team.

- **Merchant** (商家) — Fikirtive's customer: a paying Org. An SMB merchant is one Org with one
  Brand; a multi-brand operator is one Org with many Brands. Metrics/forecast count merchants =
  paying **Orgs** (not Brands, not Users). _Avoid:_ Brand (a merchant may have many), User (a login),
  customer (overloaded — see below).

- **Customer** (买家 — the merchant's buyer) — A buyer of a *merchant's* products; the entity the
  Brand Brain / CRM will track (G5). This is **NOT** Fikirtive's customer — Fikirtive's customer is
  the **Merchant**. Always disambiguate: "merchant" pays Fikirtive; "customer" pays the merchant.
  _Avoid:_ using "customer" to mean the merchant; user; lead (a lead is a pre-customer).

- **Brand** (品牌 / 租户中间层) — A merchant's brand/business under an Org (Org → **Brand** → Project).
  Holds that brand's Brand Brain and projects. An SMB has one auto-created Brand; a multi-brand
  operator has many. **This is the tenancy "Brand" — NOT a creative reference.** _Avoid:_ Brandmark
  (the creative-reference EntityType), workspace, account, merchant (a merchant is the *person/org*).

- **Brand Brain** (品牌大脑) — The living context for one Brand: its voice, **Brand Kit** (visual
  identity), product catalog, and (later) customers / conversions / what-converts. Otto reads it so
  every output is on-brand, and writes back to it. _Avoid:_ profile, memory, knowledge base, context (overloaded).

- **Brand Kit** (品牌套件) — A Brand's *always-on* visual identity inside its Brand Brain: logo,
  colour palette, typography, tone of voice, and style rules that Otto applies to *every* output by
  default — so content is on-brand without being @mentioned. Distinct from a Brandmark (a specific
  @mentionable reference asset). _Avoid:_ **design system** (that names Fikirtive's own app UI
  library, not a merchant's identity), brand guidelines (informal), theme, style guide.

- **Project** (项目) — A unit of work under a Brand (a campaign or a video effort); contains many
  Chats and one shared Canvas. _Avoid:_ workspace, folder, brand, Campaign (the future marketing
  Campaign object is separate).

## References & identity 参考与身份

- **Entity** (实体) — A reusable cast member that recurs across shots: a Character, Location,
  Product, or Brandmark. Owner-scoped, not project-scoped (the same Entity appears in many
  projects). _Avoid:_ asset, reference, character (CHARACTER is one *type* of Entity, not a synonym).

- **Element** (元素) — The **user-facing UI label for an Entity**. Same thing; the screen says
  "Elements", the code says "Entity". Keep this mapping 1:1 — never invent a third word.
  _Avoid:_ using "Element" in code, or "Entity" in UI copy.

- **EntityType** (实体类型) — The fixed kind of an Entity: CHARACTER / LOCATION / PRODUCT / BRANDMARK.
  _Avoid:_ category, role, and **BRAND** — "Brand" now names the tenancy tier (see Tenancy &
  customer), so the creative-reference type for a brand's visual identity is **BRANDMARK**.

- **Brandmark** (品牌标记 / BRANDMARK) — The EntityType for a brand's *referenceable visual identity*
  (logo / wordmark / signature look) that you @mention into a specific generation. A creative cast
  member, sibling to Character/Product — NOT the tenancy Brand, and NOT the always-on Brand Kit.
  _Avoid:_ brand (that's the tenant), logo (too narrow).

- **Reference image** (参考图 / ref) — A picture attached to an Entity that defines its look; the
  model is *conditioned* on these to keep identity consistent. _Avoid:_ sample, example, training image.

- **Base** (基图 / locked base) — The single locked canonical image of an Entity — its identity
  anchor. Variants are generated *from* the base. A base-level reference has no variant tag.
  _Avoid:_ main image, default, master, cover.

- **Variant** (变体 / EntityVariant) — A named look/outfit/angle of an Entity (e.g. "red dress"),
  generated from the base by image-to-image. Has its own name + handle. _Avoid:_ version, alt, option, style.

- **@mention** (@提及) — Putting an Entity into a prompt by name ("@Anna"). At spend time it
  resolves server-side to that Entity's reference images — the client never sends image URLs.
  _Avoid:_ tag, chip (a chip is the *UI widget* for a mention), link, attach.

- **variantSel** (变体选择) — The map saying which Variant each @mention uses this generation
  ({ entityId: variantId }). Absent → all mentions use the Entity's base. _Avoid:_ selection, overrides.

## Generation: the spend path 生成与花钱

- **Generation** (生成结果) — One produced media result (an image or a video clip) plus its
  immutable provenance snapshot. The *noun* — a finished output, stored as a row. _Avoid:_ output, render, result-as-row, gen (gen is the verb/process).

- **Candidate** (候选) — A Generation not yet attached to a Shot (it sits in the candidate strip,
  unassigned). Becomes attached when slotted into a Shot. _Avoid:_ draft, orphan, unsaved, staging.

- **Ad-pack** (广告包) — The wedge deliverable: a named, persisted grouping of on-brand,
  ready-to-publish ad creatives produced from one product in one Otto request. v1 = up to 4 short-form
  video variants (different hooks/angles), Brand Kit applied; later adds aspect ratios (9:16 / 1:1 /
  16:9), images, captions. Lives under a Project (one Project → many ad-packs); it **groups** the
  Generations it contains, it does not re-produce them. _Avoid:_ campaign (broader/external), ad set
  (a paid-platform term), pack (bare), batch (batch is the gen primitive, not the deliverable).

- **genRequest** (生成请求 / generation spend gate) — The typed request gate for a media-generation
  operation. It validates generation parameters and requires an `idempotencyKey`; reserve/settle and
  the credit ledger still enforce the money movement. It is not the only paid capability in the
  product: LLM turns, reference generation and other approved spend surfaces have their own current
  execution paths. _Avoid:_ generate (too vague), genJob, request.

- **startGen** (启动生成) — The server action that takes a validated genRequest, writes a GenJob row,
  and dispatches it to the worker. The *orchestrator*, not the gate and not the row. _Avoid:_ generate, runGen, dispatch.

- **GenJob** (生成任务) — The persisted job row tracking one generation through QUEUED → GENERATING →
  DONE/FAILED. The *unit of work*; the worker consumes it and produces Generation(s). _Avoid:_ job (ambiguous), task, gen, request.

- **Paid execution path** (付费执行路径) — Any current code path that can incur provider/API cost,
  including metered Otto LLM turns and approved media/reference/batch generation surfaces. There is
  no permanent fixed-count list in this glossary: discover the current paths from code, the generated
  Otto catalog, money tests and the credit ledger. Each path must preserve its applicable approval,
  idempotency and reserve→settle/refund contract. _Avoid:_ treating an old enumerated list as exhaustive.

- **idempotencyKey** (幂等键) — A required per-request key that guarantees a generation is charged at
  most once even on double-clicks, reloads, or retries. Cowork cards use an exactly-once-ever key;
  shot frames use a stable reusable key. _Avoid:_ dedupe key, request id, nonce, token.

- **spentUsd** (已花费金额) — The frozen record of dollars actually charged for a job, snapshotted
  when the paid provider call commits. Pure bookkeeping — it NEVER participates in any spend decision.
  _Avoid:_ price, estimate, cost (those are forecasts; spentUsd is the truth after the fact).

- **estimatedPriceUsd** (预估价格) — A display-only price shown on a proposal before the user commits.
  Re-derived at spend time; never trusted for charging. _Avoid:_ price, spentUsd, cost.

- **refgen / RefGenJob** (参考图生成) — Generating an Entity's reference images (base / refsheet /
  variant), as opposed to generating shot/scene media. A separate job type with its own queue.
  _Avoid:_ generation (refgen produces *references*, not a Generation result row).

## Otto: the agent Otto

- **Otto** (AI 营销操盘手) — The AI-marketer **agent persona** and the product's **main entry**: the
  merchant talks to Otto, and Otto **orchestrates the studio surfaces (GenSpace / Storyboard / Editor /
  ad-pack) as its tools**. A *thinking + acting* partner — it proposes and executes within hard spend
  caps. Otto's own LLM turns are metered paid execution; media/provider work remains a separate
  approved action through the applicable spend gate.
  Renamed from "Cowork". _Avoid:_ Cowork (old name), Planner (the LLM *inside* an Otto turn),
  assistant, copilot, bot, AI.

- **Otto turn** (一轮对话 / ottoTurn) — One round of the agent: it reads the conversation, may
  call the Planner LLM, and replies — possibly with a proposal card. A real-model turn can incur API
  cost and therefore runs through LLM budget reserve→settle; it does not by itself authorize a
  separate media-generation provider call.
  Renamed from "Cowork turn / coworkTurn". _Avoid:_ generate, run, request.

- **ottoGenerate** (点击生成) — What runs when the user clicks **Generate** on a proposal card. This
  is a media-generation spend path: it re-derives the request and calls startGen. The agent proposing
  and the approved media execution are distinct. Renamed from "coworkGenerate". _Avoid:_ conflating
  the metered LLM turn with the separately approved media-generation action.

- **Generate card** (生成卡片 / GEN_CARD) — The proposal the agent shows in chat: a model + params +
  estimated price the user can edit and then Generate. Display-only until clicked. _Avoid:_ proposal
  (informal), gen card, suggestion.

- **Project Brief** (项目纲要 / coworkBrief→projectBrief) — The creative brief for ONE Project (this
  campaign/video): what to make and why, *this time*. The **project-level** context layer. It sits
  UNDER the Brand Brain — brand-constant things (voice, Brand Kit, catalog) live in the Brand Brain,
  NOT here, so the Project Brief stays light. **Otto's full context = Brand Brain + Project Brief +
  the conversation.** Human-authored; Otto may self-update it. Renamed from "coworkBrief". _Avoid:_
  Brand Brain (brand-level, not project-level), description, notes, prompt, summary.

- **Planner** (规划器) — The LLM call inside an Otto turn that produces the structured plan/proposal
  JSON. Otto is the persona/loop; the Planner is the model call it makes — two layers, never merged.
  Runtime/model selection is implementation state and must be verified from current code/config.
  _Avoid:_ model (ambiguous), AI, brain, Otto.

- **Guardian** (守门 / checkCast) — The server-side re-validation at spend time that re-checks every
  referenced Entity/Variant/source frame is still live and owned before money is committed. The money
  backstop behind a card. _Avoid:_ validator, guard, check.

## Studio surfaces 工作台界面

- **Studio** (工作台) — The overall app shell that hosts the surfaces below. _Avoid:_ editor, workspace, dashboard.

- **Canvas** (画布) — The Project-level visual board where the merchant arranges generated media,
  uploads, text notes, and Otto results. All Chats in a Project share the same Canvas. _Avoid:_
  per-chat canvas, generation library.

- **Canvas card** (画布卡片) — A placement on the Canvas that points at text or media. Removing a
  Canvas card removes the placement only; the saved media remains in the Library. _Avoid:_ asset,
  generation, library item.

- **Chat** (对话) — One Otto conversation inside a Project. A Project can have many Chats, and all
  of them share the Project Canvas. _Avoid:_ project, campaign.

- **GenSpace** (生成空间) — The free-form surface where the user directly generates images/clips from
  a prompt (a direct spend path). _Avoid:_ generator, canvas, playground.

- **Storyboard** (分镜) — The surface for laying out Shots and Scenes; can generate frames per shot.
  _Avoid:_ board, timeline (the timeline lives in the Editor), outline.

- **Editor** (剪辑器 / VideoEditor) — The video-editing surface (cut / trim / transitions / captions /
  audio) that produces a render. _Avoid:_ studio, timeline (the timeline is a *part* of the Editor).

## Editing & rendering 剪辑与渲染

- **Shot** (镜头) — One planned camera shot in a Storyboard, grouped into Scenes; can hold a
  first/last frame and generated media. _Avoid:_ clip (a clip is an editor timeline item), frame, scene.

- **FikirtiveEdit / editJson** (剪辑文档) — The single saved document describing a whole edit: the
  timeline (tracks + clips) plus output settings. The contract both the editor and the renderer obey.
  _Avoid:_ project (a Project *contains* one editJson), edit list, EDL, timeline (timeline is a field inside it).

- **Clip** (片段) — One media item placed on a timeline track (with trim, length, position). An
  editor concept — distinct from a Shot (planning) and a Generation (output). _Avoid:_ shot, segment, asset.

- **Ducking** (压低背景音 / auto-ducking) — Automatically lowering the music bed under any voice so
  dialogue stays audible. A music track is the bed; a voice track/native dialogue triggers the dip.
  _Avoid:_ mixing, fade, volume, sidechain (that's the mechanism, not the term).

- **NLE XML export** (剪辑软件导出) — Exporting the edit as an XML another non-linear editor (e.g.
  Premiere/DaVinci) can open — handing the cut off, not rendering it here. _Avoid:_ render, export (bare), download.

## Storage 资产存储

- **Asset** (资产) — The content-addressed stored bytes of any media file (image/video/audio),
  deduplicated by content hash. The *file*; a Generation/ReferenceImage *points at* an Asset.
  _Avoid:_ file, media, generation, image (those are roles an Asset plays, not the Asset itself).

- **Library** (资产库) — The owner-global saved collection of reusable Elements, products, and
  generated media across all Projects. Deleting from the Library explicitly removes the saved item
  from Library views; deleting a Canvas card does not. _Avoid:_ My Stuff, project library.
