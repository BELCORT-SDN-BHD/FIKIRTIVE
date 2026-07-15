# Issue tracker: GitHub

Issues and planning artifacts for this repository live in GitHub Issues under
`BELCORT-SDN-BHD/FIKIRTIVE`. Use the `gh` CLI for all operations.

## Conventions

- Create: `gh issue create --title "..." --body "..."`
- Read: `gh issue view <number> --comments`
- List: `gh issue list --state open`
- Comment: `gh issue comment <number> --body "..."`
- Label: `gh issue edit <number> --add-label "..."`
- Close: `gh issue close <number> --comment "..."`

GitHub shares one number space across issues and pull requests. If a bare number
is ambiguous, check the pull request first and then the issue.

## Pull requests as a triage surface

PRs as a request surface: no.

## Skill operations

When a skill says “publish to the issue tracker”, create a GitHub issue.

When a skill says “fetch the relevant ticket”, read the issue and its comments.

## Wayfinding operations

- A map is one issue labelled `wayfinder:map`.
- Decision tickets are child issues labelled `wayfinder:research`,
  `wayfinder:prototype`, `wayfinder:grilling`, or `wayfinder:task`.
- Use GitHub sub-issues where available. Otherwise add `Part of #<map>` to the
  child and maintain a task list in the map.
- Use native GitHub issue dependencies for blocking relationships. Fall back to
  `Blocked by: #<number>` only when native dependencies are unavailable.
- An open, unblocked, unassigned child is on the frontier.
- Claim a ticket by assigning it before beginning work.
- Resolve a ticket by posting its answer, closing it, and adding a short linked
  pointer to the map’s Decisions-so-far section.
