# Task ownership fence

This runbook operates the local overlap fence. GitHub remains the source of task scope,
dependency state and Founder decisions. A claim never grants product, merge, Blueprint,
deployment, spend, credential or cleanup authority.

## Lifecycle

1. On a fresh Git common directory only, create the empty local registry once:

   ```sh
   node scripts/task-ownership-check.mjs init
   ```

   `init` is create-only: it creates a mode-`0700` directory and mode-`0600`, generation-1
   empty registry. It refuses any existing registry, lock, symlink or malformed state and
   never overwrites or resets ownership history.
2. Live-query the GitHub issue and its native dependencies. Verify the existing branch,
   worktree, PR, base SHA and exact repository-relative scope.
3. Read the registry generation with `check`, then acquire the claim before the first
   repository mutation:

   ```sh
   node scripts/task-ownership-check.mjs check
   node scripts/task-ownership-check.mjs claim \
     --expect-generation <generation> \
     --claim-id <unique-task-claim> \
     --issue-url https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/issues/<issue> \
     --scope <file-or-directory/> \
     --base-sha <full-40-character-sha> \
     --revision <task-revision> \
     --session-id <session-identifier> \
     --expires-at <iso-8601-utc>
   node scripts/task-ownership-check.mjs check --claim-id <unique-task-claim>
   ```

4. Re-run `check --claim-id` on resume and immediately before commit or handoff. It
   verifies the declared base/worktree and fences committed, staged, unstaged and
   untracked paths; rename detection is disabled so both sides are checked.
5. At terminal completion or explicit transfer, close the exact claim with the current
   generation and original session identifier:

   ```sh
   node scripts/task-ownership-check.mjs close \
     --expect-generation <generation> \
     --claim-id <unique-task-claim> \
     --session-id <session-identifier> \
     --status RELEASED
   ```

   Use `SUPERSEDED` only when a durable replacement owns the task. Prove the expected
   remaining count with `check` or `check --require-zero`.

Missing, malformed, locked, expired, overlapping, wrong-repository, wrong-base,
wrong-worktree or out-of-scope state stops mutation. Expiry does not transfer ownership.
Read-only factual work does not need a claim and may not mutate repository or product state.
