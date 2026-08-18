import { describe, it, expect, vi } from "vitest";
import { executeManageEntities, manageEntitiesSkill } from "./manage-entities.js";
import type { OttoContext } from "../context.js";

// W-B3-D (parity debts 08-10 / B0-11): the skill routes through ctx.entities — thin closures over
// the same owner-gated element server actions the human elements UI uses. Tests assert routing,
// missing-param guards, the honest create-without-photos boundary, and $0 gate.

type Port = NonNullable<OttoContext["entities"]>;

function makeCtx(entities?: Partial<Port>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    ...(entities ? { entities: entities as Port } : {}),
  } as unknown as OttoContext;
}

describe("manageEntities gate", () => {
  it("free/write/internal → needsApproval false", () => {
    expect(manageEntitiesSkill.cost).toBe("free");
    expect(manageEntitiesSkill.effect).toBe("write");
    expect(manageEntitiesSkill.reach).toBe("internal");
    expect(manageEntitiesSkill.needsApproval).toBe(false);
  });
});

describe("executeManageEntities — port required", () => {
  it("degrades gracefully when ctx.entities is not injected", async () => {
    const res = await executeManageEntities({ action: "create", name: "x", type: "PRODUCT" }, { context: makeCtx() });
    expect(res).toEqual({ ok: false, error: "Element management isn't available right now." });
  });
});

describe("create — named element, no photos (honest boundary) (debt-08)", () => {
  it("needs name + type, then routes and reports the no-photos truth", async () => {
    const create = vi.fn(async () => ({ id: "e-1" }));
    const ctx = makeCtx({ create });
    expect((await executeManageEntities({ action: "create", type: "PRODUCT" }, { context: ctx })) as { error: string }).toHaveProperty("error");
    expect((await executeManageEntities({ action: "create", name: "Latte" }, { context: ctx })) as { error: string }).toHaveProperty("error");
    const res = (await executeManageEntities({ action: "create", name: "Signature latte", type: "PRODUCT" }, { context: ctx })) as {
      ok: boolean; entityId: string; note: string;
    };
    expect(res.ok).toBe(true);
    expect(res.entityId).toBe("e-1");
    expect(res.note).toContain("no reference photos");
    expect(create).toHaveBeenCalledWith({ name: "Signature latte", type: "PRODUCT" });
  });
});

// beta bug 4 —— 类型建好就再也改不了、改名又只有人手有,录屏里那只「被当成人的瓶子」因此无解。
// 这一段钉的是:Otto 走的是人手 Library 卡片按的同一个动作,自己不重做任何判断。
describe("update — correct a saved element's name and/or kind (beta bug 4)", () => {
  it("needs entityId, and needs at least one field to change", async () => {
    const update = vi.fn(async () => ({ ok: true as const }));
    const ctx = makeCtx({ update });
    expect(await executeManageEntities({ action: "update", type: "PRODUCT" }, { context: ctx })).toEqual({
      ok: false, error: "update needs `entityId`.",
    });
    expect(await executeManageEntities({ action: "update", entityId: "e-1" }, { context: ctx })).toEqual({
      ok: false, error: "update needs a `name`, a `type`, or both.",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("routes a kind correction and stays honest about past work", async () => {
    const update = vi.fn(async () => ({ ok: true as const }));
    const res = (await executeManageEntities(
      { action: "update", entityId: "e-1", type: "PRODUCT" },
      { context: makeCtx({ update }) },
    )) as { ok: boolean; note: string };
    expect(res.ok).toBe(true);
    expect(res.note).toContain("next generation");
    expect(update).toHaveBeenCalledWith("e-1", { type: "PRODUCT" });
  });

  it("routes a rename — the parity gap the audit flagged", async () => {
    const update = vi.fn(async () => ({ ok: true as const }));
    await executeManageEntities({ action: "update", entityId: "e-1", name: "Aisha" }, { context: makeCtx({ update }) });
    expect(update).toHaveBeenCalledWith("e-1", { name: "Aisha" });
  });

  it("sends name and type together when both were asked for", async () => {
    const update = vi.fn(async () => ({ ok: true as const }));
    await executeManageEntities(
      { action: "update", entityId: "e-1", name: "Sambal bottle", type: "PRODUCT" },
      { context: makeCtx({ update }) },
    );
    expect(update).toHaveBeenCalledWith("e-1", { name: "Sambal bottle", type: "PRODUCT" });
  });

  it("surfaces the action's in-flight refusal verbatim — Otto must not invent a friendlier one", async () => {
    const busy = "A generation using this is still running — wait for it to finish, then change the type.";
    const update = vi.fn(async () => ({ error: busy }));
    const res = await executeManageEntities(
      { action: "update", entityId: "e-1", type: "PRODUCT" },
      { context: makeCtx({ update }) },
    );
    expect(res).toEqual({ ok: false, error: busy });
  });

  it("an older injected port without `update` degrades instead of throwing", async () => {
    const res = await executeManageEntities(
      { action: "update", entityId: "e-1", type: "PRODUCT" },
      { context: makeCtx({ create: vi.fn() as unknown as Port["create"] }) },
    );
    expect(res).toEqual({ ok: false, error: "Element management isn't available right now." });
  });
});

describe("delete / delete_reference_image (debt-09/10)", () => {
  it("delete routes entityId (debt-10)", async () => {
    const remove = vi.fn(async () => ({ ok: true as const }));
    const ctx = makeCtx({ remove });
    expect((await executeManageEntities({ action: "delete" }, { context: ctx })) as { error: string }).toHaveProperty("error");
    expect(await executeManageEntities({ action: "delete", entityId: "e-1" }, { context: ctx })).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledWith("e-1");
  });
  it("delete_reference_image routes refImageId; a not-found error surfaces (debt-09)", async () => {
    const removeReferenceImage = vi.fn(async () => ({ error: "Reference image not found." }));
    const res = (await executeManageEntities(
      { action: "delete_reference_image", refImageId: "r-1" },
      { context: makeCtx({ removeReferenceImage }) },
    )) as { ok: boolean; error: string };
    expect(res).toEqual({ ok: false, error: "Reference image not found." });
    expect(removeReferenceImage).toHaveBeenCalledWith("r-1");
  });
});
