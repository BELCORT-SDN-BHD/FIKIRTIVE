import { describe, expect, it } from "vitest";

import { ROUTINE_AUTHORITY_FAILURES } from "@fikirtive/db";

import {
  reasonCodeCopy,
  summarizeRuleSource,
  validationIssueCopy,
  workflowErrorMessage,
  WORKFLOW_ERROR_COPY_CODES,
  WORKFLOW_REASON_COPY_CODES,
} from "@/components/crm/workflows/workflow-format";
import {
  CUSTOMER_WORKFLOW_ERROR_CODES,
  CUSTOMER_WORKFLOW_REASON_CODES,
} from "@/lib/customer-workflow-service";
import { routineLimitsSummary } from "@/lib/routine-authorization-facts";

// Mirrors the reordering the compiler grammar allows (packages/db/src/workflow-compiler.test.ts,
// "parses only the frozen envelope and canonicalizes key order/comments"): a step's action mapping
// may write templateVersionRef before type. summarizeRuleSource is display-only and must not depend
// on key order to find each step's action type.
const KEY_ORDER_SOURCE = `version: fikirtive-workflow/v1
name: Outside-hours reply
trigger:
  type: customer_message
conditions:
  - type: outside_business_hours
    policyRef: bhp_opaque
steps:
  - key: reply_once
    action:
      type: conversation_reply
      templateVersionRef: tmplv_opaque
  - key: finish
    action:
      type: complete
`;

const REORDERED_SOURCE = KEY_ORDER_SOURCE.replace(
  "      type: conversation_reply\n      templateVersionRef: tmplv_opaque\n",
  "      templateVersionRef: tmplv_opaque\n      type: conversation_reply\n",
);

describe("summarizeRuleSource", () => {
  it("summarizes trigger, actions, and condition for a rule in the canonical key order", () => {
    const summary = summarizeRuleSource(KEY_ORDER_SOURCE);
    expect(summary.trigger).toBe("When a customer messages");
    expect(summary.actions).toBe("Reply in the conversation, then mark the journey complete");
    expect(summary.condition).toBe("Only outside business hours");
  });

  it("still finds every step's action when templateVersionRef is written before type", () => {
    // Before the fix, the action-type regex required "type:" to appear immediately after
    // "action:\n", so this legal, compiler-accepted reordering silently dropped the reply step
    // and the summary read as just "Mark complete".
    const summary = summarizeRuleSource(REORDERED_SOURCE);
    expect(summary.actions).toBe("Reply in the conversation, then mark the journey complete");
  });
});

describe("rule validation copy (#723)", () => {
  it("says a rule with no steps has none, instead of claiming it has too many", () => {
    // The compiler used to report zero steps and too many steps with the same LIMIT_EXCEEDED code,
    // so a merchant holding an empty rule read "more conditions or steps than the limit allows".
    const copy = validationIssueCopy({ code: "EMPTY_STEPS", path: "$.steps" });
    expect(copy).toMatch(/no steps/i);
    expect(copy).not.toMatch(/limit/i);
    expect(copy).not.toMatch(/more/i);
    expect(copy).not.toContain("EMPTY_STEPS");
  });

  it("keeps the over-the-limit sentence for a rule that really is over the limit", () => {
    expect(validationIssueCopy({ code: "LIMIT_EXCEEDED", path: "$.steps" })).toMatch(/limit/i);
  });

  it("never hands an unmapped validation code to the merchant", () => {
    expect(validationIssueCopy({ code: "SOME_FUTURE_RULE_CODE", path: "$" }))
      .not.toContain("SOME_FUTURE_RULE_CODE");
  });
});

describe("workflow failure copy (#753)", () => {
  it("covers exactly the codes the merchant can be refused with", () => {
    // TOTALITY, both directions. Every refusal the workflow service can return has a sentence
    // here — AUTHORIZATION_CHANGED and SUMMARY_POLICY_UNREADABLE reached merchants as a raw-code
    // fallback because nothing checked this — and no sentence exists for a code nobody returns.
    // NETWORK is the one non-server code the panels pass in (the request never reached a server).
    const expected = [...Object.values(CUSTOMER_WORKFLOW_ERROR_CODES), "NETWORK"].sort();
    expect([...WORKFLOW_ERROR_COPY_CODES].sort()).toEqual(expected);
  });

  it("never puts a machine code in what the merchant reads", () => {
    for (const code of [...Object.values(CUSTOMER_WORKFLOW_ERROR_CODES), "NETWORK"]) {
      const message = workflowErrorMessage(code);
      expect(message, code).not.toContain(code);
      expect(message, code).not.toMatch(/[A-Z]{2,}_[A-Z]/);
      expect(message, code).toMatch(/[.!]$/);
    }
  });

  it("turns an unmapped code into words plus a next step, never the code itself", () => {
    const message = workflowErrorMessage("SOME_FUTURE_REFUSAL");
    expect(message).not.toContain("SOME_FUTURE_REFUSAL");
    expect(message).toContain("some future refusal");
    expect(message).toMatch(/retry/i);
  });
});

describe("workflow stop-reason copy (#811)", () => {
  it("covers exactly the reasons a Routine can stop with", () => {
    // TOTALITY, both directions — the pinboard #770 built for ERROR_COPY, which never covered
    // REASON_COPY. `consentStop:consent_unknown_d5_eligible` and
    // `consentStop:consent_unknown_unconfirmed_automatic_hard_block` had been reachable with
    // no sentence since before #807 because nothing compared these two sets.
    expect([...WORKFLOW_REASON_COPY_CODES].sort()).toEqual([...CUSTOMER_WORKFLOW_REASON_CODES].sort());
  });

  it("keeps the authority list honest (a collapsed enumeration would pin nothing)", () => {
    // Both sets being equal proves nothing if the authority itself went empty. These are the
    // four families it is assembled from, and the two reasons this ticket is about.
    expect(CUSTOMER_WORKFLOW_REASON_CODES.length).toBeGreaterThan(25);
    for (const code of [
      "routine_authority_hash_drift",
      "workflow_target_unavailable",
      "BUSINESS_HOURS_CLOCK_UNAVAILABLE",
      "consentStop:consent_unknown_d5_eligible",
      "consentStop:consent_unknown_unconfirmed_automatic_hard_block",
      "doNotDisturb:dnd_set",
      "providerRefusal:account_level_block",
      "frequency:frequency_cap_reached",
    ]) {
      expect(CUSTOMER_WORKFLOW_REASON_CODES, code).toContain(code);
    }
  });

  it("never puts a machine code in what the merchant reads", () => {
    for (const code of CUSTOMER_WORKFLOW_REASON_CODES) {
      const message = reasonCodeCopy(code);
      // The symptom itself: an uncovered reason came out as the humanised token
      // ("This workflow stopped with reason consentstop:consent unknown d5 eligible.").
      expect(message, code).not.toMatch(/^This workflow stopped with reason /);
      expect(message, code).not.toContain(code);
      // Both halves of `consentStop:dnd_set` are machine tokens: the axis name is camelCase,
      // the reason is snake_case, and the pre-dispatch/business-hours codes are SCREAMING_SNAKE.
      // ("frequency" on its own is an English word and stays allowed.)
      expect(message, code).not.toMatch(/\b[a-z]+[A-Z][a-z]/);
      expect(message, code).not.toMatch(/\b[a-z]+_[a-z]+\b/);
      expect(message, code).not.toMatch(/[A-Z]{2,}_[A-Z]/);
      expect(message, code).toMatch(/[.!]$/);
    }
  });

  it("answers the late-delegation family by prefix, without printing the failure name", () => {
    for (const failure of ROUTINE_AUTHORITY_FAILURES) {
      const code = `delegated_then_routine_authority_${failure}`;
      const message = reasonCodeCopy(code);
      expect(message, code).not.toContain(code);
      expect(message, code).toContain("handed off");
    }
  });

  it("says D5 nowhere — it is an internal document number, not a sentence (#728)", () => {
    for (const code of CUSTOMER_WORKFLOW_REASON_CODES) {
      expect(reasonCodeCopy(code), code).not.toMatch(/\bd5\b/i);
    }
  });

  it("turns an unmapped reason into words, and says something for no reason at all", () => {
    expect(reasonCodeCopy("SOME_FUTURE_STOP")).not.toContain("SOME_FUTURE_STOP");
    expect(reasonCodeCopy(null)).toBe("No reason was recorded.");
  });
});

describe("Routine limits copy (#723)", () => {
  it("counts one action and one recipient in the singular", () => {
    // 1 and 1 are the dialog's own defaults, so "Up to 1 actions and 1 recipients per run" was
    // the first sentence every merchant read on the authorization confirmation.
    expect(routineLimitsSummary(1, 1)).toBe("Up to 1 action and 1 recipient per run");
  });

  it("stays plural for every other count", () => {
    expect(routineLimitsSummary(2, 3)).toBe("Up to 2 actions and 3 recipients per run");
    expect(routineLimitsSummary(0, 0)).toBe("Up to 0 actions and 0 recipients per run");
  });

  it("does not invent a number when the authorization does not carry one", () => {
    expect(routineLimitsSummary(undefined, undefined)).toBe("Up to ? actions and ? recipients per run");
  });
});
