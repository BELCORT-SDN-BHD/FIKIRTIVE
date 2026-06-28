import { describe, it, expect } from "vitest";
import { metaListObjectsSkill, executeMetaListObjects } from "./meta-list-objects.js";

it("gate: free/read/external → ungated", () => {
  expect(metaListObjectsSkill.cost).toBe("free");
  expect(metaListObjectsSkill.effect).toBe("read");
  expect(metaListObjectsSkill.reach).toBe("external");
  expect(metaListObjectsSkill.needsApproval).toBe(false);
});

it("returns a NOT_CONNECTED message when the port is missing", async () => {
  const res = await executeMetaListObjects({}, { context: {} as any });
  expect(JSON.stringify(res)).toMatch(/connect/i);
});

it("returns objects from the port", async () => {
  const ctx = { metaAds: { list: async () => ({ objects: [{ id: "s1", level: "adset", name: "S", status: "PAUSED", currency: "USD", accountId: "act_1" }] }) } };
  const res: any = await executeMetaListObjects({}, { context: ctx as any });
  expect(res.objects?.[0]?.id).toBe("s1");
});
