import { describe, expect, it } from "vitest";
import {
  buildCanvasLineageEdges,
  canvasBatchLabel,
  canvasCostLabel,
  canvasLineageRows,
  canvasSettingsLabel,
  canvasVideoSettings,
} from "../canvas-lineage";

describe("canvasVideoSettings", () => {
  it("reads duration, resolution and aspect out of a stored video options blob", () => {
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
    expect(canvasVideoSettings({ durationSeconds: -1, resolution: "", aspectRatio: 9 })).toEqual(empty);
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
      { id: "img", sourceNodeId: null },
      { id: "vid", sourceNodeId: "img" },
    ])).toEqual([{ id: "lineage-img-vid", source: "img", target: "vid" }]);
  });

  it("chains an evolved image back through its whole ancestry", () => {
    const edges = buildCanvasLineageEdges([
      { id: "a", sourceNodeId: null },
      { id: "b", sourceNodeId: "a" },
      { id: "c", sourceNodeId: "b" },
    ]);

    expect(edges.map((edge) => [edge.source, edge.target])).toEqual([["a", "b"], ["b", "c"]]);
  });

  it("never draws a line to a card that is not on the board", () => {
    expect(buildCanvasLineageEdges([{ id: "vid", sourceNodeId: "deleted-image" }])).toEqual([]);
  });

  it("ignores a card that points at itself", () => {
    expect(buildCanvasLineageEdges([{ id: "a", sourceNodeId: "a" }])).toEqual([]);
  });
});
