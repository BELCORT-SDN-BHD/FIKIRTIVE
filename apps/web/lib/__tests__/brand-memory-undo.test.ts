import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  type BrandMemoryUndoActions,
  type BrandMemoryUndoDiff,
  undoBrandMemoryDiff,
} from "@/lib/brand-memory-undo";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import type { MemoryRow } from "@/lib/memory-actions";

const NOW = new Date("2026-08-27T00:00:00.000Z");

function memory(id: string, content: string): MemoryRow {
  return { id, category: "about", content, source: "otto", pinned: true, updatedAt: NOW };
}

function record(id: string, name: string, status: "active" | "archived" = "active"): BrandRecordRow {
  return {
    id,
    kind: "product",
    data: { name },
    status,
    startsAt: null,
    endsAt: null,
    source: "otto",
    pinned: false,
    updatedAt: NOW,
  };
}

const DIFF: BrandMemoryUndoDiff = {
  facts: {
    added: [memory("fact-added", "New fact")],
    changed: [{
      before: memory("fact-changed", "Original fact"),
      after: memory("fact-changed", "Changed fact"),
    }],
    removed: [memory("fact-removed", "Removed fact")],
  },
  records: {
    added: [record("record-added", "New product")],
    changed: [{
      before: { ...record("record-changed", "Original product", "archived"), startsAt: NOW, endsAt: NOW },
      after: record("record-changed", "Changed product"),
    }],
    removed: [record("record-removed", "Removed product")],
  },
};

function actions(): BrandMemoryUndoActions {
  return {
    deleteMemory: vi.fn(async () => ({ ok: true as const })),
    updateMemory: vi.fn(async () => ({ ok: true as const })),
    restoreMemory: vi.fn(async () => ({ ok: true as const })),
    deleteBrandRecord: vi.fn(async () => ({ ok: true as const })),
    saveBrandRecord: vi.fn(async () => ({ ok: true as const, id: "record-changed" })),
    restoreBrandRecord: vi.fn(async () => ({ ok: true as const })),
  };
}

describe("undoBrandMemoryDiff", () => {
  it("maps every diff shape to its stable reverse action and restores removed facts by id", async () => {
    const undoActions = actions();
    expect(await undoBrandMemoryDiff(DIFF, undoActions)).toBeNull();

    expect(undoActions.deleteMemory).toHaveBeenCalledWith({ id: "fact-added" });
    expect(undoActions.updateMemory).toHaveBeenCalledWith({ id: "fact-changed", content: "Original fact" });
    expect(undoActions.restoreMemory).toHaveBeenCalledWith({ id: "fact-removed" });
    expect(undoActions.deleteBrandRecord).toHaveBeenCalledWith({ id: "record-added" });
    expect(undoActions.saveBrandRecord).toHaveBeenCalledWith({
      id: "record-changed",
      kind: "product",
      data: { name: "Original product" },
      status: "archived",
      startsAt: "2026-08-27",
      endsAt: "2026-08-27",
    });
    expect(undoActions.restoreBrandRecord).toHaveBeenCalledWith({ id: "record-removed" });
  });

  it("waits for the whole batch and reports both server refusals and connection failures", async () => {
    const undoActions = actions();
    vi.mocked(undoActions.restoreMemory).mockResolvedValue({ error: "Memory not found." });
    vi.mocked(undoActions.deleteBrandRecord).mockRejectedValue(new Error("offline"));

    const failure = await undoBrandMemoryDiff(DIFF, undoActions);

    expect(failure).toContain("2 changes couldn't be restored.");
    expect(failure).toContain("Memory not found.");
    expect(failure).toContain("A connection failed while restoring a change.");
    expect(undoActions.restoreBrandRecord).toHaveBeenCalledTimes(1);
  });

  it("returns the precise refusal when only one reverse action fails", async () => {
    const undoActions = actions();
    vi.mocked(undoActions.updateMemory).mockResolvedValue({ error: "Memory not found." });
    expect(await undoBrandMemoryDiff(DIFF, undoActions)).toBe("Memory not found.");
  });

  it("keeps the parent diff until every action and refresh has succeeded", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../components/otto/OttoMemory.tsx"),
      "utf8",
    );
    const refusal = source.indexOf("if (failure) return failure;");
    const refresh = source.indexOf("const [restoredMemory, restoredRecords] = await Promise.all");
    const clear = source.indexOf("setLastDiff(null);", refresh);

    expect(source).toContain("undoBrandMemoryDiff(lastDiff");
    expect(source).toContain("key={undoKey}");
    expect(refusal).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(refusal);
    expect(clear).toBeGreaterThan(refresh);
  });
});
