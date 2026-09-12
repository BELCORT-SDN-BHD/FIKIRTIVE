# Playbook: multi-shot videos — laying out a storyboard and editing one
<!-- when: storyboard, scenes, scene, shots, sequence, multi-scene, short film, commercial, episode, series of, few scenes, 分镜, 脚本, 多个镜头, 几个场景 -->
<!-- 来源：本文原文逐字来自退役前的单体说明书 packages/otto/src/instructions.ts（同名小节），⑥段（docs/specs/otto-engine.md §7.2⑥）搬进文件柜时只改了插值 → 占位符。2026-09-09 起第 2 步按 Founder 裁决改写（规格 creation-engine.md §5「FSE-001 同族」行）：带 @演员的镜头不再先出首帧。2026-09-10（同表 :172⑤，v0.1.1）再改一格：@ 到**演员**的镜头连 `firstFramePrompt` 都不必写（判据与「直接出片」同一条：有没有 CHARACTER，由 `executeProposeStoryboard` 在落库前判），其余镜头（含只 @ 商品的）两步逐字不变。2026-09-12（FSE-208，S5 批量裁决 #1358）：「合成 first frame」这个概念本身全退场——不再有任何一档镜头走两步，@ 演员的规则随之作废，下文整段改写为「所有镜头都直接出片」。 -->
## When to call `proposeStoryboard` (multi-shot videos / ads)

When the user wants a video or ad that is a SEQUENCE of shots — a short film, a multi-scene ad, "a video with a few scenes", a storyboard — do NOT fire a single `propose`. Lay out a storyboard instead:

1. First understand intent (刨根问底) and confirm the goal — `proposeStoryboard` requires a `goal` and returns `needMoreInfo` without one.
2. For EACH shot, build its `videoPrompt` with **seedancePrompt** (never hand-write it) — supply the craft yourself (subject, camera move, lighting, composition) from the goal and brand context. Every shot is made in ONE paid step, straight into a clip — there is no opening-still step for any shot, whether or not it @mentions a cast member.
   For a shot that features an @-referenced entity, pass that entity in seedancePrompt's `references` (role + name) for the identity-lock phrasing, AND include that entity's id in the shot's `entityIds` — that is how the reference photo will actually reach the model. Phrasing alone locks the words but not the face; without `entityIds` the character will drift.
3. Call **`proposeStoryboard`** with `storyboardTitle`, `goal`, and the ordered `shots` (each: `videoPrompt`, optional `title`, optional `entityIds`). This lays out an ordered STORYBOARD_CARD the user can review and edit shot-by-shot.

**`proposeStoryboard` spends nothing** — it only lays out the plan; no credits are charged. The user reviews and edits first; the videos are made later as a separate, explicitly-approved step. Say so plainly — never imply the storyboard itself generated or charged anything, and never describe an opening-still step for any shot.

Use a single `propose` (not a storyboard) for a one-off image or a single short clip. Use `proposeStoryboard` only when there are genuinely multiple ordered shots.

Boundary — beats vs clips: several beats WITHIN one continuous short clip (seedancePrompt supports up to 4 shots-as-beats in a single clip) → still ONE `propose`, not a storyboard. Reach for `proposeStoryboard` only when the output is SEPARATE clips the user reviews and edits individually.

## When to call `editStoryboard`

Call **`editStoryboard`** to change an EXISTING storyboard card the user is reviewing — it is $0 and never spends credits. Pass the `cardId` of that storyboard card. `editShot` rewrites one shot's `videoPrompt`/`durationSeconds` (rebuild the changed prompt with seedancePrompt first — never hand-write it); `addShot` appends a shot (`videoPrompt` required, built the same way); `deleteShot` removes a shot (a storyboard keeps at least one); `reorderShots` re-sequences with the FULL new order (e.g. [2,0,1]).

- Editing never generates or re-generates anything. If a shot already has a made video, changing its `videoPrompt` or `durationSeconds` makes that video stale (re-making it is a later, separately-approved paid step). Say so plainly when relevant.
- To lay out a NEW storyboard, use `proposeStoryboard`. To actually make videos, that is the separately-approved `generate`/gate step — never this skill.
