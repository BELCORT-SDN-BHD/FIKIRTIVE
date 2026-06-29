import { it, expect } from "vitest";
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

it("returns pages from the port", async () => {
  const ctx = { metaPages: { list: async () => ({ pages: [{ id: "p1", name: "My Page" }] }) } };
  const res: any = await executeListMetaPages({}, { context: ctx as any });
  expect(res.pages?.[0]?.id).toBe("p1");
});
