/**
 * #741 判官 r5 [P1] —— Otto 的第二张嘴。
 *
 * 这个技能直接接同一个 fetchOwnerPages(otto-actions.ts:554),却把 needsReconnect 和
 * notConnected 合并成同一句「Meta isn't connected yet」。商家明明连过,只是授权过期 ——
 * 人工界面这轮改口说「重新授权」,Otto 这边还在说「你还没连」,同一个事实两套说法。
 *
 * 分类必须来自共享权威(core 的 classifyPagesRead + CONNECTION_BLOCKER_COPY),
 * 让「合并回去」这件事在结构上做不到。
 */
import { it, expect } from "vitest";
import { CONNECTION_BLOCKER_COPY } from "@fikirtive/core";
import { listMetaPagesSkill, executeListMetaPages } from "./list-meta-pages.js";

it("gate: free/read/external → ungated", () => {
  expect(listMetaPagesSkill.cost).toBe("free");
  expect(listMetaPagesSkill.effect).toBe("read");
  expect(listMetaPagesSkill.reach).toBe("external");
  expect(listMetaPagesSkill.needsApproval).toBe(false);
});

it("returns a NOT_CONNECTED message when the port is missing", async () => {
  const res = await executeListMetaPages({}, { context: {} as any });
  expect(JSON.stringify(res)).toMatch(/connect/i);
});

it("returns a needsPageScope message when the port returns needsPageScope", async () => {
  const ctx = { metaPages: { list: async () => ({ needsPageScope: true as const }) } };
  const res: any = await executeListMetaPages({}, { context: ctx as any });
  expect(JSON.stringify(res)).toMatch(/reconnect/i);
});

// #741 r5 [P1] —— 三条红:分类必须与人工界面同源,且绝不把「连着但用不了」说成「没连过」。
it("needsReconnect 不再被并进「还没连」—— 说的是授权过期,要重新连接", async () => {
  const ctx = { metaPages: { list: async () => ({ needsReconnect: true as const }) } };
  const res: any = await executeListMetaPages({}, { context: ctx as any });
  expect(res.blocked).toBe("needs_reconnect");
  // 病灶原文:"Meta isn't connected yet. …"
  expect(String(res.message)).not.toMatch(/isn't connected yet/i);
  expect(String(res.message)).toContain(CONNECTION_BLOCKER_COPY.needs_reconnect.status);
});

it("needsPageScope 也走同一份权威的标签", async () => {
  const ctx = { metaPages: { list: async () => ({ needsPageScope: true as const }) } };
  const res: any = await executeListMetaPages({}, { context: ctx as any });
  expect(res.blocked).toBe("needs_page_permission");
  expect(String(res.message)).toContain(CONNECTION_BLOCKER_COPY.needs_page_permission.status);
  expect(String(res.message)).not.toMatch(/isn't connected yet/i);
});

it("真的没连过才说「还没连」", async () => {
  const ctx = { metaPages: { list: async () => ({ notConnected: true as const }) } };
  const res: any = await executeListMetaPages({}, { context: ctx as any });
  expect(res.blocked).toBeUndefined();
  expect(String(res.message)).toMatch(/isn't connected yet/i);
});

it("returns pages from the port", async () => {
  const ctx = { metaPages: { list: async () => ({ pages: [{ id: "p1", name: "My Page" }] }) } };
  const res: any = await executeListMetaPages({}, { context: ctx as any });
  expect(res.pages?.[0]?.id).toBe("p1");
});
