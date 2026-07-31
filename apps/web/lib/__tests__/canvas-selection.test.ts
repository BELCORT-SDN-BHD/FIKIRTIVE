import { describe, expect, it } from "vitest";
import {
  canvasBatchDeleteCopy,
  canvasBatchSelection,
  canvasDownloadFileName,
  canvasFileExtension,
  canvasFileStem,
} from "../canvas-selection";

describe("canvasFileStem", () => {
  it("turns a prompt into a readable file name", () => {
    expect(canvasFileStem("Red sneakers on wet sand", "image")).toBe("red-sneakers-on-wet-sand");
  });

  it("falls back to the card type when there is no usable prompt", () => {
    expect(canvasFileStem("", "image")).toBe("image");
    expect(canvasFileStem("   ***   ", "video")).toBe("video");
    expect(canvasFileStem(null, "image")).toBe("image");
  });

  it("keeps the name short and never ends on a separator", () => {
    const stem = canvasFileStem("a".repeat(80), "image");
    expect(stem.length).toBeLessThanOrEqual(40);
    expect(stem.endsWith("-")).toBe(false);
  });
});

describe("canvasFileExtension", () => {
  it("saves media under the extension the stored file actually has", () => {
    expect(canvasFileExtension("https://cdn.example/a/b.webp", "image")).toBe("webp");
    expect(canvasFileExtension("https://cdn.example/a/b.mp4?sig=abc", "video")).toBe("mp4");
  });

  it("falls back by card type when the URL carries no usable extension", () => {
    expect(canvasFileExtension("https://cdn.example/asset", "image")).toBe("png");
    expect(canvasFileExtension("https://cdn.example/asset", "video")).toBe("mp4");
    expect(canvasFileExtension("https://cdn.example/a.tar.gz", "image")).toBe("png");
  });
});

describe("canvasBatchSelection", () => {
  it("collects every selected card that actually has media to download", () => {
    const selection = canvasBatchSelection([
      { id: "1", type: "image", url: "https://cdn.example/one.png", prompt: "sneaker" },
      { id: "2", type: "video", url: "https://cdn.example/two.mp4", prompt: "sneaker" },
      { id: "3", type: "image", url: null, prompt: "still generating" },
      { id: "4", type: "text", url: "https://cdn.example/no.png", prompt: "note" },
    ]);

    expect(selection.count).toBe(4);
    expect(selection.ids).toEqual(["1", "2", "3", "4"]);
    expect(selection.downloads.map((item) => item.fileName)).toEqual(["sneaker-1.png", "sneaker-2.mp4"]);
  });

  it("counts the paid cards still in flight so the confirm can warn about them", () => {
    const selection = canvasBatchSelection([
      { id: "1", type: "image", url: "https://cdn.example/one.png", inFlightPaid: false },
      { id: "2", type: "video", url: null, inFlightPaid: true },
    ]);

    expect(selection.inFlightPaidCount).toBe(1);
  });

  it("numbers downloads so a batch from one prompt does not collide", () => {
    const node = { id: "1", type: "image" as const, prompt: "same prompt" };
    expect(canvasDownloadFileName(node, 0, "https://cdn.example/a.png")).toBe("same-prompt-1.png");
    expect(canvasDownloadFileName(node, 1, "https://cdn.example/b.png")).toBe("same-prompt-2.png");
  });
});

describe("canvasBatchDeleteCopy", () => {
  it("says plainly what removing settled cards does", () => {
    const copy = canvasBatchDeleteCopy({ count: 3, inFlightPaidCount: 0 });
    expect(copy.title).toBe("Remove 3 cards from canvas?");
    expect(copy.description).toContain("stays saved in your library");
  });

  it("warns that removing an in-flight paid card does not refund it", () => {
    const copy = canvasBatchDeleteCopy({ count: 2, inFlightPaidCount: 1 });
    expect(copy.title).toBe("Still generating — remove anyway?");
    expect(copy.description).toContain("won't refund");
    expect(copy.description).toContain("charge you a second time");
  });
});
