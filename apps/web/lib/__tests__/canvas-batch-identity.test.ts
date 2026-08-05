/**
 * 批次身份的唯一读法(#603 T4 · spec #599 D5)。
 *
 * 这里穷举「服务端落了什么 → 商家看到什么」:字母、组框、能不能并排比。全部只读落盘事实,
 * 一个坐标都不看,一张卡都不数。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  canvasBatchFrameLabel,
  canvasBatchGroups,
  canvasBatchLetter,
  canvasBatchSize,
  canvasCardsComparable,
  canvasComparePair,
  canvasRecordedFacts,
  isCanvasBatchCard,
} from "../canvas-batch-identity";

const batch = (id: string, batchIndex: number, batchSize: number, genJobId = "job-1") => ({
  id, type: "image", genJobId, batchIndex, batchSize, madeFromNodeId: null,
});

describe("the A/B letter", () => {
  it("belongs to the two cards of a two-card press, and to nobody else", () => {
    expect(canvasBatchLetter({ batchIndex: 0, batchSize: 2 })).toBe("A");
    expect(canvasBatchLetter({ batchIndex: 1, batchSize: 2 })).toBe("B");
    expect(canvasBatchLetter({ batchIndex: 0, batchSize: 1 })).toBeNull();
    expect(canvasBatchLetter({ batchIndex: 0, batchSize: 4 })).toBeNull();
    expect(canvasBatchLetter({ batchIndex: 3, batchSize: 4 })).toBeNull();
  });

  it("says nothing when the card was never told where it sits", () => {
    // A card whose paid job no longer exists, an upload, a text note. Unknown draws nothing —
    // the repository's honest-history rule, not a guess (Q13=B「早期作品,来历不详」).
    expect(canvasBatchLetter({ batchSize: 2 })).toBeNull();
    expect(canvasBatchLetter({ batchIndex: null, batchSize: 2 })).toBeNull();
    expect(canvasBatchLetter({ batchIndex: 0, batchSize: null })).toBeNull();
    expect(canvasBatchLetter({})).toBeNull();
  });

  it("refuses positions that cannot be true of the recorded batch", () => {
    expect(canvasBatchLetter({ batchIndex: 2, batchSize: 2 })).toBeNull();
    expect(canvasBatchLetter({ batchIndex: -1, batchSize: 2 })).toBeNull();
    expect(canvasBatchLetter({ batchIndex: 0.5, batchSize: 2 })).toBeNull();
  });
});

describe("how big the batch was", () => {
  it("reads the recorded size, whatever is left on the board", () => {
    expect(canvasBatchSize({ batchSize: 4 })).toBe(4);
    expect(canvasBatchSize({ batchSize: null })).toBeNull();
    expect(canvasBatchSize({ batchSize: 0 })).toBeNull();
  });

  it("calls a card a batch card only when one press made several", () => {
    expect(isCanvasBatchCard({ genJobId: "job-1", batchSize: 4 })).toBe(true);
    expect(isCanvasBatchCard({ genJobId: "job-1", batchSize: 1 })).toBe(false);
    expect(isCanvasBatchCard({ genJobId: null, batchSize: 4 })).toBe(false);
    expect(isCanvasBatchCard({ genJobId: "job-1" })).toBe(false);
  });
});

/**
 * 谁有资格说这四列(#605 r1 判官 P1-1)。
 *
 * 商家按下 Generate 的那一刻,浏览器手里只有「我请求了几张」;服务端还没落盘,那张卡到底是
 * 一批里的第几张、从谁做出来的,都还没有答案。之前那张排队卡把请求参数当成事实写进本地节点,
 * 树、徽章和对比闸照单全收——于是卡还在排队,板上已经写着「Batch of 2」和一条来源线。
 * 落盘之后可能根本不是这样。所以四列只从「板读真的带回过这张卡」的行上读。
 */
describe("the four recorded columns", () => {
  const claimed = {
    genJobId: "job-1", batchIndex: 0, batchSize: 2, madeFromNodeId: "src",
  };

  it("says nothing at all for a card no board read has answered for", () => {
    expect(canvasRecordedFacts(claimed)).toEqual({
      genJobId: null, batchIndex: null, batchSize: null, madeFromNodeId: null,
    });
    expect(canvasRecordedFacts({ ...claimed, serverKnown: false })).toEqual({
      genJobId: null, batchIndex: null, batchSize: null, madeFromNodeId: null,
    });
  });

  it("hands the recorded columns over unchanged once the board read has", () => {
    expect(canvasRecordedFacts({ ...claimed, serverKnown: true })).toEqual(claimed);
  });

  it("leaves a queued card wearing no letter, in no batch and with no source", () => {
    const queued = canvasRecordedFacts(claimed);
    expect(canvasBatchLetter(queued)).toBeNull();
    expect(isCanvasBatchCard(queued)).toBe(false);
    expect(canvasBatchGroups([
      { id: "q0", type: "image", ...canvasRecordedFacts({ ...claimed, batchIndex: 0 }) },
      { id: "q1", type: "image", ...canvasRecordedFacts({ ...claimed, batchIndex: 1 }) },
    ])).toEqual([]);
    expect(canvasCardsComparable(
      { id: "q0", type: "image", ...canvasRecordedFacts({ ...claimed, batchIndex: 0 }) },
      { id: "q1", type: "image", ...canvasRecordedFacts({ ...claimed, batchIndex: 1 }) },
    )).toBe(false);
  });
});

describe("what may be compared side by side", () => {
  it("offers the two cards of a real pair", () => {
    expect(canvasCardsComparable(batch("a", 0, 2), batch("b", 1, 2))).toBe(true);
  });

  it("refuses any two cards of a batch of four — that batch has no A and no B", () => {
    // The gate that was supposed to say this had become dead code: every sibling of a batch
    // pointed at the batch's anchor in the one parentage column, so any pair read as related.
    const four = [batch("a", 0, 4), batch("b", 1, 4), batch("c", 2, 4), batch("d", 3, 4)];
    for (const left of four) {
      for (const right of four) {
        if (left.id === right.id) continue;
        expect(canvasCardsComparable(left, right)).toBe(false);
      }
    }
  });

  it("refuses two survivors of a batch of four, however few are left", () => {
    expect(canvasCardsComparable(batch("a", 0, 4), batch("c", 2, 4))).toBe(false);
  });

  it("refuses a card and the card it was made from — that pair is not an A and a B", () => {
    // 「同一次生成出来的两张」是唯一开门条件(#605 验收②)。母子并排是另一种语义,没有落盘的
    // A/B 序号可依,也从未获批;闸不夹带它。
    const source = { id: "src", type: "image", genJobId: "job-0", batchIndex: 0, batchSize: 1, madeFromNodeId: null };
    const child = { id: "kid", type: "image", genJobId: "job-1", batchIndex: 0, batchSize: 1, madeFromNodeId: "src" };
    expect(canvasCardsComparable(source, child)).toBe(false);
    expect(canvasCardsComparable(child, source)).toBe(false);
  });

  it("never compares an image with a video, or a card with itself", () => {
    expect(canvasCardsComparable(batch("a", 0, 2), { ...batch("b", 1, 2), type: "video" })).toBe(false);
    expect(canvasCardsComparable(batch("a", 0, 2), batch("a", 0, 2))).toBe(false);
  });

  it("never compares cards from two different presses that each made two", () => {
    expect(canvasCardsComparable(batch("a", 0, 2), batch("z", 1, 2, "job-2"))).toBe(false);
  });
});

/**
 * 并排对比时两边各是谁(#605 T6)。
 *
 * 商家截图发给同事说「我选 A」,同事打开必须看到同一张。所以左右两边由落盘序号决定,
 * 跟商家先点哪一张、卡片摆在哪里都无关。
 */
describe("the two sides of a side-by-side compare", () => {
  it("puts the recorded A on the left however the merchant picked them", () => {
    const forward = canvasComparePair(batch("a", 0, 2), batch("b", 1, 2))!;
    const backward = canvasComparePair(batch("b", 1, 2), batch("a", 0, 2))!;

    expect(forward).toEqual(backward);
    expect([forward.left.id, forward.left.label]).toEqual(["a", "A"]);
    expect([forward.right.id, forward.right.label]).toEqual(["b", "B"]);
    expect(forward.title).toBe("Comparing A and B");
  });

  it("has no pair for a card and the card it was made from", () => {
    const source = { id: "src", type: "image", genJobId: "job-0", batchIndex: 0, batchSize: 1, madeFromNodeId: null };
    const child = { id: "kid", type: "image", genJobId: "job-1", batchIndex: 0, batchSize: 1, madeFromNodeId: "src" };

    expect(canvasComparePair(child, source)).toBeNull();
    expect(canvasComparePair(source, child)).toBeNull();
  });

  it("has no pair at all for two cards that were never comparable", () => {
    expect(canvasComparePair(batch("a", 0, 4), batch("c", 2, 4))).toBeNull();
  });
});

describe("the same-batch frame", () => {
  it("groups one press's cards and names the size that was bought", () => {
    const groups = canvasBatchGroups([
      batch("d", 3, 4), batch("a", 0, 4), batch("c", 2, 4), batch("b", 1, 4),
      { id: "lone", type: "image", genJobId: "job-2", batchIndex: 0, batchSize: 1, madeFromNodeId: null },
    ]);

    expect(groups).toEqual([
      { genJobId: "job-1", batchSize: 4, memberIds: ["a", "b", "c", "d"] },
    ]);
    expect(canvasBatchFrameLabel(4)).toBe("Batch of 4");
  });

  it("keeps calling it a batch of four after two of them are deleted", () => {
    const groups = canvasBatchGroups([batch("a", 0, 4), batch("c", 2, 4)]);
    expect(groups).toEqual([{ genJobId: "job-1", batchSize: 4, memberIds: ["a", "c"] }]);
  });

  it("draws no frame around a single survivor — there is nothing to group", () => {
    expect(canvasBatchGroups([batch("a", 0, 4)])).toEqual([]);
  });

  it("draws no frame for cards that never said which batch they belong to", () => {
    expect(canvasBatchGroups([
      { id: "x", type: "image", genJobId: "job-1", batchIndex: null, batchSize: null, madeFromNodeId: null },
      { id: "y", type: "image", genJobId: "job-1", batchIndex: null, batchSize: null, madeFromNodeId: null },
    ])).toEqual([]);
  });
});

/**
 * 那一列真的退场了(#603 T4)。
 *
 * schema 注释宣称 `CanvasNode.sourceNodeId` 自 T4 起「无写入者、无读取者」—— 本仓最主要的
 * 失效机制正是「说的」与「做的」失同步,所以这句话不能只写在注释里。这里逐个文件核:三条
 * 服务端路径的代码正文里不再出现那个名字(注释与字符串除外,它们只是在讲它为什么退场)。
 */
describe("the old three-in-one column has no writer and no reader left", () => {
  const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
  const SERVER_PATHS = [
    "apps/web/lib/canvas-actions.ts",
    "apps/web/lib/canvas-node-placement.ts",
    "apps/web/lib/otto-canvas-bridge.ts",
    "apps/web/lib/canvas-lineage-data.ts",
    "packages/db/src/canvas-settlement.ts",
    "packages/core/src/canvas-settlement-plan.ts",
    "packages/otto/src/skills/manage-canvas.ts",
  ];

  /** File text with block comments, line comments and string literals removed. */
  function codeOf(path: string): string {
    return readFileSync(resolve(REPO, path), "utf8")
      .replace(/\/\*[\s\S]*?\*\//gu, "")
      .replace(/\/\/[^\n]*/gu, "")
      .replace(/`[^`]*`/gu, "``")
      .replace(/"[^"\n]*"/gu, '""')
      .replace(/'[^'\n]*'/gu, "''");
  }

  it.each(SERVER_PATHS)("%s never touches sourceNodeId", (path) => {
    expect(codeOf(path)).not.toContain("sourceNodeId");
  });
});
