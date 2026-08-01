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
 * "Made from" vs "made alongside" (round-1 review P2-2).
 *
 * CanvasNode.sourceNodeId carries TWO different things: the card a generation was really made
 * from (image → video, or an edited prompt), and the anchor card a batch's siblings are laid
 * out around. Only the first is parentage. The paid job itself settles which one it is —
 * GenJob.sourceGenerationId is set only when the job was actually conditioned on another
 * card's output — so the record decides, not the column.
 */
describe("canvasNodeHasSource", () => {
  const madeFrom = { madeFromSource: true };
  const sameBatch = { madeFromSource: false };

  it("says yes for a video made from an image", () => {
    expect(canvasNodeHasSource({ sourceNodeId: "img", lineage: madeFrom })).toBe(true);
  });

  it("says no for a batch sibling that merely sits with the batch's first card", () => {
    expect(canvasNodeHasSource({ sourceNodeId: "primary", lineage: sameBatch })).toBe(false);
  });

  it("says no for a card with nothing to point at", () => {
    expect(canvasNodeHasSource({ sourceNodeId: null, lineage: madeFrom })).toBe(false);
    expect(canvasNodeHasSource({})).toBe(false);
  });

  it("trusts this session's own source action before the server record arrives", () => {
    // A just-placed 'Make video' card has no server record yet, but the browser only sets
    // sourceNodeId when it passed that card's generation to the paid call.
    expect(canvasNodeHasSource({ sourceNodeId: "img", lineage: null })).toBe(true);
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
        madeFromSource: true,
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
      madeFromSource: false,
    });

    expect(rows).toEqual([{ label: "Cost", value: "Cost not recorded" }]);
  });
});

describe("buildCanvasLineageEdges", () => {
  it("joins a video to the image it was made from", () => {
    expect(buildCanvasLineageEdges([
      { id: "img", sourceNodeId: null },
      { id: "vid", sourceNodeId: "img", lineage: { madeFromSource: true } },
    ])).toEqual([{ id: "lineage-img-vid", source: "img", target: "vid" }]);
  });

  it("chains an evolved image back through its whole ancestry", () => {
    const edges = buildCanvasLineageEdges([
      { id: "a", sourceNodeId: null },
      { id: "b", sourceNodeId: "a", lineage: { madeFromSource: true } },
      { id: "c", sourceNodeId: "b", lineage: { madeFromSource: true } },
    ]);

    expect(edges.map((edge) => [edge.source, edge.target])).toEqual([["a", "b"], ["b", "c"]]);
  });

  it("leaves one batch's cards unjoined — they are siblings, not parent and child", () => {
    // Four images from ONE "make 4" press. Each sibling row stores the batch's first card as
    // its layout anchor, which used to be drawn as "this one came from that one".
    const batch = ["b", "c", "d"].map((id) => ({
      id,
      sourceNodeId: "a",
      lineage: { madeFromSource: false },
    }));

    expect(buildCanvasLineageEdges([{ id: "a", sourceNodeId: null }, ...batch])).toEqual([]);
  });

  it("never draws a line to a card that is not on the board", () => {
    expect(buildCanvasLineageEdges([
      { id: "vid", sourceNodeId: "deleted-image", lineage: { madeFromSource: true } },
    ])).toEqual([]);
  });

  it("ignores a card that points at itself", () => {
    expect(buildCanvasLineageEdges([
      { id: "a", sourceNodeId: "a", lineage: { madeFromSource: true } },
    ])).toEqual([]);
  });
});
