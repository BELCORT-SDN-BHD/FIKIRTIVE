import { it, expect } from "vitest";
import { CONNECTION_BLOCKER_COPY } from "@fikirtive/core";
import { proposeAdBuildSkill, executeProposeAdBuild, proposeAdBuildInput } from "./propose-ad-build.js";

const VALID_INPUT = {
  goal: "Drive traffic to our website",
  reasoning: "The campaign should target young adults in Malaysia",
  mode: "create" as const,
  objective: "OUTCOME_TRAFFIC",
  pageId: "page-1",
  dailyBudgetMinor: 5000,
  creative: {
    assetId: "gen-abc",
    kind: "image" as const,
    message: "Check out our new product!",
    cta: "LEARN_MORE",
    link: "https://example.com",
  },
};

it("gate: free/write/internal → ungated", () => {
  expect(proposeAdBuildSkill.cost).toBe("free");
  expect(proposeAdBuildSkill.effect).toBe("write");
  expect(proposeAdBuildSkill.reach).toBe("internal");
  expect(proposeAdBuildSkill.needsApproval).toBe(false);
});

it("calls ctx.metaBuild.propose and reports the cardId", async () => {
  const ctx = { metaBuild: { propose: async () => ({ cardId: "card-1", autoBuilt: false }) } };
  const res: any = await executeProposeAdBuild(VALID_INPUT, { context: ctx as any });
  expect(JSON.stringify(res)).toMatch(/card-1|prepared|ready/i);
});

// #767:这三条以前只断言文本含 `connect` / `page`。那个正则对「从没连过」和「连着但过期」
// 一视同仁 —— 把三种状态答成同一句也照样绿。改成各钉各的:哪一句、算不算 blocked。
it("notConnected → 说的就是「还没连过」,且不算 blocked", async () => {
  const ctx = { metaBuild: { propose: async () => ({ notConnected: true as const }) } };
  const res: any = await executeProposeAdBuild(VALID_INPUT, { context: ctx as any });
  expect(res.blocked).toBeUndefined();
  expect(res.message).toMatch(/Meta isn't connected yet/);
});

it("needsReconnect → 共享的「连着但过期」文案,不是「还没连过」", async () => {
  const ctx = { metaBuild: { propose: async () => ({ needsReconnect: true as const }) } };
  const res: any = await executeProposeAdBuild(VALID_INPUT, { context: ctx as any });
  expect(res.blocked).toBe("needs_reconnect");
  expect(res.message).toContain(CONNECTION_BLOCKER_COPY.needs_reconnect.status);
  expect(res.message).not.toMatch(/isn't connected yet/i);
});

it("needsPageScope → 共享的「缺 Page 权限」文案,不是「还没连过」", async () => {
  const ctx = { metaBuild: { propose: async () => ({ needsPageScope: true as const }) } };
  const res: any = await executeProposeAdBuild(VALID_INPUT, { context: ctx as any });
  expect(res.blocked).toBe("needs_page_permission");
  expect(res.message).toContain(CONNECTION_BLOCKER_COPY.needs_page_permission.status);
  expect(res.message).not.toMatch(/isn't connected yet/i);
});

it("{invalid} with unknown-asset reason → friendly message, no throw", async () => {
  const ctx = {
    metaBuild: {
      propose: async () => ({ invalid: [{ field: "creative.assetId", reason: "unknown asset" }] }),
    },
  };
  const res: any = await executeProposeAdBuild(VALID_INPUT, { context: ctx as any });
  expect(JSON.stringify(res)).toMatch(/image|asset|find/i);
});

it("{invalid} with objective reason → friendly message, no throw", async () => {
  const ctx = {
    metaBuild: {
      propose: async () => ({ invalid: [{ field: "objective", reason: "unsupported objective" }] }),
    },
  };
  const res: any = await executeProposeAdBuild(VALID_INPUT, { context: ctx as any });
  expect(JSON.stringify(res)).toMatch(/objective|support/i);
});

it("{invalid} with generic reason → friendly message containing the reason, no throw", async () => {
  const ctx = {
    metaBuild: {
      propose: async () => ({ invalid: [{ field: "creative.link", reason: "invalid link" }] }),
    },
  };
  const res: any = await executeProposeAdBuild(VALID_INPUT, { context: ctx as any });
  expect(JSON.stringify(res)).toMatch(/link|invalid|check/i);
});

it("missing port → friendly not-connected message", async () => {
  const res: any = await executeProposeAdBuild(VALID_INPUT, { context: {} as any });
  expect(JSON.stringify(res)).toMatch(/connect/i);
});

it("input zod schema has no approval/accountId/targeting-shaped/identity keys", () => {
  const topLevelKeys = Object.keys(proposeAdBuildInput.shape);
  // must have strategy fields
  expect(topLevelKeys).toContain("goal");
  expect(topLevelKeys).toContain("reasoning");
  expect(topLevelKeys).toContain("mode");
  expect(topLevelKeys).toContain("objective");
  expect(topLevelKeys).toContain("pageId");
  expect(topLevelKeys).toContain("dailyBudgetMinor");
  expect(topLevelKeys).toContain("creative");
  // must NOT have server/identity fields
  expect(topLevelKeys).not.toContain("approval");
  expect(topLevelKeys).not.toContain("accountId");
  expect(topLevelKeys).not.toContain("orgId");
  expect(topLevelKeys).not.toContain("ownerId");
  expect(topLevelKeys).not.toContain("userId");
  // must NOT have the shaped targeting object (only the hint)
  expect(topLevelKeys).not.toContain("targeting");
});
