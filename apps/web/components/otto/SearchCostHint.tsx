/**
 * SearchCostHint — the line a merchant reads BEFORE they ask Otto something that needs a
 * web search (钱引擎 S2 §7.4 / MONEY-A10;Founder 2026-09-02 变更登记「A10 聊天搜索的商家侧披露」).
 *
 * Why this exists at all: ③段 shipped the second money leg of a chat turn — every web search
 * Otto runs inside a reply is charged to the merchant — and the only place that price was
 * written down was the model's own system prompt. The merchant could read the whole product
 * and never learn that asking "what are my competitors charging?" costs more than asking
 * "rewrite this caption". A charge whose only disclosure is inside the prompt is not a
 * disclosure; it is the same 观感雷 §7.3 was built to defuse, one surface over.
 *
 * The mount is deliberately the SAME place as `UnderstandingCostHint` — under the composer,
 * on screen before the merchant types — so both of the chat surface's non-obvious charges
 * (the file they attach, the search their question triggers) are read in one glance.
 *
 * **数值禁字面量.** Every number is computed here from the same constants the charging path
 * reserves and settles against: `searchUnitChargeInternal` (the 3× rate), `searchChargeInternal`
 * (N searches) and `OTTO_CHAT_MAX_SEARCHES_PER_TURN` (the per-turn ceiling, which is also the
 * hold's worst case). A hand-typed "0.3" would go stale the first time a cost pin moves, and it
 * would go stale silently.
 *
 * The wording tracks `CHAT_SEARCH_PRICE_CLAUSE` / the merchant clause in
 * `packages/otto/src/instructions.ts` on purpose: what Otto tells a merchant when asked, and
 * what the composer shows them unasked, must be the same 口径 — charged per search that
 * COMPLETES (an empty result set completed; a failed provider call did not).
 *
 * Subpath imports, never the `@fikirtive/core` barrel: this file is reachable from the client
 * composer, and the barrel is Node-capable (`lib/__tests__/client-core-imports.test.ts`).
 * Not a "use client" module, for the same reason UnderstandingCostHint isn't: it holds no
 * state, so the string exports stay readable from server-rendered surfaces too.
 */
import {
  OTTO_CHAT_MAX_SEARCHES_PER_TURN,
  searchChargeInternal,
  searchUnitChargeInternal,
} from "@fikirtive/core/pricing-config";
import { displayCredits } from "@fikirtive/core/spend";
import { creditsLabel } from "@/lib/credit-format";

/** What ONE completed search costs, in the words the rest of the money UI uses. Derived from
 *  the same rate the turn's firm leg reserves at — never typed. */
export const SEARCH_UNIT_LABEL = creditsLabel(displayCredits(searchUnitChargeInternal("basic")));

/** The most one message can add in search charges: the per-turn ceiling at the unit rate.
 *  This is the number that makes the spend-cap exemption defensible, so it is derived from
 *  the ceiling itself — change the ceiling and this sentence moves with it. */
export const SEARCH_TURN_MAX_LABEL = creditsLabel(
  displayCredits(searchChargeInternal(OTTO_CHAT_MAX_SEARCHES_PER_TURN)),
);

/** The disclosure sentence, exported so the tests (and any future surface) read the same
 *  string the merchant does rather than a second copy of it. */
export const SEARCH_COST_HINT =
  `Otto searches the web when your question needs it: ${SEARCH_UNIT_LABEL} per search, ` +
  `up to ${String(OTTO_CHAT_MAX_SEARCHES_PER_TURN)} searches in one message.`;

/**
 * The hover explanation. Two things the one-liner cannot carry and a merchant would otherwise
 * discover from their ledger:
 *   · **只为成功的供应商调用收费** (§7.4) — a search that comes back with nothing still ran and
 *     is still charged; a search that fails outright is not. Naming only the first half would
 *     read as "you pay for results", which is not what the code does.
 *   · **单动作上限豁免** (Founder 2026-09-02, accepted and to be written down) — these searches
 *     ride inside the message's own charge, so the merchant's per-action Spend cap does not
 *     stop them. That is a real gap in a control the merchant set, and the reason it is
 *     acceptable is the ceiling above: the exposure is bounded at SEARCH_TURN_MAX_LABEL per
 *     message. Both halves belong in the same sentence.
 */
export const SEARCH_COST_HINT_TITLE =
  `Only searches that complete are charged — including one that comes back empty-handed. ` +
  `Search rides inside the message charge, so your per-action spend cap does not apply to it; ` +
  `one message can add at most ${SEARCH_TURN_MAX_LABEL} of search.`;

/**
 * The shared line. Same styling as the repo's other cost hints (`FlowCanvas.tsx` cost hint,
 * `UnderstandingCostHint`) — a cost disclosure looks the same wherever a merchant meets one.
 */
export function SearchCostHint() {
  return (
    <span className="text-[0.75rem] text-muted-foreground" title={SEARCH_COST_HINT_TITLE}>
      {SEARCH_COST_HINT}
    </span>
  );
}

export default SearchCostHint;
