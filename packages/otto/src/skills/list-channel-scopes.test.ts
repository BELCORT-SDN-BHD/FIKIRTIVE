import { it, expect, vi } from "vitest";
import { listChannelScopesSkill, executeListChannelScopes } from "./list-channel-scopes.js";

it("gate: free/read/internal → ungated", () => {
  expect(listChannelScopesSkill.cost).toBe("free");
  expect(listChannelScopesSkill.effect).toBe("read");
  expect(listChannelScopesSkill.reach).toBe("internal");
  expect(listChannelScopesSkill.needsApproval).toBe(false);
});

it("returns the workspace's connected channel accounts from the port", async () => {
  const list = vi.fn(async () => ({
    ok: true as const,
    scopes: [{ id: "scope-1", channel: "whatsapp", scopeKey: "waba-a" }],
  }));
  const res: any = await executeListChannelScopes({}, { context: { channelScopes: { list } } as any });
  expect(list).toHaveBeenCalledTimes(1);
  expect(res.scopes[0]).toEqual({ id: "scope-1", channel: "whatsapp", scopeKey: "waba-a" });
});

it("a zero-channel workspace gets an empty list, not an error", async () => {
  const list = vi.fn(async () => ({ ok: true as const, scopes: [] }));
  const res: any = await executeListChannelScopes({}, { context: { channelScopes: { list } } as any });
  expect(res.ok).toBe(true);
  expect(res.scopes).toEqual([]);
});

it("degrades gracefully when the port is missing", async () => {
  const res: any = await executeListChannelScopes({}, { context: {} as any });
  expect(res.error).toBeTruthy();
});
