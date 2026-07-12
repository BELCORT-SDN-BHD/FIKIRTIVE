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
