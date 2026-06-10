# Artlio Product Requirements Document

Status: Draft v1  
Date: 2026-06-09  
Primary wedge: Agency and brand campaign production  
Expansion path: AI short film and series production  

## How To Use This PRD

This PRD is the master product map. Use it to align on what Artlio is, what the first commercial wedge is, how the AI system should work, how the data model should be structured, and how the product should be built phase by phase.

For execution, treat the document in this order:

1. Confirm the open questions in Section 20.
2. Use Section 12 to create the first database migration plan.
3. Use Section 11 to define the first Copilot skills, tools, and workflow runs.
4. Use Section 18 to plan the build phases.
5. Use Section 21 as the first vertical-slice implementation path.

## Table Of Contents

- [1. Executive Summary](#1-executive-summary)
- [2. Product Thesis](#2-product-thesis)
- [3. Research-Informed Direction](#3-research-informed-direction)
- [4. Target Users](#4-target-users)
- [5. Positioning](#5-positioning)
- [6. Product Principles](#6-product-principles)
- [7. Scope](#7-scope)
- [8. Core User Journey](#8-core-user-journey)
- [9. Information Architecture](#9-information-architecture)
- [10. Functional Requirements](#10-functional-requirements)
- [11. AI Product Architecture](#11-ai-product-architecture)
- [12. Data Architecture](#12-data-architecture)
- [13. Technical Architecture](#13-technical-architecture)
- [14. UX Requirements](#14-ux-requirements)
- [15. Non-Functional Requirements](#15-non-functional-requirements)
- [16. Success Metrics](#16-success-metrics)
- [17. Pricing Direction](#17-pricing-direction)
- [18. Roadmap](#18-roadmap)
- [19. Risks and Mitigations](#19-risks-and-mitigations)
- [20. Open Questions](#20-open-questions)
- [21. Recommended Immediate Next Steps](#21-recommended-immediate-next-steps)
- [22. Source Notes](#22-source-notes)

## 1. Executive Summary

Artlio is an agentic AI production studio that helps agencies, creators, and freelancers turn a brand brief or story idea into professional-grade videos through guided briefs, campaign concepts, storyboards, reusable assets, generation history, and an easy timeline editor.

Artlio should not be positioned as another prompt box. Its core product promise is:

> Artlio makes professional AI video production feel like directing with a creative team, not fighting with a prompt box.

The first commercial wedge is agency and brand campaign production. The product should help users create client-ready campaign video packs: product launch ads, brand promos, social variants, UGC-style spots, trailers, and short campaign sequences. The architecture must also support later expansion into AI short films and serialized storytelling.

The first product should optimize for:

- Simple onboarding for non-technical creative users.
- Structured campaign creation from brief to storyboard to generated shots.
- A friendly AI Copilot that can ask questions, propose concepts, create storyboards, compile prompts, route model calls, and preserve history.
- Professional-grade asset, brand, generation, and timeline management underneath.
- Guided autonomy, not uncontrolled full autonomy.

## 2. Product Thesis

Current AI generation tools are powerful but fragmented and hard to learn. Users often need to understand model selection, prompt engineering, aspect ratios, references, motion language, seed behavior, credit costs, output comparison, and editing workflows. Agencies and freelancers then still need to organize generations, present options to clients, revise outputs, and assemble final deliverables.

Artlio should simplify the workflow by wrapping complex AI production in a structured studio:

```text
Brief -> Concepts -> Storyboard -> Shots -> Generations -> Gallery -> Timeline -> Client Review -> Export
```

The user should experience the product as:

```text
Chat + storyboard + gallery + timeline
```

The system should store the production as:

```text
clients, brand kits, briefs, concepts, scenes, shots, assets, prompts, model calls,
generation outputs, timelines, approvals, comments, credits, and versions
```

This is the foundation for making Artlio easy to use without making it shallow.

## 3. Research-Informed Direction

This PRD is based on current market and AI architecture research as of 2026-06-09.

### 3.1 Market Signals

Higgsfield validates the idea that users describe creative outcomes, while video models require structured cinematic instructions. Their published architecture uses a "cinematic logic layer" to translate user intent into concrete video plans before generation.

Artlist validates the all-in-one creative ecosystem direction: AI video, image, music, voice, stock assets, licensing, and a chat-based agent mode that selects models and settings for users.

Venice validates the agentic chat pattern: one conversational interface that breaks work into steps, selects tools, and handles text, images, video, search, and files in one flow.

CapCut validates beginner-friendly storyboard and editing workflows: script-to-storyboard, automatic scene and shot breakdown, captions, music, and export.

Recent research on video production agents warns that fully autonomous agents are still weak at real-world post-production tasks, so Artlio should use guided autonomy with human approval. Research on continuity-aware storyboarding confirms the importance of explicit character, location, background, prop, and scene continuity structures for longer-form storytelling.

### 3.2 AI Architecture Signals

Best practice is not to start with many autonomous agents. The recommended pattern is:

```text
One visible Copilot
+ versioned skills
+ deterministic tools
+ workflow engine
+ human approval gates
+ observability and evals
```

Use agent behavior where the task is ambiguous and multi-step. Use deterministic workflows where the path is known. Use tools for product actions. Use skills for reusable procedures.

## 4. Target Users

### 4.1 Primary User: Agency Creative Producer

Profile:

- Works at a small or mid-sized creative agency.
- Produces client campaigns, social assets, launch videos, and concept decks.
- Needs fast iteration and client-ready polish.
- May not be a prompt engineering expert.

Jobs to be done:

- Turn a client brief into several strong campaign directions.
- Generate storyboards and visual concepts quickly.
- Produce multiple ad variants without hiring a full production crew.
- Keep work organized by client, campaign, version, and approval state.
- Present polished options to clients.

Pain points:

- AI tools are scattered across multiple apps.
- Output history is messy.
- It is hard to keep brand consistency.
- Prompting is too technical.
- Revisions are painful.
- Client review is disconnected from generation history.

### 4.2 Secondary User: Freelance Creator / Video Producer

Profile:

- Solo freelancer or small creative studio.
- Produces videos for brands, founders, products, and social campaigns.
- Needs speed, professionalism, and reuse of winning workflows.

Jobs to be done:

- Pitch campaign concepts.
- Generate draft videos and storyboards.
- Build repeatable production templates.
- Deliver final assets in multiple ratios.

### 4.3 Secondary User: Brand Marketer

Profile:

- In-house marketer at a startup, ecommerce brand, or SMB.
- Needs campaign videos but lacks video production resources.

Jobs to be done:

- Create product launch videos.
- Generate ad variants for paid social.
- Maintain brand voice and visual consistency.
- Review and approve work from internal or external creators.

### 4.4 Future User: AI Film / Series Creator

Profile:

- Filmmaker, storyteller, animator, or IP creator.
- Wants to create short films, trailers, episodes, or serialized stories.

Jobs to be done:

- Maintain story, character, location, and visual continuity.
- Generate scenes and shots across episodes.
- Assemble longer narrative timelines.
- Build a reusable story bible.

This user is not the Phase 1 commercial wedge, but the architecture must support them later.

## 5. Positioning

### 5.1 Category

Agentic AI production studio for campaign videos and cinematic content.

### 5.2 Primary Positioning Statement

Artlio helps agencies and freelancers turn brand briefs into client-ready campaign videos using an AI Copilot, guided storyboards, reusable assets, generation history, and an easy editing timeline.

### 5.3 Short Tagline Options

- The AI production studio for client-ready video campaigns.
- From brief to campaign video, with an AI creative team.
- Professional AI video production without the prompt-engineering headache.
- Storyboard, generate, revise, and deliver in one AI studio.

### 5.4 Differentiation

Artlio should differentiate from general AI video generators by focusing on production workflow, not only generation quality.

Key differentiators:

- Structured brief-to-storyboard workflow.
- Brand-aware campaign creation.
- One Copilot that operates on project objects, not just chat text.
- Generation history tied to scenes, shots, and timeline clips.
- Client review and approval built into the production flow.
- Architecture ready for characters, locations, continuity, and series.

## 6. Product Principles

1. Simple interface, professional structure underneath.
2. Guided autonomy beats black-box autonomy.
3. Every generation must be traceable.
4. The storyboard is the source of creative truth.
5. Creative intent and generated output must be separate records.
6. Human approval is required before expensive, destructive, or client-facing actions.
7. Model providers are replaceable; Artlio workflow and memory are the product moat.
8. Agencies need organization, reuse, review, and export as much as generation.
9. Film and series support should grow from the same object model, not a separate product.

## 7. Scope

### 7.1 Phase 1 MVP Scope

Phase 1 should prove that Artlio can turn a client or brand brief into organized campaign assets.

Included:

- Account, organization, and workspace setup.
- Client and brand kit creation.
- Project creation for campaign videos.
- AI Copilot for brief intake and clarification.
- Campaign concept generation.
- Storyboard generation.
- Scene and shot planning.
- Prompt compilation for image/video generation.
- Model registry and provider abstraction.
- Async generation queue.
- Generation history.
- Asset gallery.
- Basic approval gates for credit-spending actions.
- Basic share/review link for outputs or storyboard.
- Usage and credit ledger.

Not included in Phase 1:

- Full professional nonlinear timeline editor.
- Advanced audio mixing.
- Real-time multiplayer editing.
- Full client portal.
- Fully autonomous end-to-end video creation.
- Native mobile app.
- First-class series/episode/story bible objects.

### 7.2 Phase 2 Scope

Phase 2 should make Artlio usable as a lightweight studio.

Included:

- Timeline assembly.
- Timeline tracks and clips.
- Captions and text overlays.
- Music/SFX suggestions.
- Export presets for 9:16, 1:1, 16:9.
- Client comments and approvals.
- Campaign variant generation.
- Reusable workflow templates.
- Brand Guardian checks.
- Generation QA scoring.

### 7.3 Phase 3 Scope

Phase 3 should deepen collaboration and professional workflows.

Included:

- Team roles and permissions.
- Client reviewer role.
- Review rooms.
- Presentation-ready campaign boards.
- Advanced asset versioning.
- Batch generation.
- More detailed cost controls.
- Provider/model performance analytics.
- Organization-level templates.

### 7.4 Phase 4 Scope

Phase 4 should expand into cinematic and serialized storytelling.

Included:

- Characters.
- Locations.
- Story bibles.
- Episodes.
- Continuity rules.
- Continuity checks.
- Scene-to-scene consistency tooling.
- Longer narrative timelines.

## 8. Core User Journey

### 8.1 Agency Campaign Journey

1. User creates an organization or joins an agency workspace.
2. User creates or selects a client.
3. User creates a brand kit with logo, tone, colors, audience, references, and restrictions.
4. User starts a new project.
5. User chooses project type: Product Launch Video, Paid Social Ad Pack, Brand Promo, UGC Variant Pack, Trailer, or Custom Campaign.
6. Copilot asks for missing brief details.
7. Copilot proposes 3 campaign concepts.
8. User selects or edits a concept.
9. Copilot generates a storyboard.
10. User edits scenes and shots.
11. Copilot compiles model-ready prompts and recommends generation settings.
12. System quotes credit cost.
13. User approves generation.
14. Worker queues image/video jobs.
15. Outputs land in generation history and asset gallery.
16. User selects preferred outputs.
17. User assembles or auto-drafts a timeline.
18. User creates variants by aspect ratio, hook, audience, or platform.
19. User shares storyboard or outputs for client review.
20. User revises and exports final deliverables.

### 8.2 Future Series Journey

1. User creates a series project.
2. User defines a story bible.
3. User creates characters, locations, and continuity rules.
4. User creates episodes and scenes.
5. Copilot creates storyboards and shot plans.
6. Continuity Keeper checks every scene and generation.
7. User assembles episode timelines.
8. User exports episodes, trailers, and social promos.

## 9. Information Architecture

Primary navigation:

- Home
- Projects
- Clients
- Assets
- Templates
- Generation History
- Billing
- Settings

Project-level navigation:

- Overview
- Brief
- Concepts
- Storyboard
- Studio
- Gallery
- History
- Review
- Exports

Studio layout:

```text
Left panel: Project objects, scenes, shots, assets
Center: Storyboard or timeline canvas
Right panel: Copilot, properties, generation settings, history
Bottom: Timeline or generation queue
```

The UI should feel like an optimized professional tool, but not intimidating. It should borrow ease-of-use patterns from CapCut while keeping agency workflow structure closer to Figma/Notion/Frame.io style collaboration.

## 10. Functional Requirements

### 10.1 Authentication and Workspaces

Requirements:

- Users can sign up, log in, log out, and reset password.
- Users can create or join an organization.
- Organizations can contain multiple users.
- Users can have roles: owner, admin, producer, editor, reviewer.
- Workspaces must support future billing and permissions.

Acceptance criteria:

- A new user can create an organization in under 2 minutes.
- An organization owner can invite a team member.
- User permissions determine access to projects and billing.

### 10.2 Clients

Requirements:

- Users can create clients under an organization.
- Each client can have brand kits, projects, assets, and review links.
- Client records should support future external reviewer accounts.

Client fields:

- Name
- Industry
- Website
- Description
- Target audience
- Default brand kit
- Notes

Acceptance criteria:

- A producer can create a client and attach a brand kit.
- Projects can be filtered by client.

### 10.3 Brand Kits

Requirements:

- Users can create reusable brand kits.
- Brand kits must influence Copilot, concepts, storyboards, prompts, and Brand Guardian checks.

Brand kit fields:

- Brand name
- Positioning
- Audience
- Tone of voice
- Visual style
- Color palette
- Logo assets
- Product images
- Reference images/videos
- Approved phrases
- Restricted phrases
- Legal/compliance notes
- Competitors
- Do/don't rules

Acceptance criteria:

- Copilot can summarize a brand kit.
- Prompt Compiler can include brand kit details in generation prompts.
- Brand Guardian can flag obvious violations.

### 10.4 Projects

Requirements:

- Users can create projects under a client.
- Project types should guide default workflow templates.

Initial project types:

- Product Launch Video
- Paid Social Ad Pack
- Brand Promo
- UGC Variant Pack
- Explainer Video
- Trailer / Teaser
- Custom Campaign

Future project types:

- Short Film
- Series
- Episode
- Music Video
- Game Cutscene

Project fields:

- Title
- Client
- Brand kit
- Type
- Objective
- Platforms
- Aspect ratios
- Duration target
- Audience
- Status
- Due date

Acceptance criteria:

- User can start a project from a template.
- Copilot uses project type to ask relevant questions.

### 10.5 Brief Intake

Requirements:

- Copilot should turn incomplete user input into a structured brief.
- Copilot should ask only high-value missing questions.
- Users can edit the brief manually.

Brief fields:

- Campaign goal
- Product/service
- Target audience
- Key message
- Offer
- CTA
- Platforms
- Tone
- Visual references
- Must include
- Must avoid
- Duration
- Aspect ratios
- Deliverables
- Deadline

Acceptance criteria:

- User can paste a messy client brief and receive a structured brief.
- Copilot identifies missing fields.
- Brief can be approved before concept generation.

### 10.6 Campaign Concepts

Requirements:

- Copilot can generate multiple campaign concepts from a brief.
- Concepts must be structured and comparable.
- User can approve, reject, merge, or edit concepts.

Concept fields:

- Title
- One-line idea
- Audience angle
- Hook
- Emotional tone
- Visual direction
- Story arc
- CTA
- Risks
- Recommended formats

Acceptance criteria:

- Copilot generates 3 distinct concepts.
- User can select one concept as the active direction.
- Concept history is preserved.

### 10.7 Storyboard

Requirements:

- Storyboard is the creative source of truth.
- Storyboards contain scenes.
- Scenes contain shots.
- Users can reorder scenes and shots.
- Copilot can generate and revise storyboards.

Storyboard fields:

- Title
- Concept
- Duration target
- Aspect ratio target
- Narrative structure
- Status

Scene fields:

- Scene number
- Purpose
- Setting
- Action
- Message
- Duration estimate
- Mood
- Notes

Shot fields:

- Shot number
- Scene
- Shot type
- Subject
- Camera direction
- Motion
- Lighting
- Composition
- Dialogue/VO
- On-screen text
- Audio notes
- Visual references
- Prompt draft
- Negative prompt draft
- Status

Acceptance criteria:

- Copilot can convert a concept into a storyboard.
- User can edit each scene and shot.
- Each generation can be linked back to a shot.

### 10.8 Prompt Compiler

Requirements:

- Prompt Compiler converts friendly shot intent into provider-specific generation prompts.
- It should not expose raw complexity by default.
- Advanced users can inspect and edit prompts.

Inputs:

- Brand kit
- Project brief
- Concept
- Scene
- Shot
- Selected assets
- Model requirements
- Platform format

Outputs:

- Positive prompt
- Negative prompt
- Model-specific parameters
- Reference asset list
- Aspect ratio
- Duration
- Resolution
- Estimated cost

Acceptance criteria:

- Same shot can be compiled for different models.
- Prompt versions are stored.
- User can regenerate with a modified prompt without losing previous outputs.

### 10.9 Model Router

Requirements:

- Artlio must abstract AI providers behind a model registry.
- Product logic must not hard-code provider-specific APIs.
- The system should select models based on task, cost, quality, capability, and user plan.

Model registry fields:

- Provider
- Model ID
- Modality
- Capabilities
- Max duration
- Max resolution
- Supports audio
- Supports image reference
- Supports video reference
- Supports end frame
- Supports multiple references
- Cost rules
- Latency estimate
- Availability
- Safety restrictions

Acceptance criteria:

- Admin can add or disable a model without code changes to core product flows.
- User sees understandable recommendations, not raw model complexity.

### 10.10 Generation Queue

Requirements:

- Media generation must be asynchronous.
- Queue jobs must persist provider IDs and status.
- User can continue working while jobs run.
- Failed jobs must be recoverable and explainable.

Generation statuses:

- draft
- quoted
- pending_approval
- queued
- running
- completed
- failed
- cancelled

Acceptance criteria:

- User approves credit spend before paid generation.
- System stores provider queue ID.
- System polls provider result.
- System saves final media to Artlio storage.
- System logs cost and usage.

### 10.11 Generation History

Requirements:

- Every generation attempt must be visible and recoverable.
- Users can compare variants.
- History should be filterable by project, shot, model, date, status, and creator.

History item should show:

- Thumbnail
- Prompt summary
- Model
- Status
- Cost
- Created by
- Linked shot
- Input references
- Output file
- Actions: save to assets, add to timeline, regenerate, compare, download

Acceptance criteria:

- No completed generation is lost.
- User can trace output back to prompt and source shot.

### 10.12 Asset Gallery

Requirements:

- Users can save and reuse generated or uploaded assets.
- Assets must support versions.
- Assets must support metadata useful for AI generation.

Asset types:

- Product
- Logo
- Brand reference
- Character
- Location
- Style reference
- Image
- Video
- Audio
- Music
- Voice
- Text
- Template

Acceptance criteria:

- User can upload product images.
- User can save a generation as an asset.
- User can attach assets to shots.
- Future character/location support can reuse the asset model.

### 10.13 Studio Timeline

Requirements:

- Phase 1 can have a lightweight assembly view.
- Phase 2 should include a timeline editor.
- Timeline clips should link to generation outputs or uploaded assets.

Timeline tracks:

- Video
- Image
- Text
- Voiceover
- Music
- SFX
- Captions

Clip fields:

- Track
- Source asset/output
- Start time
- End time
- In point
- Out point
- Transform
- Crop
- Caption text
- Effects
- Transition

Acceptance criteria:

- User can add selected outputs to timeline.
- User can reorder clips.
- User can export a draft.

### 10.14 Client Review

Requirements:

- Users can share a storyboard, gallery, timeline draft, or export with clients.
- Clients can comment and approve without full workspace access.

Review states:

- draft
- shared
- commented
- approved
- rejected
- archived

Acceptance criteria:

- User can create a share link.
- Viewer can leave comments.
- Approval is stored and auditable.

### 10.15 Exports

Requirements:

- Users can export video files and asset packs.
- Export presets should map to social and campaign needs.

Export presets:

- TikTok/Reels/Shorts 9:16
- Instagram square 1:1
- YouTube/Web 16:9
- Storyboard PDF
- Client review board
- Asset pack ZIP

Acceptance criteria:

- Export request runs asynchronously.
- Final export is downloadable.
- Export is tied to project and usage history.

### 10.16 Billing and Credits

Requirements:

- Every paid generation or export must create usage and ledger records.
- Users should understand cost before spending credits.
- Credits should be organization-scoped by default.

Credit ledger event types:

- credit_purchase
- subscription_grant
- generation_hold
- generation_charge
- generation_refund
- manual_adjustment
- expiration

Acceptance criteria:

- User sees estimated credit cost before generation.
- Completed generation deducts credits.
- Failed eligible generation refunds or releases hold.
- Admin can inspect usage by organization, project, user, model, and date.

## 11. AI Product Architecture

### 11.1 Recommended Pattern

Artlio should not start with many separate autonomous agents. It should start with one visible Copilot using skills, tools, workflows, and approval gates.

```text
User
  -> Artlio Copilot
    -> Skill selection
      -> Workflow execution
        -> Tool calls
          -> Database, model providers, storage, queue, renderer
```

The user experiences one assistant. Internally, the system uses specialized procedures.

### 11.2 Definitions

Copilot:

- The user-facing AI assistant.
- Conversational, contextual, and project-aware.
- Can propose and execute structured actions with approval.

Skill:

- A reusable procedure or playbook.
- Examples: Brief Intake, Storyboard Creation, Prompt Compilation.
- Versioned and testable.

Tool:

- A deterministic executable action.
- Examples: create_storyboard, queue_video_generation, save_asset.
- Validated by schema and permission rules.

Workflow:

- A multi-step path combining skills and tools.
- Can be deterministic, semi-agentic, or approval-gated.

Agent:

- The reasoning loop that selects skills/tools and handles ambiguous multi-step tasks.
- Should be constrained by product state, tool schemas, and approval gates.

### 11.3 Initial Skills

Brief Intake Skill:

- Converts messy input into a structured brief.
- Asks only necessary follow-up questions.

Campaign Strategy Skill:

- Creates campaign angles and concepts.
- Optimizes for agency/client-ready positioning.

Storyboard Skill:

- Converts concept/script into scenes and shots.
- Defines camera, pacing, subject, and message.

Shot Planning Skill:

- Enriches shots with visual direction, references, audio, and timing.

Prompt Compiler Skill:

- Converts shot intent into model-ready prompts.
- Handles provider-specific constraints.

Model Router Skill:

- Chooses suitable models based on modality, quality, cost, duration, references, and plan.

Brand Guardian Skill:

- Checks outputs and prompts against brand kit.
- Flags tone, visual, legal, and restriction issues.

Generation QA Skill:

- Reviews generated outputs against shot intent.
- Produces structured notes and retry suggestions.

Timeline Assembly Skill:

- Suggests clip order, pacing, captions, music, and variants.

Client Review Pack Skill:

- Packages selected concepts, storyboards, outputs, or exports for client review.

Continuity Keeper Skill:

- Phase 1: lightweight checks on products, brand style, and references.
- Later: character, location, prop, wardrobe, and episode continuity.

### 11.4 Initial Tools

Project tools:

```text
create_project
update_project
get_project_context
```

Client and brand tools:

```text
create_client
update_client
create_brand_kit
update_brand_kit
search_brand_assets
```

Brief and concept tools:

```text
create_brief
update_brief
create_concept
update_concept
select_concept
```

Storyboard tools:

```text
create_storyboard
update_storyboard
create_scene
update_scene
reorder_scenes
create_shot
update_shot
reorder_shots
```

Generation tools:

```text
compile_prompt
quote_generation_cost
request_generation_approval
queue_image_generation
queue_video_generation
poll_generation_status
cancel_generation
save_generation_output
compare_generation_outputs
```

Asset tools:

```text
upload_asset
save_asset
create_asset_version
attach_asset_to_shot
search_assets
```

Timeline tools:

```text
create_timeline
add_timeline_clip
update_timeline_clip
reorder_timeline_clips
render_export
```

Review tools:

```text
create_share_link
add_comment
request_approval
record_approval
```

Billing and audit tools:

```text
log_usage_event
create_credit_hold
settle_credit_charge
release_credit_hold
write_audit_log
```

### 11.5 Human Approval Gates

Approval is required before:

- Spending credits above a configurable threshold.
- Running batch generation.
- Sending or sharing client-facing work.
- Deleting assets or generations.
- Applying bulk timeline changes.
- Publishing/exporting final deliverables.

Approval should be optional or automatic for:

- Drafting concepts.
- Drafting storyboards.
- Compiling prompts.
- Suggesting edits.
- Creating non-destructive local versions.

### 11.6 AI Memory and Context

Artlio should not rely on raw chat history as memory. It should use structured project context.

Context layers:

- Organization context
- Client context
- Brand kit context
- Project brief
- Active concept
- Storyboard
- Scene and shot records
- Attached assets
- Generation history
- Timeline state
- User preferences

Copilot should retrieve only relevant context for each action.

### 11.7 Observability and Evaluation

Every AI run should log:

- User request
- Skill used
- Tools called
- Model used
- Input context IDs
- Output object IDs
- Cost estimate
- Actual cost
- Latency
- Errors
- Human approval state

Evaluation should cover:

- Brief structuring quality.
- Concept usefulness.
- Storyboard completeness.
- Prompt quality.
- Brand consistency.
- Generation output match.
- Cost prediction accuracy.
- Tool-call reliability.

## 12. Data Architecture

### 12.1 Database Recommendation

Use PostgreSQL for core product data.

Recommended default stack:

- PostgreSQL for relational data.
- Object storage for images, videos, audio, thumbnails, and exports.
- Redis or managed queue for jobs.
- Search index later for asset/project search.
- Vector search later for semantic asset and prompt retrieval.

Avoid:

- Storing media blobs in Postgres.
- Treating chat history as the primary product state.
- Using JSONB for core relationships that need querying and permissions.

### 12.2 Core Data Model

The most important modeling rule:

```text
Creative intent is separate from generated output.
```

Example:

```text
shot = planned creative instruction
generation = one AI attempt to fulfill that shot
generation_output = resulting media file
timeline_clip = selected output placed in an edit
```

This enables regeneration, comparison, rollback, client review, and future continuity checks.

### 12.3 Key Tables

organizations:

- id
- name
- slug
- plan
- billing_customer_id
- created_at
- updated_at

users:

- id
- email
- name
- avatar_url
- created_at
- updated_at

memberships:

- id
- organization_id
- user_id
- role
- status
- invited_by_user_id
- created_at
- updated_at

clients:

- id
- organization_id
- name
- industry
- website
- description
- target_audience
- default_brand_kit_id
- created_by_user_id
- created_at
- updated_at

brand_kits:

- id
- organization_id
- client_id
- name
- positioning
- audience
- tone_of_voice
- visual_style
- color_palette_json
- typography_json
- approved_phrases_json
- restricted_phrases_json
- legal_notes
- created_at
- updated_at

projects:

- id
- organization_id
- client_id
- brand_kit_id
- title
- type
- objective
- platforms_json
- aspect_ratios_json
- duration_target_seconds
- status
- due_date
- created_by_user_id
- created_at
- updated_at

briefs:

- id
- project_id
- goal
- product_or_service
- target_audience
- key_message
- offer
- call_to_action
- tone
- deliverables_json
- must_include_json
- must_avoid_json
- status
- created_at
- updated_at

concepts:

- id
- project_id
- brief_id
- title
- one_line_idea
- audience_angle
- hook
- emotional_tone
- visual_direction
- story_arc
- call_to_action
- risks
- status
- selected_at
- created_at
- updated_at

storyboards:

- id
- project_id
- concept_id
- title
- duration_target_seconds
- aspect_ratio
- narrative_structure
- status
- created_at
- updated_at

scenes:

- id
- storyboard_id
- position
- purpose
- setting
- action
- message
- duration_estimate_seconds
- mood
- notes
- created_at
- updated_at

shots:

- id
- scene_id
- position
- shot_type
- subject
- camera_direction
- motion
- lighting
- composition
- dialogue_or_voiceover
- on_screen_text
- audio_notes
- visual_reference_notes
- prompt_draft
- negative_prompt_draft
- status
- created_at
- updated_at

assets:

- id
- organization_id
- client_id
- project_id
- brand_kit_id
- type
- name
- description
- storage_url
- thumbnail_url
- mime_type
- metadata_json
- rights_status
- created_by_user_id
- created_at
- updated_at

asset_versions:

- id
- asset_id
- version_number
- storage_url
- thumbnail_url
- metadata_json
- created_by_user_id
- created_at

generations:

- id
- organization_id
- project_id
- shot_id
- requested_by_user_id
- status
- modality
- provider
- model_id
- prompt
- negative_prompt
- parameters_json
- cost_estimate_credits
- actual_cost_credits
- approval_request_id
- created_at
- updated_at
- completed_at

generation_inputs:

- id
- generation_id
- input_type
- asset_id
- storage_url
- role
- metadata_json
- created_at

generation_outputs:

- id
- generation_id
- asset_id
- storage_url
- thumbnail_url
- mime_type
- width
- height
- duration_seconds
- provider_output_id
- metadata_json
- created_at

model_invocations:

- id
- generation_id
- provider
- model_id
- request_payload_json
- response_payload_json
- provider_job_id
- status
- latency_ms
- error_code
- error_message
- created_at
- updated_at

timelines:

- id
- project_id
- name
- aspect_ratio
- duration_seconds
- status
- created_at
- updated_at

timeline_tracks:

- id
- timeline_id
- type
- position
- name
- muted
- locked
- created_at
- updated_at

timeline_clips:

- id
- timeline_track_id
- generation_output_id
- asset_id
- start_time_ms
- end_time_ms
- source_in_ms
- source_out_ms
- transform_json
- effects_json
- transition_json
- created_at
- updated_at

copilot_threads:

- id
- organization_id
- project_id
- user_id
- title
- status
- created_at
- updated_at

copilot_messages:

- id
- thread_id
- role
- content
- metadata_json
- created_at

agent_actions:

- id
- thread_id
- skill_version_id
- action_type
- target_object_type
- target_object_id
- summary
- status
- created_at

tool_calls:

- id
- agent_action_id
- tool_name
- arguments_json
- result_json
- status
- error_message
- created_at
- completed_at

skills:

- id
- name
- description
- category
- status
- created_at
- updated_at

skill_versions:

- id
- skill_id
- version
- instructions
- input_schema_json
- output_schema_json
- eval_suite_id
- status
- created_at

workflow_templates:

- id
- organization_id
- name
- description
- project_type
- steps_json
- status
- created_at
- updated_at

workflow_runs:

- id
- workflow_template_id
- project_id
- thread_id
- status
- started_by_user_id
- started_at
- completed_at

workflow_steps:

- id
- workflow_run_id
- position
- name
- skill_version_id
- status
- input_json
- output_json
- started_at
- completed_at

approval_requests:

- id
- organization_id
- project_id
- requested_by_user_id
- approver_user_id
- type
- title
- description
- payload_json
- status
- approved_at
- rejected_at
- created_at

comments:

- id
- organization_id
- project_id
- author_user_id
- target_object_type
- target_object_id
- body
- status
- created_at
- updated_at

share_links:

- id
- organization_id
- project_id
- target_object_type
- target_object_id
- token_hash
- permissions_json
- expires_at
- created_by_user_id
- created_at

usage_events:

- id
- organization_id
- project_id
- user_id
- event_type
- provider
- model_id
- quantity
- unit
- credits
- metadata_json
- created_at

credit_ledger:

- id
- organization_id
- event_type
- amount
- balance_after
- related_usage_event_id
- related_generation_id
- metadata_json
- created_at

audit_logs:

- id
- organization_id
- actor_user_id
- action
- target_object_type
- target_object_id
- metadata_json
- created_at

### 12.4 Future Film / Series Tables

These do not need to ship in Phase 1, but should influence naming and relationships.

series:

- id
- organization_id
- client_id
- title
- premise
- genre
- target_audience
- status

episodes:

- id
- series_id
- project_id
- episode_number
- title
- synopsis
- status

characters:

- id
- organization_id
- project_id
- series_id
- name
- description
- visual_identity
- voice_notes
- personality
- reference_asset_id
- metadata_json

locations:

- id
- organization_id
- project_id
- series_id
- name
- description
- visual_identity
- reference_asset_id
- metadata_json

continuity_rules:

- id
- organization_id
- project_id
- series_id
- rule_type
- description
- severity
- target_object_type
- target_object_id

story_bibles:

- id
- organization_id
- series_id
- project_id
- title
- content_json
- status

## 13. Technical Architecture

### 13.1 Default Stack Recommendation

Recommended default unless changed:

- Frontend: Next.js or Remix.
- UI: React, TypeScript, Tailwind, component library.
- Backend: Node.js/TypeScript API.
- Database: PostgreSQL.
- ORM: Prisma or Drizzle.
- Object storage: S3, Cloudflare R2, or Supabase Storage.
- Queue: BullMQ/Redis, Inngest, Trigger.dev, or managed cloud queue.
- Realtime: WebSockets or provider-specific realtime service for job progress.
- Auth: Clerk, Auth.js, Supabase Auth, or custom auth depending on business needs.
- Payments: Stripe.
- Video processing: FFmpeg workers.
- Observability: OpenTelemetry plus product event analytics.

The exact stack can be finalized before implementation. The non-negotiables are relational core data, async generation jobs, object storage, provider abstraction, and observability.

### 13.2 Backend Services

Core API service:

- Authenticated CRUD for organizations, clients, projects, brand kits, storyboards, assets, timelines.
- Permission checks.
- Copilot endpoints.
- Workflow endpoints.
- Billing endpoints.

AI orchestration service:

- Skill execution.
- Prompt compilation.
- Model routing.
- Tool call validation.
- Approval handling.
- AI traces and eval logging.

Worker service:

- Generation queue processing.
- Provider polling.
- Media download and storage.
- Thumbnail generation.
- Export rendering.
- Cleanup jobs.

Media service:

- Signed uploads.
- Signed downloads.
- Thumbnails.
- Transcoding.
- Asset metadata extraction.

### 13.3 Provider Abstraction

All model providers should implement a common interface:

```text
quote(input) -> cost estimate
queue(input) -> provider job ID
poll(job ID) -> status/result
cancel(job ID) -> cancellation result
normalize(result) -> Artlio generation output
```

Provider-specific data stays in:

- model_registry
- model_invocations
- parameters_json
- response_payload_json

Product objects should not depend on provider-specific fields.

### 13.4 Security and Permissions

Requirements:

- Organization-scoped data access.
- Role-based access control.
- Signed media URLs.
- Share links should be revocable.
- Client reviewers should see only shared objects.
- Audit logs for billing, sharing, deletion, and approval.
- Secrets stored only in environment/secret manager.
- Provider API keys never exposed to client.

### 13.5 Compliance and Safety

Requirements:

- Track source assets and rights status.
- Track generated output provenance.
- Store model/provider used for each generation.
- Add moderation hooks before generation and before sharing.
- Add brand/legal restriction checks for regulated clients.
- Provide deletion and retention controls.

## 14. UX Requirements

### 14.1 UX Personality

Artlio should feel:

- Professional.
- Clear.
- Calm.
- Fast to learn.
- Studio-like.
- Powerful under the surface.

It should not feel:

- Like a raw developer tool.
- Like a generic chatbot.
- Like a toy image generator.
- Like a complex traditional NLE.

### 14.2 Main Surfaces

Home:

- Recent projects.
- Active generations.
- Pending approvals.
- Quick start templates.

Project Overview:

- Brief summary.
- Active concept.
- Storyboard progress.
- Generation status.
- Review/export status.

Brief:

- Structured brief editor.
- Copilot questions.
- Missing field indicators.

Concepts:

- 3 or more concept cards.
- Compare, edit, merge, select.

Storyboard:

- Scene cards.
- Shot rows/cards.
- Camera, motion, text, audio, references.
- Generate buttons per shot or batch.

Studio:

- Storyboard/timeline canvas.
- Asset panel.
- Copilot panel.
- Generation queue.

Gallery:

- Outputs by shot, scene, model, status.
- Compare variants.
- Save to assets.
- Add to timeline.

History:

- Full generation and Copilot action log.

Review:

- Share selected storyboards, outputs, timelines, or exports.
- Client comments and approval.

### 14.3 Copilot UX

Copilot should:

- Show what it is about to do.
- Ask before spending credits.
- Explain model choices in plain language.
- Provide editable structured outputs.
- Link messages to project objects.
- Show tool progress when executing.
- Preserve action history.

Example Copilot behavior:

```text
I can turn this brief into 3 campaign concepts. I found two missing details:
1. Primary platform
2. Desired video length

Want me to assume TikTok/Reels and 15 seconds for the first draft?
```

### 14.4 Beginner-Friendly Controls

Use natural controls:

- Dropdowns for project types, platforms, models.
- Sliders for duration and creativity.
- Toggles for premium models and batch generation.
- Cards for concepts and outputs.
- Timeline clips for media arrangement.
- Side panels for properties.
- Inline edit for storyboard details.

## 15. Non-Functional Requirements

Performance:

- App shell loads in under 2.5 seconds on a typical broadband connection.
- Project pages should render useful skeletons while data loads.
- Generation status should update without manual refresh.

Reliability:

- Generation jobs must survive page refresh.
- Provider failures should not corrupt project state.
- Media download from providers should retry safely.

Scalability:

- Async workers must scale independently.
- Media storage must be externalized.
- Generation polling must not overload provider APIs.

Maintainability:

- Provider integrations are isolated.
- Skills are versioned.
- Tool schemas are validated.
- Workflow runs are auditable.

## 16. Success Metrics

Activation:

- Percent of new users who create a project.
- Percent who complete a structured brief.
- Percent who generate first concept.
- Percent who generate first storyboard.
- Percent who complete first media generation.

Core value:

- Time from brief to first storyboard.
- Time from brief to first usable video output.
- Number of accepted outputs per project.
- Regeneration rate per shot.
- Export completion rate.

Agency value:

- Projects per organization.
- Client share links created.
- Approval rate.
- Repeat project rate.
- Brand kit reuse rate.

AI quality:

- Concept approval rate.
- Storyboard edit distance after AI draft.
- Prompt-to-output match score.
- Brand Guardian pass rate.
- Generation QA pass rate.

Business:

- Free-to-paid conversion.
- Credits consumed per active organization.
- Gross margin per generation.
- Monthly retained organizations.
- Average revenue per organization.

## 17. Pricing Direction

Pricing should align with agency value and AI costs.

Possible plans:

Free:

- Limited projects.
- Limited credits.
- Watermarked exports.
- Basic models.

Creator:

- More credits.
- Personal projects.
- Standard export.
- Basic brand kit.

Pro:

- Client projects.
- More credits.
- Premium models.
- Generation history.
- Timeline exports.

Team/Agency:

- Multiple seats.
- Shared clients and brand kits.
- Review links.
- Approval flow.
- Team credits.
- Usage analytics.

Enterprise:

- Custom credits.
- Advanced permissions.
- Security review.
- Dedicated support.
- Custom provider/model policies.

## 18. Roadmap

### Phase 0: PRD and Design Foundation

Goal:

- Lock product requirements, architecture, database, and MVP scope.

Deliverables:

- Full PRD.
- Data model.
- AI skill/tool architecture.
- Initial UX map.
- Technical stack decision.
- Phase 1 build plan.

Exit criteria:

- Team agrees on wedge, MVP, schema direction, and Copilot architecture.

### Phase 1: Foundation MVP

Goal:

- Build the core campaign production data model and basic AI generation loop.

Deliverables:

- Auth and organizations.
- Clients.
- Brand kits.
- Projects.
- Briefs.
- Concepts.
- Storyboards.
- Scenes.
- Shots.
- Assets.
- Generations.
- Provider abstraction.
- Async generation queue.
- Generation history.
- Credit ledger.
- Basic Copilot.

Exit criteria:

- User can create a project, structure a brief, generate concepts, create a storyboard, generate media for a shot, and view history.

### Phase 2: Campaign Studio

Goal:

- Make the MVP feel like a usable production studio.

Deliverables:

- Gallery improvements.
- Basic timeline.
- Captions/text overlays.
- Export presets.
- Client review links.
- Comments.
- Approval flow.
- Brand Guardian.
- Generation QA.

Exit criteria:

- User can produce a client-reviewable campaign draft from a brief.

### Phase 3: Agency Workflow

Goal:

- Support teams, repeatable workflows, and paid usage.

Deliverables:

- Team permissions.
- Billing plans.
- Organization templates.
- Batch variants.
- Advanced review.
- Usage analytics.
- Workflow templates.

Exit criteria:

- Agency can manage multiple clients and campaigns with paid usage.

### Phase 4: Cinematic / Series Expansion

Goal:

- Expand from campaign production into AI short film and series production.

Deliverables:

- Story bibles.
- Characters.
- Locations.
- Episodes.
- Continuity rules.
- Continuity QA.
- Longer scene/timeline workflows.

Exit criteria:

- User can create a multi-scene narrative project with reusable characters, locations, and continuity checks.

## 19. Risks and Mitigations

Risk: AI video output quality is inconsistent.

Mitigation:

- Focus on workflow, history, variants, and revision.
- Support multiple providers.
- Add QA and comparison tools.

Risk: Fully autonomous agents perform poorly.

Mitigation:

- Use guided autonomy.
- Add human approval gates.
- Use deterministic workflows for known paths.

Risk: Costs become unpredictable.

Mitigation:

- Quote before generation.
- Track usage events and credit ledger.
- Use model router with cost-aware recommendations.

Risk: Users feel overwhelmed.

Mitigation:

- Hide advanced controls by default.
- Use templates and Copilot questions.
- Keep storyboard as the main organizing surface.

Risk: Brand consistency is hard.

Mitigation:

- Brand kits.
- Reference assets.
- Brand Guardian.
- Prompt Compiler.
- Generation QA.

Risk: Database becomes messy if we store only chat and outputs.

Mitigation:

- Store structured creative objects from day one.
- Separate intent, generation attempts, outputs, and timeline usage.

Risk: Provider lock-in.

Mitigation:

- Use model registry and provider adapters from day one.

## 20. Open Questions

Product:

- What is the first exact project template: Product Launch Video, Paid Social Ad Pack, or Brand Promo?
- Should the first export target be 9:16 social ads or multi-ratio campaign packs?
- Should client review be included in MVP or Phase 2?

AI:

- Which model providers should Phase 1 support first?
- Should Artlio start with image generation plus image-to-video, or direct text-to-video?
- What actions can Copilot auto-execute without approval?

Business:

- Should credits be prepaid, subscription-granted, or both?
- Should agency pricing charge by seat, credits, clients, or projects?

Technical:

- Should the first implementation use Supabase or a custom Postgres/backend setup?
- Should workflows be implemented in app code first or with a workflow engine like Inngest/Trigger.dev?
- Which object storage provider should be used?

UX:

- Should Artlio's primary workspace be storyboard-first, timeline-first, or hybrid?
- How much raw prompt editing should be exposed in Phase 1?
- Should Copilot live as a right panel, bottom command bar, or full chat workspace?

## 21. Recommended Immediate Next Steps

1. Choose the Phase 1 project template.
2. Choose the initial technical stack.
3. Create low-fidelity UX map for Home, Project Brief, Concepts, Storyboard, Gallery, and Copilot.
4. Convert the database model into migrations.
5. Define first 5 Copilot tools and first 3 skills.
6. Build a vertical slice:

```text
Create client -> create brand kit -> create project -> create brief ->
generate concepts -> generate storyboard -> queue one image/video generation ->
store output -> show generation history
```

## 22. Source Notes

Research references used for this PRD:

- OpenAI on Higgsfield: https://openai.com/index/higgsfield/
- Higgsfield Canvas: https://higgsfield.ai/canvas-intro
- Artlist AI ecosystem: https://artlist.io/?type=video
- Artlist AI Toolkit video generation: https://help.artlist.io/hc/en-us/articles/33161438828957-AI-Toolkit-Generating-AI-Videos/
- Venice Agentic Chat: https://venice.ai/es/blog/agentic-chat-is-now-live-on-venice
- Venice Video Generation API: https://docs.venice.ai/guides/media/video-generation
- CapCut AI Storyboard Generator: https://www.capcut.com/tools/ai-storyboard-generator
- Anthropic Building Effective Agents: https://www.anthropic.com/engineering/building-effective-agents
- Anthropic Writing Effective Tools for Agents: https://www.anthropic.com/engineering/writing-tools-for-agents
- OpenAI Agents SDK: https://developers.openai.com/api/docs/guides/agents
- OpenAI Practical Guide to Building Agents: https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- Model Context Protocol tools: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- AgenticVBench: https://arxiv.org/abs/2605.27705
- CANVAS continuity-aware storyboarding: https://arxiv.org/abs/2604.13452
- DreamShot storyboard synthesis: https://arxiv.org/abs/2604.17195
