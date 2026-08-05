/**
 * 血缘树读的是落盘事实,不是画布上的样子(#605 T6 · spec #599 D8)。
 *
 * 树上每一条线都必须能指回一列数据:`madeFromNodeId` 说「这张是从那张做出来的」,
 * `genJobId` + `batchIndex` + `batchSize` 说「这几张是一次生成出来的兄弟」。坐标、卡片
 * 在数组里的先后、板上还剩几张——一律不参与。
 *
 * 三条诚实规则一并锁死:
 *   · 母卡不在板上(被删、被筛掉、根本不属于这个商家)⇒ 说「不在这块板上」,不画一条通往
 *     不存在的卡的线,也不改口说这张是原创。
 *   · `madeFromNodeId` 为 NULL 是「没记下来」,不是「这是原创」——T4 的回填规则里「验不上」
 *     写的就是 NULL,所以树只能说没有记录。
 *   · 批次序号没记下来 ⇒ 位置留空,不按顺序补一个。
 */
import { describe, expect, it } from "vitest";
import { buildCanvasLineageTree, type CanvasLineageTreeCard } from "../canvas-lineage-tree";

function card(over: Partial<CanvasLineageTreeCard> & { id: string }): CanvasLineageTreeCard {
  return {
    type: "image",
    prompt: `prompt for ${over.id}`,
    genJobId: null,
    batchIndex: null,
    batchSize: null,
    madeFromNodeId: null,
    ...over,
  };
}

describe("what a card records about where it came from", () => {
  it("has nothing to show for a card the board does not carry", () => {
    expect(buildCanvasLineageTree([card({ id: "a" })], "missing")).toBeNull();
  });

  it("says the source was never recorded rather than calling the card an original", () => {
    const tree = buildCanvasLineageTree([card({ id: "a" })], "a")!;
    expect(tree.origin).toBe("not-recorded");
    expect(tree.chain.map((row) => row.id)).toEqual(["a"]);
    expect(tree.descendants).toEqual([]);
    expect(tree.batch).toBeNull();
  });

  it("walks the recorded chain up to the top, oldest first", () => {
    const tree = buildCanvasLineageTree(
      [
        card({ id: "root" }),
        card({ id: "middle", madeFromNodeId: "root" }),
        card({ id: "leaf", type: "video", madeFromNodeId: "middle" }),
      ],
      "leaf",
    )!;
    expect(tree.origin).toBe("on-board");
    expect(tree.chain.map((row) => row.id)).toEqual(["root", "middle", "leaf"]);
    expect(tree.chain.map((row) => row.depth)).toEqual([0, 1, 2]);
    expect(tree.chain.at(-1)!.isFocus).toBe(true);
    expect(tree.chain.at(-1)!.kind).toBe("Video");
  });

  it("says so when the recorded source is not on this board — and draws nothing for it", () => {
    const tree = buildCanvasLineageTree([card({ id: "a", madeFromNodeId: "gone" })], "a")!;
    expect(tree.origin).toBe("off-board");
    expect(tree.chain.map((row) => row.id)).toEqual(["a"]);
  });

  it("stops at a chain that points back at itself instead of looping for ever", () => {
    const tree = buildCanvasLineageTree(
      [card({ id: "a", madeFromNodeId: "b" }), card({ id: "b", madeFromNodeId: "a" })],
      "a",
    )!;
    expect(tree.chain.map((row) => row.id)).toEqual(["b", "a"]);
  });
});

describe("what was made from this card", () => {
  it("lists them, and what they in turn made, deepest last", () => {
    const tree = buildCanvasLineageTree(
      [
        card({ id: "a" }),
        card({ id: "b", madeFromNodeId: "a" }),
        card({ id: "c", type: "video", madeFromNodeId: "b" }),
      ],
      "a",
    )!;
    expect(tree.descendants.map((row) => [row.id, row.depth])).toEqual([["b", 1], ["c", 2]]);
  });

  it("never counts a batch sibling as something this card made", () => {
    const batch = (id: string, index: number) =>
      card({ id, genJobId: "job-1", batchIndex: index, batchSize: 4 });
    const tree = buildCanvasLineageTree(
      [batch("b0", 0), batch("b1", 1), batch("b2", 2), batch("b3", 3)],
      "b0",
    )!;
    expect(tree.descendants).toEqual([]);
    expect(tree.origin).toBe("not-recorded");
  });
});

describe("the cards of one paid press", () => {
  const batch = (id: string, index: number, size: number) =>
    card({ id, genJobId: "job-1", batchIndex: index, batchSize: size });

  it("lists them in the order the press recorded, whatever order the board hands them over", () => {
    const tree = buildCanvasLineageTree(
      [batch("b2", 2, 4), batch("b0", 0, 4), batch("b3", 3, 4), batch("b1", 1, 4)],
      "b0",
    )!;
    expect(tree.batch!.rows.map((row) => row.id)).toEqual(["b0", "b1", "b2", "b3"]);
    expect(tree.batch!.rows.map((row) => row.batchPosition)).toEqual([
      "1 of 4", "2 of 4", "3 of 4", "4 of 4",
    ]);
  });

  it("keeps saying how many were bought after some are removed", () => {
    const tree = buildCanvasLineageTree([batch("b0", 0, 4), batch("b2", 2, 4)], "b0")!;
    expect(tree.batch!.size).toBe(4);
    expect(tree.batch!.rows.map((row) => row.id)).toEqual(["b0", "b2"]);
  });

  it("gives A and B only to a press that really made two", () => {
    const pair = buildCanvasLineageTree([batch("p0", 0, 2), batch("p1", 1, 2)], "p0")!;
    expect(pair.batch!.rows.map((row) => row.letter)).toEqual(["A", "B"]);

    const four = buildCanvasLineageTree([batch("b0", 0, 4), batch("b1", 1, 4)], "b0")!;
    expect(four.batch!.rows.map((row) => row.letter)).toEqual([null, null]);
  });

  it("draws no batch at all for a card that was the only thing its press made", () => {
    expect(buildCanvasLineageTree([batch("solo", 0, 1)], "solo")!.batch).toBeNull();
  });

  it("leaves the position blank when the press never recorded one", () => {
    const tree = buildCanvasLineageTree(
      [
        card({ id: "known", genJobId: "job-1", batchIndex: 0, batchSize: 2 }),
        card({ id: "unrecorded", genJobId: "job-1", batchIndex: null, batchSize: 2 }),
      ],
      "known",
    )!;
    const unrecorded = tree.batch!.rows.find((row) => row.id === "unrecorded")!;
    expect(unrecorded.batchPosition).toBeNull();
    expect(unrecorded.letter).toBeNull();
  });

  it("never lets a coordinate or an array order become a batch position", () => {
    // The same two cards, handed over in the opposite order, and with the "later" one first.
    const forward = buildCanvasLineageTree([batch("p0", 0, 2), batch("p1", 1, 2)], "p1")!;
    const backward = buildCanvasLineageTree([batch("p1", 1, 2), batch("p0", 0, 2)], "p1")!;
    expect(forward.batch!.rows).toEqual(backward.batch!.rows);
    expect(backward.batch!.rows.map((row) => [row.id, row.letter])).toEqual([
      ["p0", "A"], ["p1", "B"],
    ]);
  });
});
