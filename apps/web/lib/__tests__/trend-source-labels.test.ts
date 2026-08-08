import { describe, expect, it } from "vitest";

import { trendSourceLabels } from "../trend-source-labels";

describe("trendSourceLabels", () => {
  // #713 — the domain used to be a fallback the merchant only saw when a title was missing,
  // so a conclusion could carry a junk source nobody could ever read off the card.
  it("shows the domain next to the title instead of hiding it behind one", () => {
    expect(trendSourceLabels([{ title: "Retail bundle study", domain: "not a domain !!" }]))
      .toEqual(["Retail bundle study · not a domain !!"]);
  });

  it("shows whichever half exists on its own", () => {
    expect(trendSourceLabels([
      { title: "Seasonal brief" },
      { domain: "example.com" },
    ])).toEqual(["Seasonal brief", "example.com"]);
  });

  it("drops entries with neither half rather than guessing a label", () => {
    expect(trendSourceLabels([{ title: "  ", domain: "" }, {}, "junk", null])).toEqual([]);
    expect(trendSourceLabels("not an array")).toEqual([]);
  });
});
