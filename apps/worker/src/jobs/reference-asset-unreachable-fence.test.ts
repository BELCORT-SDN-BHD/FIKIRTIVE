/**
 * reference-asset-unreachable-fence — CREATE-A2, Codex QA-CRE-007, PR #1171 判官 P1-1 落修.
 *
 * `apps/web/lib/__tests__/library-failure-human-copy.test.ts` and `gen-failure.test.ts` pin the
 * TWO ENDS of this pipe — the sentence map, and the card that renders whatever `error` string it
 * is handed. Neither one pins the MIDDLE: the eight throw sites in this file's neighbour
 * (`gen.ts`) and `refgen.ts` that decide WHAT gets thrown when a pre-spend reachability check
 * fails. Before this file, all eight could be silently reverted to their original raw diagnostic
 * (`` `conditioning refs unreachable (${n}/${m}) — refusing to spend` ``-shaped strings) and CI
 * would stay green — `tsc` doesn't care what string reaches `new Error(...)`, and no test read
 * `GenJob.error`/`RefGenJob.error` after a throw. The judge's P1-1 variant proved it: reverting
 * `gen.ts:1138` alone left worker `tsc`, core's 72 tests, and web's 5 human-copy tests all
 * passing (`gh` comment 5532937549, 变异 (a)).
 *
 * This is a SOURCE FENCE (lexical, `readFileSync` + balanced-paren scan over `throw new
 * Error(...)` call sites — same recipe as `client-core-imports.test.ts` and
 * `generation-receipt-read-path.test.ts`), not a behavioural test: driving these eight sites
 * through real `handleGen`/`handleRefGen` calls would mean re-deriving `gen.test.ts`'s and
 * `refgen-*.test.ts`'s entire mock-Prisma harness for a check that is really about which STRING
 * LITERAL a line of source contains. The fence catches exactly the defect the judge found —
 * someone reverting one throw site to its pre-#765 diagnostic sentence — which is a source-level
 * mutation, not a runtime-behaviour one.
 *
 * Red→green proof (the mutations the judge already ran on `gen.ts:1138`; `git checkout --` after
 * each): revert any one of the eight `throw new Error(REFERENCE_ASSET_UNREACHABLE)` sites back to
 * its original literal ⇒ the "no leaked diagnostic" test goes red, naming the offending file. Cut
 * one throw site out entirely (e.g. delete the `refgen.ts:441` conditioning-refs throw) without
 * restoring a literal ⇒ the site-count test goes red instead, because the guarded count drops
 * below the floor even though no forbidden substring reappeared — the two tests below cover both
 * failure shapes, not just the substring one.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const GEN_SRC = readFileSync(path.resolve(__dirname, "gen.ts"), "utf8");
const REFGEN_SRC = readFileSync(path.resolve(__dirname, "refgen.ts"), "utf8");

/**
 * The internal ops phrases `REFERENCE_ASSET_UNREACHABLE` replaced as the PERSISTED sentence
 * (`packages/core/src/gen-failure.ts`'s file header). These may still appear in `console.error`
 * calls (support/debugging, never persisted) — this fence only reads the argument of a
 * `throw new Error(...)` call, never a `console.error(...)` one, so the legitimate diagnostic
 * logging right above each throw site does not trip it.
 */
const FORBIDDEN_IN_THROWN_MESSAGE = ["refusing to spend", "unreachable (", "conditioning refs"];

/** Every `throw new Error(<arg>)` call's raw argument text, scanned by balanced-paren depth so a
 *  template literal's own `${…}` parens (e.g. `${Math.round(refDur)}`) don't truncate the match —
 *  same technique `generation-receipt-read-path.test.ts` uses for brace-balanced Prisma blocks. */
function throwNewErrorArgs(src: string): string[] {
  const marker = "throw new Error(";
  const args: string[] = [];
  let offset = 0;
  for (;;) {
    const start = src.indexOf(marker, offset);
    if (start === -1) return args;
    const open = start + marker.length - 1; // index of the call's own "("
    let depth = 0;
    let i = open;
    for (; i < src.length; i += 1) {
      if (src[i] === "(") depth += 1;
      else if (src[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    args.push(src.slice(open + 1, i));
    offset = i + 1;
  }
}

/** How many of a file's `throw new Error(...)` sites throw the merchant reason code
 *  `REFERENCE_ASSET_UNREACHABLE` by name (as opposed to a raw diagnostic string). */
function referenceAssetUnreachableThrowCount(src: string): number {
  return throwNewErrorArgs(src).filter((arg) => arg.trim() === "REFERENCE_ASSET_UNREACHABLE").length;
}

describe("pre-spend reachability throws — CREATE-A2: honest refusal before spend, Codex QA-CRE-007 (PR #1171 判官 P1-1)", () => {
  it("gen.ts: no throw new Error(...) carries the raw ops diagnostic — only the merchant reason code may be thrown", () => {
    for (const arg of throwNewErrorArgs(GEN_SRC)) {
      for (const phrase of FORBIDDEN_IN_THROWN_MESSAGE) {
        expect(arg, `apps/worker/src/jobs/gen.ts threw a raw diagnostic instead of the reason code: throw new Error(${arg})`).not.toContain(phrase);
      }
    }
  });

  it("refgen.ts: no throw new Error(...) carries the raw ops diagnostic — only the merchant reason code may be thrown", () => {
    for (const arg of throwNewErrorArgs(REFGEN_SRC)) {
      for (const phrase of FORBIDDEN_IN_THROWN_MESSAGE) {
        expect(arg, `apps/worker/src/jobs/refgen.ts threw a raw diagnostic instead of the reason code: throw new Error(${arg})`).not.toContain(phrase);
      }
    }
  });

  it("gen.ts: at least the 5 known pre-spend reachability sites throw REFERENCE_ASSET_UNREACHABLE by name", () => {
    // 5 known throw sites (conditioning refs / i2v source image / last-frame image /
    // whole-clip reference video / edit-source image) — apps/worker/src/jobs/gen.ts
    // :1138 / :1209 / :1236 / :1263 / :1310 as catalogued in PR #1171's 判官裁定 comment 5532937549.
    const GEN_REFERENCE_UNREACHABLE_THROW_SITES = 5;
    expect(referenceAssetUnreachableThrowCount(GEN_SRC)).toBeGreaterThanOrEqual(GEN_REFERENCE_UNREACHABLE_THROW_SITES);
  });

  it("refgen.ts: at least the 3 known pre-spend reachability sites throw REFERENCE_ASSET_UNREACHABLE by name", () => {
    // 3 known throw sites (variant base missing / variant base unreachable / refsheet
    // conditioning refs unreachable) — apps/worker/src/jobs/refgen.ts :413 / :419 / :441.
    const REFGEN_REFERENCE_UNREACHABLE_THROW_SITES = 3;
    expect(referenceAssetUnreachableThrowCount(REFGEN_SRC)).toBeGreaterThanOrEqual(REFGEN_REFERENCE_UNREACHABLE_THROW_SITES);
  });
});
