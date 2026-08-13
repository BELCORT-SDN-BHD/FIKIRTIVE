import { it, expect, vi } from "vitest";
import { MESSAGING_STATUS_ASSISTANT } from "@fikirtive/core";
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

// #792 r2 判词 P1 —— 技能描述是**模型真正读到的字**,所以它就是行为。旧版结尾写着
// "tell the user to connect one",于是 Otto 在渠道为空时把商家送去一个不存在的入口
// (#541 已确认 Connections 里没有 Messaging 连接)。空渠道口径全仓一份,系统指令与这里
// 读同一个常量;谁想再在这里补一句自己的措辞,这条会红。
it("空渠道口径与系统指令同源,而且不劝商家去连一条连不上的渠道", () => {
  expect(listChannelScopesSkill.description).toContain(MESSAGING_STATUS_ASSISTANT);
  // 「never tell them to connect one」是**禁令**,不是指令 —— 所以只抓没有 never 在前面的
  // 那种祈使写法。
  expect(listChannelScopesSkill.description).not.toMatch(
    /(?<!never )tell (?:the user|them) to connect one|suggest connecting one/i,
  );
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
