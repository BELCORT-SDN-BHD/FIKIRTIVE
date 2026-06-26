import { describe, it, expect } from "vitest";
import { bustUrl } from "@/lib/media-retry";

describe("bustUrl", () => {
  it("appends r=1 to a bare URL", () => {
    expect(bustUrl("https://example.com/img.png", 1)).toBe(
      "https://example.com/img.png?r=1"
    );
  });

  it("appends r=2 with & when URL already has a query param", () => {
    expect(bustUrl("https://example.com/img.png?w=400", 2)).toBe(
      "https://example.com/img.png?w=400&r=2"
    );
  });

  it("uses the attempt number in the param", () => {
    expect(bustUrl("https://example.com/vid.mp4", 3)).toBe(
      "https://example.com/vid.mp4?r=3"
    );
  });

  it("handles URL with existing r= param (appends another — browser uses last)", () => {
    expect(bustUrl("https://cdn.example.com/a.jpg?r=1", 2)).toBe(
      "https://cdn.example.com/a.jpg?r=1&r=2"
    );
  });
});
