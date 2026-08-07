import { describe, expect, it } from "vitest";
import {
  buildCanvasLineageEdges,
  canvasBatchLabel,
  canvasCostLabel,
  canvasLineageRows,
  canvasNodeHasSource,
  canvasSettingsLabel,
  canvasVideoSettings,
} from "../canvas-lineage";
import { normalizeFactoryMaterial } from "../batch-idempotency";

/** The EXACT blob a paid video job persists. Built by the same function startGen uses, so a
 *  hand-written fixture can never agree with a reader that looks at the wrong key
 *  (round-1 review P1-1: the panel read `durationSeconds`, production stores `seconds`). */
const STORED_VIDEO_OPTIONS = normalizeFactoryMaterial({
  prompt: "a cup steaming",
  model: "seedance-2-fast",
  kind: "video",
  count: 1,
  durationSeconds: 10,
  resolution: "720p",
  aspectRatio: "16:9",
}).videoOptions;

describe("canvasVideoSettings", () => {
  it("reads the duration a paid video job actually stored", () => {
    // Guard the fixture itself: if the persisted key is ever renamed, this line says so
    // instead of the reader silently going quiet again.
    expect(STORED_VIDEO_OPTIONS).toMatchObject({ seconds: 10, resolution: "720p", aspectRatio: "16:9" });

    expect(canvasVideoSettings(STORED_VIDEO_OPTIONS)).toEqual({
      durationSeconds: 10,
      resolution: "720p",
      aspectRatio: "16:9",
    });
  });

  it("still reads the older key so an existing card keeps its record", () => {
    expect(canvasVideoSettings({ durationSeconds: 5, resolution: "720p", aspectRatio: "16:9" })).toEqual({
      durationSeconds: 5,
      resolution: "720p",
      aspectRatio: "16:9",
    });
  });

  it("returns nothing rather than junk for malformed or absent options", () => {
    const empty = { durationSeconds: null, resolution: null, aspectRatio: null };
    expect(canvasVideoSettings(null)).toEqual(empty);
    expect(canvasVideoSettings("720p")).toEqual(empty);
    expect(canvasVideoSettings([])).toEqual(empty);
    expect(canvasVideoSettings({ seconds: -1, resolution: "", aspectRatio: 9 })).toEqual(empty);
  });
});

describe("canvasSettingsLabel", () => {
  it("shows only what is known and never names an engine", () => {
    expect(canvasSettingsLabel({ durationSeconds: 5, resolution: "720p", aspectRatio: "16:9" }))
      .toBe("5s · 720p · 16:9");
    expect(canvasSettingsLabel({ durationSeconds: null, resolution: "1080p", aspectRatio: null }))
      .toBe("1080p");
    expect(canvasSettingsLabel({ durationSeconds: null, resolution: null, aspectRatio: null })).toBe("");
  });
});

describe("canvasCostLabel", () => {
  it("prices a single card at what its job charged", () => {
    expect(canvasCostLabel({ costCredits: 1, batchSize: 1 })).toBe("1 credit");
    expect(canvasCostLabel({ costCredits: 8, batchSize: 1 })).toBe("8 credits");
  });

  it("says a batch was charged once, not once per card", () => {
    expect(canvasCostLabel({ costCredits: 4, batchSize: 4 })).toBe("4 credits for this batch of 4");
  });

  it("admits when no charge is recorded instead of showing a zero", () => {
    expect(canvasCostLabel({ costCredits: null, batchSize: 1 })).toBe("Cost not recorded");
  });

  it("says a dropped-in image was free, not that its record is missing", () => {
    expect(canvasCostLabel({ costCredits: 0, batchSize: 1 })).toBe("No charge");
  });
});

describe("canvasBatchLabel", () => {
  it("places a card inside its batch, and stays silent for a lone card", () => {
    expect(canvasBatchLabel({ batchSize: 4, batchPosition: 2 })).toBe("Image 2 of 4");
    expect(canvasBatchLabel({ batchSize: 1, batchPosition: 1 })).toBe("");
    expect(canvasBatchLabel({ batchSize: 4, batchPosition: null })).toBe("");
  });
});

/**
 * "Made from" vs "made alongside" (round-1 review P2-2 · #603 T4).
 *
 * These two used to share one column, `CanvasNode.sourceNodeId`: the card a generation was
 * really made from (image → video, an edited prompt) AND the anchor a batch's siblings are laid
 * out around. Telling them apart needed a SECOND server field to vote on which meaning this row
 * happened to carry, and a failed read of that field turned a whole batch into a family tree.
 * The two facts now live in two columns, so there is nothing left to disambiguate:
 * `madeFromNodeId` is written only from the paid job's own recorded source.
 */
describe("canvasNodeHasSource", () => {
  it("says yes for a video made from an image", () => {
    expect(canvasNodeHasSource({ madeFromNodeId: "img" })).toBe(true);
  });

  it("says no for a batch sibling — standing beside the anchor is not coming out of it", () => {
    expect(canvasNodeHasSource({ layoutAnchorNodeId: "primary" } as never)).toBe(false);
  });

  it("says no for a card with nothing to point at", () => {
    expect(canvasNodeHasSource({ madeFromNodeId: null })).toBe(false);
    expect(canvasNodeHasSource({})).toBe(false);
  });
});

describe("canvasLineageRows", () => {
  it("carries time, settings and cost — the three things a card used to lose (#547 B4)", () => {
    const rows = canvasLineageRows(
      {
        madeAtLabel: "Jul 30, 2:15 PM",
        settings: { durationSeconds: 5, resolution: "720p", aspectRatio: "16:9" },
        costCredits: 8,
        batchSize: 1,
        batchPosition: 1,
      },
      { hasSource: true },
    );

    expect(rows).toEqual([
      { label: "Made", value: "Jul 30, 2:15 PM" },
      { label: "Settings", value: "5s · 720p · 16:9" },
      { label: "Cost", value: "8 credits" },
      { label: "Made from", value: "the card it is joined to" },
    ]);
  });

  it("drops rows it has no fact for, and always states the cost", () => {
    const rows = canvasLineageRows({
      madeAtLabel: null,
      settings: { durationSeconds: null, resolution: null, aspectRatio: null },
      costCredits: null,
      batchSize: 1,
      batchPosition: null,
    });

    expect(rows).toEqual([{ label: "Cost", value: "Cost not recorded" }]);
  });
});

describe("buildCanvasLineageEdges", () => {
  it("joins a video to the image it was made from", () => {
    expect(buildCanvasLineageEdges([
      { id: "img", madeFromNodeId: null },
      { id: "vid", madeFromNodeId: "img" },
    ])).toEqual([{ id: "lineage-img-vid", source: "img", target: "vid" }]);
  });

  it("chains an evolved image back through its whole ancestry", () => {
    const edges = buildCanvasLineageEdges([
      { id: "a", madeFromNodeId: null },
      { id: "b", madeFromNodeId: "a" },
      { id: "c", madeFromNodeId: "b" },
    ]);

    expect(edges.map((edge) => [edge.source, edge.target])).toEqual([["a", "b"], ["b", "c"]]);
  });

  it("leaves one batch's cards unjoined — they are siblings, not parent and child", () => {
    // Four images from ONE "make 4" press. Each sibling records the batch's anchor as the card
    // it was laid out around, and that fact is in a column this function does not read at all.
    const batch = ["b", "c", "d"].map((id) => ({
      id,
      layoutAnchorNodeId: "a",
      madeFromNodeId: null,
    }));

    expect(buildCanvasLineageEdges([{ id: "a", madeFromNodeId: null }, ...batch])).toEqual([]);
  });

  it("draws every card of an EDITED batch back to the picture it was built on", () => {
    // "More like this" on card `src`, four images out. All four really were made from `src` —
    // that is a fact of the paid job, so every card of the batch carries it — while their
    // arrangement around the batch anchor stays in its own column and draws nothing.
    const batch = ["b", "c", "d"].map((id) => ({ id, madeFromNodeId: "src", layoutAnchorNodeId: "a" }));

    const edges = buildCanvasLineageEdges([
      { id: "src", madeFromNodeId: null },
      { id: "a", madeFromNodeId: "src" },
      ...batch,
    ]);

    expect(edges.map((edge) => [edge.source, edge.target])).toEqual([
      ["src", "a"], ["src", "b"], ["src", "c"], ["src", "d"],
    ]);
  });

  it("still joins a card this browser just made, before any board read", () => {
    // "Make video" places the new card carrying the card it was built on, so the line appears
    // now rather than after the next board read (r2 review: 完成即见谱系).
    expect(buildCanvasLineageEdges([
      { id: "img", madeFromNodeId: null },
      { id: "vid", madeFromNodeId: "img" },
    ])).toEqual([{ id: "lineage-img-vid", source: "img", target: "vid" }]);
  });

  it("never draws a line to a card that is not on the board", () => {
    expect(buildCanvasLineageEdges([
      { id: "vid", madeFromNodeId: "deleted-image" },
    ])).toEqual([]);
  });

  it("ignores a card that points at itself", () => {
    expect(buildCanvasLineageEdges([
      { id: "a", madeFromNodeId: "a" },
    ])).toEqual([]);
  });
});
