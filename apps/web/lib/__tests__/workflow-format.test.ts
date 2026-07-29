import { describe, expect, it } from "vitest";

import { summarizeRuleSource } from "@/components/crm/workflows/workflow-format";

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
