# FIKIRTIVE — remaining pages to production (design overview)

Date: 2026-06-30 · Status: approved in brainstorm, specs follow

Three remaining surfaces, brainstormed and approved. Each is its own focused spec
so it can be built and shipped independently, in this order (quick wins first;
Schedule + its Meta App Review run in parallel):

1. **Account / Settings redo** → `2026-06-30-account-settings-design.md`
   Smallest. Reskin + restructure the working Account page into a scalable
   settings page (Dir 1 look — one page + left jump-nav — with a config-driven
   section registry underneath). Reuses existing data/actions; money path untouched.

2. **Analytics** → `2026-06-30-analytics-design.md`
   Medium. Wire the locked Analytics mockup to the real Meta read data we already
   pull (`fetchOwnerInsights`). Read-only (G6), no spend.

3. **Schedule** → `2026-06-30-schedule-design.md`
   Largest — a net-new Buffer-like social scheduler for Instagram + Facebook,
   driven by OTTO. New post model + organic Meta publishing + a timed scheduler +
   calendar/composer UI. Phased (A → B → C). Auto-publish needs Meta App Review
   for `instagram_content_publish` (founder submits in parallel with the build).

## Shared principles (apply to all three)
- **Design system**: Grok-bright (gb), now the default skin. Coral = OTTO/agent only.
  Sentence case, no em-dashes in UI copy.
- **Audience**: non-technical SMB owners; OTTO super-employee model (talk to OTTO,
  OTTO does the work, owner approves).
- **Money path is sacred**: these pages are display / preferences / read-only, or
  (Schedule) organic publishing which costs no fal credits. No change to
  reserve/settle/charge, the genRequest gate, startGen, idempotency, or the
  provider call. Buying credits reuses the existing Stripe grantCredits-only path.
- **Public-content consent**: publishing to a public IG/FB account always requires
  explicit owner approval per post (or per approved batch) before it is queued.
