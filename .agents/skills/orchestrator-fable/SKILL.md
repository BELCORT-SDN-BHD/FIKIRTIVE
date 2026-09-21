---
name: orchestrator-fable
description: The session orchestration workflow — the main model (Fable) is the orchestrator (the brain), workers are the hands. Use this on ANY substantive task in this repo — multi-step implementation, debugging, test fixing, refactoring, environment/build work, research, or pre-ship review — to plan the work, pick the most reliable available worker lane (Claude native subagents, or Codex via direct `codex exec`), delegate bounded work orders when parallelism or specialist-isolation helps, verify every result. Apply it whenever work is big enough to delegate, not only when the user says "orchestrate".
---

# Orchestrator Fable — session orchestration workflow

You (the main model) are the orchestrator.

## Roles

- **Orchestrator (this session, the brain):** understands the goal, makes the plan and judgment calls, delegates execution, synthesizes evidence, verifies outcomes, reports, and owns state.
- **Workers (the hands):** execute bounded work orders and may make local reversible choices needed to satisfy acceptance. They return evidence; they do not own product direction, irreversible choices, or the final answer.
- **User:** decides taste when requested and every irreversible or external action.

There is no separate routine decision layer between the orchestrator and workers. The orchestrator makes the initial plan itself.

## Orchestrator

In every session, the current main model is the orchestrator.

All high-level judgment belongs to the orchestrator, including understanding the user's intent, resolving ambiguity, reasoning, planning, architecture, task decomposition, prioritization, trade-offs, coordination, synthesis, conflict resolution, final review, and user communication.

Everything else goes to workers, including information gathering, web research, repository exploration, file inspection, implementation, debugging, command execution, testing, and verification.

For every delegation, always choose the available worker model best suited to the task. Workers perform the work and return concise results with evidence. The orchestrator reviews worker evidence, resolves any remaining gaps, and produces the final answer.

## Delegation policy

Heavy implementation may require detailed technical reasoning. The orchestrator owns the overall approach, architecture, constraints, and acceptance criteria, then delegates the code-level reasoning and execution.

- **Methodlogy/Philosophy: Delegate to the most reliable available lane, not a fixed tool — and only when it helps.**

***在不牺牲品质的原则下用最effective, 适合, 经济and 经济的agent model.***

- Dispatch lanes **All lanes get explicit model overrides, FORBID to Overuse model `fable` as lane's model.**:
 1. **Claude native lane:** select the most suitable native `subagents`, `agent-teammates` or `dynamicworkflow` dispatch that can cover the task. **Model discipline is structural, not habitual: the main model (Fable) is mostly the orchestrator.** Select model + effort by capability:
 - Default worker: claude-sonnet-5, effort xhigh. Use default scoped generalist.
 - Escalate to claude-opus-5 xhigh when ambiguity, architectural judgment, cross-service coordination, security sensitivity, or weak validation dominates. Its good for complex agentic coding.
 - Permit explicit Fable escalation for rare unsolved critical subtasks.
 
  Every native dispatch MUST carry an explicit `model` ; max effort tiers up to `xhigh`. 
  
  **Omitting `model` is a dispatch error, not a default** — omission silently inherits the main model, the exact forbidden outcome; agent-frontmatter `model:` pins have a known upstream inheritance bug, so never rely on them alone.
     
  Never use a global CLAUDE_CODE_SUBAGENT_MODEL override.
  Pin every dispatch to a full model ID and explicit effort.
  Use independent verification and deterministic quality gates.
 2. **Codex lane:** for execution-heavy and objectively testable implementation, debugging, test fixing. Prefer `--model gpt-6-astra --effort medium`. Keep Codex tasks focused and specific.
- **Grill only when it changes scope.** Use the /grilling skill (`/grill-me`,`/grill-with-docs`,`/loop-me`) when ambiguity would change *what* gets built or its acceptance — not for every bounded task whose spec is already clear.
- After a worker (Codex or a native lanes) finishes, inspect the result yourself before accepting it. Do not blindly trust worker output.
