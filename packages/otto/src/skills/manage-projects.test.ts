import { describe, it, expect, vi } from "vitest";
import { executeManageProjects, manageProjectsSkill } from "./manage-projects.js";
import type { OttoContext } from "../context.js";

// W-B3-D (parity debts 03-07 / B0-10): the skill routes EVERY operation through the injected
// ctx.projects port — thin closures over the same owner-gated campaign server actions the human
// sidebar uses. Tests mock the port and assert routing, missing-param guards, the delete safety
// (explicit projectId required — never guess), and $0 gate.

type Port = NonNullable<OttoContext["projects"]>;

function makeCtx(projects?: Partial<Port>): OttoContext {
  return {
    orgId: "org-test",
    userId: "user-test",
    projectId: "proj-test",
    threadId: "thread-test",
    disabledModels: [],
    ...(projects ? { projects: projects as Port } : {}),
  } as unknown as OttoContext;
}

describe("manageProjects registration hygiene", () => {
  it("instructions.ts carries the model-facing 'When to call' entry (REVIEWER-PLAYBOOK:107)", async () => {
    const { ottoInstructions } = await import("../instructions.js");
    expect(ottoInstructions).toContain("When to call \`manageProjects\`");
  });
});

describe("manageProjects gate", () => {
  it("free/write/internal → needsApproval false ($0 campaign surface, same as the human sidebar)", () => {
    expect(manageProjectsSkill.cost).toBe("free");
    expect(manageProjectsSkill.effect).toBe("write");
    expect(manageProjectsSkill.reach).toBe("internal");
    expect(manageProjectsSkill.needsApproval).toBe(false);
  });
});

describe("executeManageProjects — port required", () => {
  it("degrades gracefully when ctx.projects is not injected (minimal worker ctx)", async () => {
    const res = await executeManageProjects({ action: "get_default" }, { context: makeCtx() });
    expect(res).toEqual({ ok: false, error: "Campaign management isn't available right now." });
  });
});

describe("get_default / create", () => {
  it("get_default returns the default campaign id (debt-03)", async () => {
    const getDefault = vi.fn(async () => ({ id: "p-default" }));
    const res = await executeManageProjects({ action: "get_default" }, { context: makeCtx({ getDefault }) });
    expect(res).toEqual({ ok: true, projectId: "p-default" });
  });
  it("create needs a name, then routes it (debt-04)", async () => {
    const create = vi.fn(async () => ({ id: "p-new" }));
    const ctx = makeCtx({ create });
    const missing = (await executeManageProjects({ action: "create" }, { context: ctx })) as { error: string };
    expect(missing.error).toContain("name");
    expect(create).not.toHaveBeenCalled();
    const res = await executeManageProjects({ action: "create", name: "Ramadan launch" }, { context: ctx });
    expect(res).toEqual({ ok: true, projectId: "p-new" });
    expect(create).toHaveBeenCalledWith("Ramadan launch");
  });
});

describe("rename / set_pinned", () => {
  it("rename routes projectId + name; missing params are named (debt-06)", async () => {
    const rename = vi.fn(async () => ({ ok: true as const, name: "Q3 push" }));
    const ctx = makeCtx({ rename });
    expect((await executeManageProjects({ action: "rename", name: "x" }, { context: ctx })) as { error: string }).toHaveProperty("error");
    const res = await executeManageProjects({ action: "rename", projectId: "p1", name: "Q3 push" }, { context: ctx });
    expect(res).toEqual({ ok: true, name: "Q3 push" });
    expect(rename).toHaveBeenCalledWith("p1", "Q3 push");
  });
  it("set_pinned routes projectId + pinned; false is honored (not treated as missing) (debt-07)", async () => {
    const setPinned = vi.fn(async () => ({ ok: true as const, pinnedAt: null }));
    const ctx = makeCtx({ setPinned });
    const res = await executeManageProjects({ action: "set_pinned", projectId: "p1", pinned: false }, { context: ctx });
    expect(res).toEqual({ ok: true, pinnedAt: null });
    expect(setPinned).toHaveBeenCalledWith("p1", false);
  });
});

describe("delete — PERMANENT, never guesses (debt-05)", () => {
  it("refuses without an explicit projectId (won't delete an implicit/default campaign)", async () => {
    const remove = vi.fn(async () => ({ ok: true as const }));
    const res = (await executeManageProjects({ action: "delete" }, { context: makeCtx({ remove }) })) as { error: string };
    expect(res.error).toContain("won't guess");
    expect(remove).not.toHaveBeenCalled();
  });
  it("routes an explicit id; the guarded action's error (running generation) surfaces intact", async () => {
    const ok = vi.fn(async () => ({ ok: true as const }));
    expect(await executeManageProjects({ action: "delete", projectId: "p1" }, { context: makeCtx({ remove: ok }) })).toEqual({ ok: true });
    expect(ok).toHaveBeenCalledWith("p1");
    const busy = vi.fn(async () => ({ error: "A generation is still running in this campaign. Delete it after the generation finishes." }));
    const res = (await executeManageProjects({ action: "delete", projectId: "p1" }, { context: makeCtx({ remove: busy }) })) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("still running");
  });
});
