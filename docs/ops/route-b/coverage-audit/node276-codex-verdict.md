
The media behavior itself passes: media returns `mediaContractRefused` before X, and the common handler maps it deterministically to `NEEDS_ATTENTION`: `apps/worker/src/jobs/publish.ts:377-380,541-558`. It is not silently dropped.

2. **BLOCK — Fail-closed gate**

The individual refusal gates are present:

- Exact `tweet.write` derivation, default false: `packages/core/src/x-publish.ts:18-26`.
- Schema scope defaults to `""`; kill switch exists: `packages/db/prisma/schema.prisma:1103-1110`.
- Owner-scoped scope/pause/expiry checks precede port construction: `apps/worker/src/jobs/publish.ts:350-365`; web equivalent at `apps/web/lib/channels/x-publish-adapter.ts:30-45`.

But “no OAuth means every path fail-closes” is false. A `ChannelConnection` row containing `tweet.write` and a decryptable token reaches the real outbound port; the test demonstrates exactly that. Additionally, authorization rejects only `status === "expired"` rather than requiring `status === "active"`, so another status would fail open: `apps/worker/src/jobs/publish.ts:357-363`.

No X OAuth route exists in the pinned tree; `connectUrl()` merely points to the absent route: `apps/web/lib/channels/x.ts:24`.

3. **BLOCK — E4-16 / scheduled-X correctness**

The narrow zero-semantic-change claim passes:

- `meta-publish.ts`, `handlePublish`, four locks, Meta authorization/resolution, and `scanDuePublishPosts` are unchanged.
- X plugs into `realExecute` at one dispatch line: `apps/worker/src/jobs/publish.ts:385-389`.
- The unchanged Meta-only scheduler is explicitly documented as deferred until X OAuth: `apps/worker/src/jobs/publish.ts:371-373,743-767`. This is not a silent omission.

However, scheduled X publishing is impossible even if credentials later appear:

- Approval requires at least one media item: `apps/web/lib/schedule-actions.ts:328-333`.
- UI enforces the same requirement: `apps/web/components/otto/OttoSchedule.tsx:1117-1120`.
- `executeX` refuses every post containing media: `apps/worker/src/jobs/publish.ts:377-380`.

Therefore text-only X posts cannot be approved, while approved X posts necessarily become `NEEDS_ATTENTION`. That is a correctness bug, not merely the documented scheduler deferral.

4. **BLOCK — Billing; migration sub-check PASS**

Billing positives:

- Frozen constants are correctly `1cr`/`4cr`: `packages/core/src/x-billing.ts:21-24`.
- Mapping is pure and execution-disconnected; static repository grep found no publish-path caller. It is only barrel-exported at `packages/core/src/index.ts:57-62`.
- Accordingly money-safety Step-1 is **NO** for this PR.

Blocking issue: ambiguous-high is incomplete. Detection only recognizes schemes, `www`, or bare domains whose TLD appears in a hand-maintained set: `packages/core/src/x-billing.ts:31-59`. Consequently redirect wording such as `Link in bio` and bare valid domains with unlisted TLDs can return 1cr, contrary to the frozen “跳转文案就高” rule. The tests cover `Link in bio: linktr.ee/...`, not redirect wording without a detected domain: `packages/core/src/x-billing.test.ts:11-23,51-63`.

Migration sub-check **PASS**:

- Exactly one additive `ADD COLUMN`; no destructive DDL: `packages/db/prisma/migrations/20260713130000_channel_connection_publish_paused/migration.sql:1-7`.
- Existing owner FK/index remain intact: `packages/db/prisma/schema.prisma:1096-1122`.
- X queries carry `ownerId`, e.g. `apps/web/lib/channels/x-publish-adapter.ts:30-34`.

5. **BLOCK — Closed set, UI, single action layer**

Closed-set additions are consistent:

- Core set and caps: `packages/core/src/schedule-draft.ts:11-30`.
- Otto enum: `packages/otto/src/skills/schedule-posts.ts:23-25`.
- Client mirror: `apps/web/lib/channels/channel-meta.ts:15-47`.
- Registry: `apps/web/lib/channels/registry.ts:1-15`.

Single action-layer shape also passes: web and worker both drive `publishX`: `apps/web/lib/channels/x-publish-adapter.ts:73-80`; `apps/worker/src/jobs/publish.ts:374-382`; core implementation at `packages/core/src/x-publish.ts:74-90`.

But the UI did not truly collapse the six channel literals into `CHANNEL_META`:

- `ChannelIcon` remains a per-channel `if` chain and now adds another X-specific branch: `apps/web/components/otto/OttoSchedule.tsx:84-109`.
- Inline type casts still enumerate all three channels: `apps/web/components/otto/OttoSchedule.tsx:1137-1153`.
- X capability copy says “Up to 4 photos or a video” through `capsBlurb`, while execution refuses all media: `apps/web/components/otto/OttoSchedule.tsx:112-120`; worker refusal at `apps/worker/src/jobs/publish.ts:377-380`.

This violates contract 6’s requirement that icon/capability/filter behavior be metadata-driven and leaves misleading UI.

6. **PASS — Static regression/parity consistency; execution unverified**

- Registry roster remains forty-two skills and still contains `schedulePosts`: `packages/otto/src/registry.test.ts:5-8`.
- CATALOG is refreshed to Instagram/Facebook/X: `packages/otto/src/skills/CATALOG.md:41`.
- Existing parity pairing remains `schedulePosts`; no parity union was changed: `packages/otto/src/parity-manifest.ts:232-241`.
- The 23 X-specific tests do structurally cover ambiguity and mapping direction:
  - Ambiguous 2xx/5xx/timeout: `packages/core/src/x-publish.test.ts:42-60`.
  - Link-never-1cr sample assertion: `packages/core/src/x-billing.test.ts:51-63`.
  - Media refusal: `apps/worker/src/jobs/publish-x-executor.test.ts:66-72`.
- `git diff --check` passes.

I could not execute the tests: this worktree has no `node_modules`, and `pnpm exec vitest` returned `Command "vitest" not found`. Thus runtime green status is unverified.

**NODE-276: BLOCK(1,2,3,4,5)**
