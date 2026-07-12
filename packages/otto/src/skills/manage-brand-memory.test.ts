import { describe, it, expect, vi } from "vitest";
import { executeManageBrandMemory, manageBrandMemorySkill } from "./manage-brand-memory.js";
import type { OttoContext } from "../context.js";

// W-B3-D (parity debts 31/32/51 / E1-11,E1-12): the skill routes through ctx.brandMemory — thin
// closures over the same owner-gated brand-memory lifecycle actions the human UI uses. Tests assert
// routing (delete/restore record, delete fact), error pass-through, and $0 gate.

type Port = NonNullable<OttoContext["brandMemory"]>;

function makeCtx(brandMemory?: Partial<Port>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    ...(brandMemory ? { brandMemory: brandMemory as Port } : {}),
  } as unknown as OttoContext;
}

describe("manageBrandMemory gate", () => {
  it("free/write/internal → needsApproval false ($0, soft/reversible deletes)", () => {
    expect(manageBrandMemorySkill.cost).toBe("free");
    expect(manageBrandMemorySkill.effect).toBe("write");
    expect(manageBrandMemorySkill.reach).toBe("internal");
    expect(manageBrandMemorySkill.needsApproval).toBe(false);
  });
});

describe("executeManageBrandMemory — port required", () => {
  it("degrades gracefully when ctx.brandMemory is not injected", async () => {
    const res = await executeManageBrandMemory({ action: "delete_record", id: "r-1" }, { context: makeCtx() });
    expect(res).toEqual({ ok: false, error: "Brand memory isn't available right now." });
  });
});

describe("routing (debt-31/32/51)", () => {
  it("delete_record → deleteRecord (debt-31)", async () => {
    const deleteRecord = vi.fn(async () => ({ ok: true as const }));
    expect(await executeManageBrandMemory({ action: "delete_record", id: "r-1" }, { context: makeCtx({ deleteRecord }) })).toEqual({ ok: true });
    expect(deleteRecord).toHaveBeenCalledWith("r-1");
  });
  it("restore_record → restoreRecord (debt-32, the undo of a delete_record)", async () => {
    const restoreRecord = vi.fn(async () => ({ ok: true as const }));
    expect(await executeManageBrandMemory({ action: "restore_record", id: "r-1" }, { context: makeCtx({ restoreRecord }) })).toEqual({ ok: true });
    expect(restoreRecord).toHaveBeenCalledWith("r-1");
  });
  it("delete_fact → deleteFact; a not-found error surfaces (debt-51)", async () => {
    const deleteFact = vi.fn(async () => ({ error: "Memory not found." }));
    const res = (await executeManageBrandMemory({ action: "delete_fact", id: "m-1" }, { context: makeCtx({ deleteFact }) })) as {
      ok: boolean; error: string;
    };
    expect(res).toEqual({ ok: false, error: "Memory not found." });
    expect(deleteFact).toHaveBeenCalledWith("m-1");
  });
});
