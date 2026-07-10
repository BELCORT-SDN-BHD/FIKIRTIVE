import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
vi.mock("@/lib/auth-guard", () => ({ requireOwner: vi.fn() }));
vi.mock("@fikirtive/db", () => ({ prisma: {
  generation: { findFirst: vi.fn() },
  actionEvent: { create: vi.fn(), findMany: vi.fn() },
} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { recordGenerationOutcome } from "@/lib/actions";
import { getRecentOutcomes } from "@/lib/data";
import { requireOwner } from "@/lib/auth-guard";
import { prisma } from "@fikirtive/db";
beforeEach(() => vi.clearAllMocks());

describe("recordGenerationOutcome", () => {
  it("fails closed with no owner", async () => {
    (requireOwner as Mock).mockResolvedValue({ error: "Not signed in." });
    expect(await recordGenerationOutcome("g1", true, "x")).toEqual({ error: "Not signed in." });
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
  });
  it("rejects a generation the caller does not own", async () => {
    (requireOwner as Mock).mockResolvedValue({ ownerId: "o1", email: "a@b.c" });
    (prisma.generation.findFirst as Mock).mockResolvedValue(null);
    expect(await recordGenerationOutcome("g1", true, "x")).toEqual({ error: "Generation not found." });
    expect(prisma.actionEvent.create).not.toHaveBeenCalled();
  });
  it("logs an append-only outcome for an owned generation", async () => {
    (requireOwner as Mock).mockResolvedValue({ ownerId: "o1", email: "a@b.c" });
    (prisma.generation.findFirst as Mock).mockResolvedValue({ id: "g1", projectId: "p1" });
    expect(await recordGenerationOutcome("g1", true, "  sold better  ")).toEqual({ ok: true });
    const arg = (prisma.actionEvent.create as Mock).mock.calls[0][0].data;
    expect(arg).toMatchObject({ ownerId: "o1", type: "generation.outcome", projectId: "p1" });
    expect(arg.payload).toMatchObject({ generationId: "g1", posted: true, result: "sold better" });
  });
});

describe("getRecentOutcomes", () => {
  it("returns this owner's outcomes newest-first", async () => {
    (requireOwner as Mock).mockResolvedValue({ ownerId: "o1", email: "a@b.c" });
    (prisma.actionEvent.findMany as Mock).mockResolvedValue([
      { payload: { generationId: "g2", posted: true, result: "great" }, createdAt: new Date("2026-06-22T02:00:00Z") },
    ]);
    const r = await getRecentOutcomes();
    expect(r[0]).toMatchObject({ generationId: "g2", posted: true, result: "great" });
    expect((prisma.actionEvent.findMany as Mock).mock.calls[0][0].where).toMatchObject({ ownerId: "o1", type: "generation.outcome" });
  });
});
