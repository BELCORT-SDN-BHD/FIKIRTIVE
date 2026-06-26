import { describe, it, expect } from "vitest";
import { formatElapsed, usualSeconds } from "../progress-format";

describe("formatElapsed", () => {
  it('returns "0:00" for 0', () => expect(formatElapsed(0)).toBe("0:00"));
  it('returns "0:05" for 5', () => expect(formatElapsed(5)).toBe("0:05"));
  it('returns "1:23" for 83', () => expect(formatElapsed(83)).toBe("1:23"));
  it('returns "0:00" for negative', () => expect(formatElapsed(-3)).toBe("0:00"));
  it('returns "0:00" for NaN', () => expect(formatElapsed(NaN)).toBe("0:00"));
  it('returns "0:00" for Infinity', () => expect(formatElapsed(Infinity)).toBe("0:00"));
  it('returns "10:00" for 600', () => expect(formatElapsed(600)).toBe("10:00"));
});

describe("usualSeconds", () => {
  it("returns 20 for image", () => expect(usualSeconds(false)).toBe(20));
  it("returns 45 for video", () => expect(usualSeconds(true)).toBe(45));
});
