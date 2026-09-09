# Playbook: multi-shot videos — laying out a storyboard and editing one
<!-- when: storyboard, scenes, scene, shots, sequence, multi-scene, short film, commercial, episode, series of, few scenes, 分镜, 脚本, 多个镜头, 几个场景 -->
<!-- 来源：本文原文逐字来自退役前的单体说明书 packages/otto/src/instructions.ts（同名小节），⑥段（docs/specs/otto-engine.md §7.2⑥）搬进文件柜时只改了插值 → 占位符。2026-09-09 起第 2 步按 Founder 裁决改写（规格 creation-engine.md §5「FSE-001 同族」行）：带 @演员的镜头不再先出首帧。 -->
## When to call `proposeStoryboard` (multi-shot videos / ads)

When the user wants a video or ad that is a SEQUENCE of shots — a short film, a multi-scene ad, "a video with a few scenes", a storyboard — do NOT fire a single `propose`. Lay out a storyboard instead:

1. First understand intent (刨根问底) and confirm the goal — `proposeStoryboard` requires a `goal` and returns `needMoreInfo` without one.
2. For EACH shot, build its two prompts with the model skills (never hand-write them): call **seedreamPrompt** for the shot's `firstFramePrompt` (the opening still) and **seedancePrompt** for its `videoPrompt` (the motion). Supply the craft yourself — subject, camera move, lighting, composition — from the goal and brand context.
   For a shot that features an @-referenced entity, pass that entity in the seedreamPrompt/seedancePrompt `references` (role + name) for the identity-lock phrasing, AND include that entity's id in the shot's `entityIds` — that is how the reference photo will actually reach the model. Phrasing alone locks the words but not the face; without `entityIds` the character will drift.
   **A shot that @mentions a cast member (a person from the library) is made in ONE paid step, not two**: it gets no first frame at all — the cast member's own reference photo and the product photos ride along as references and the clip is made straight from the text. Still write a `firstFramePrompt` for it (the field is required, and it comes back into use if that cast member later leaves the shot), but never tell the user a frame will be made or charged for that shot. Shots with no cast member are unchanged: first frame, then video.
3. Call **`proposeStoryboard`** with `storyboardTitle`, `goal`, and the ordered `shots` (each: optional `title`, `firstFramePrompt`, `videoPrompt`, and optional `entityIds`). This lays out an ordered STORYBOARD_CARD the user can review and edit shot-by-shot.

**`proposeStoryboard` spends nothing** — it only lays out the plan; no credits are charged. The user reviews and edits first; the first-frame images and the videos are made later as separate, explicitly-approved steps. Say so plainly — never imply the storyboard itself generated or charged anything.

Use a single `propose` (not a storyboard) for a one-off image or a single short clip. Use `proposeStoryboard` only when there are genuinely multiple ordered shots.

Boundary — beats vs clips: several beats WITHIN one continuous short clip (seedancePrompt supports up to 4 shots-as-beats in a single clip) → still ONE `propose`, not a storyboard. Reach for `proposeStoryboard` only when the output is SEPARATE clips the user reviews and edits individually.

## When to call `editStoryboard`

Call **`editStoryboard`** to change an EXISTING storyboard card the user is reviewing — it is $0 and never spends credits. Pass the `cardId` of that storyboard card. `editShot` rewrites one shot's `firstFramePrompt`/`videoPrompt`/`durationSeconds` (rebuild the changed prompt with seedreamPrompt/seedancePrompt first — never hand-write it); `addShot` appends a shot (both prompts required, built the same way); `deleteShot` removes a shot (a storyboard keeps at least one); `reorderShots` re-sequences with the FULL new order (e.g. [2,0,1]).

- Editing never generates or re-generates anything. Changing a shot's first-frame prompt makes its already-made first frame stale (re-making it is a later, separately-approved paid step); changing only the video prompt or duration keeps the paid first frame. Say so plainly when relevant.
- To lay out a NEW storyboard, use `proposeStoryboard`. To actually make frames or videos, that is the separately-approved `generate`/gate step — never this skill.
