import { describe, it, expect } from "vitest";
import { convoColor, UNATTRIBUTED_COLOR, filterNodesByConvo, convoTabModel } from "../convo-canvas";

describe("convoColor", () => {
  it("is deterministic for a given id", () => {
    expect(convoColor("t1")).toBe(convoColor("t1"));
  });
  it("returns the neutral color for null", () => {
    expect(convoColor(null)).toBe(UNATTRIBUTED_COLOR);
  });
  it("spreads different ids across the palette", () => {
    const colors = new Set(["a", "b", "c", "d", "e"].map(convoColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe("filterNodesByConvo", () => {
  const nodes = [
    { id: "n1", threadId: "t1" },
    { id: "n2", threadId: "t2" },
    { id: "n3", threadId: null },
  ];
  it("returns all nodes when off", () => {
    expect(filterNodesByConvo(nodes, "t1", false)).toHaveLength(3);
  });
  it("returns all nodes when on but no active thread", () => {
    expect(filterNodesByConvo(nodes, null, true)).toHaveLength(3);
  });
  it("keeps only the active convo's nodes when on", () => {
    expect(filterNodesByConvo(nodes, "t1", true).map((n) => n.id)).toEqual(["n1"]);
  });
});

describe("convoTabModel", () => {
  it("marks active + working flags", () => {
    const model = convoTabModel(
      [{ id: "t1", title: "A" }, { id: "t2", title: "B" }],
      "t2",
      new Set(["t1"]),
    );
    expect(model).toEqual([
      { id: "t1", title: "A", active: false, working: true },
      { id: "t2", title: "B", active: true, working: false },
    ]);
  });
});
