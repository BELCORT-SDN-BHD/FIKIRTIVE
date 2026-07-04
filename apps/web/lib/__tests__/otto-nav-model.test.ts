import { describe, expect, it } from "vitest";
import type { ChatThreadDTO } from "@/lib/types";
import { buildOttoNavEntries } from "../../components/otto/otto-nav-model";

function thread(id: string, projectId: string, title: string, updatedAt: string): ChatThreadDTO {
  return { id, projectId, title, updatedAt, messages: [], status: null };
}

describe("buildOttoNavEntries", () => {
  it("shows a default single-thread campaign as one history row, not a duplicate project group", () => {
    const entries = buildOttoNavEntries({
      projects: [{ id: "p1", name: "New campaign" }],
      sidebarThreads: [thread("t1", "p1", "Oat Milk Launch", "2026-07-04T10:00:00.000Z")],
      activeProjectId: "p1",
      activeThreadId: "t1",
      projectLimit: 10,
      threadLimit: 6,
    });

    expect(entries).toEqual([
      { kind: "thread", project: { id: "p1", name: "New campaign" }, thread: expect.objectContaining({ id: "t1", title: "Oat Milk Launch" }) },
    ]);
  });

  it("hides a single child row when the project and thread already have the same visible name", () => {
    const entries = buildOttoNavEntries({
      projects: [{ id: "p1", name: "Oat Milk Launch" }],
      sidebarThreads: [thread("t1", "p1", "Oat   Milk Launch", "2026-07-04T10:00:00.000Z")],
      activeProjectId: "p1",
      activeThreadId: "t1",
      projectLimit: 10,
      threadLimit: 6,
    });

    expect(entries).toEqual([
      {
        kind: "project",
        project: { id: "p1", name: "Oat Milk Launch" },
        threads: [],
        defaultThread: expect.objectContaining({ id: "t1" }),
      },
    ]);
  });

  it("keeps the active project visible even when the activity-sorted list is capped", () => {
    const entries = buildOttoNavEntries({
      projects: [
        { id: "old", name: "Old" },
        { id: "hot", name: "Hot" },
        { id: "active", name: "Active" },
      ],
      sidebarThreads: [
        thread("t-hot", "hot", "Newest", "2026-07-04T12:00:00.000Z"),
        thread("t-old", "old", "Older", "2026-07-04T11:00:00.000Z"),
      ],
      activeProjectId: "active",
      activeThreadId: null,
      projectLimit: 2,
      threadLimit: 6,
    });

    expect(entries.map((e) => e.project.id)).toContain("active");
    expect(entries).toHaveLength(2);
  });
});
