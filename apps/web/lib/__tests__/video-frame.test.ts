import { describe, it, expect } from "vitest";
import {
  ACCEPT_ATTACH,
  isVideoFile,
  defaultFrameTime,
  frameFileName,
  FRAME_MAX_SIDE,
  FRAME_JPEG_QUALITY,
  REF_VIDEO_MIN_SECONDS,
  REF_VIDEO_MAX_SECONDS,
  isRefVideoDurationOk,
} from "../video-frame.js";

describe("ACCEPT_ATTACH", () => {
  it("allows both image and video types", () => {
    expect(ACCEPT_ATTACH).toContain("image/png");
    expect(ACCEPT_ATTACH).toContain("image/jpeg");
    expect(ACCEPT_ATTACH).toContain("image/webp");
    expect(ACCEPT_ATTACH).toContain("video/mp4");
    expect(ACCEPT_ATTACH).toContain("video/quicktime");
    expect(ACCEPT_ATTACH).toContain("video/webm");
  });
});

describe("isVideoFile", () => {
  it("true for video MIME types", () => {
    expect(isVideoFile({ type: "video/mp4" })).toBe(true);
    expect(isVideoFile({ type: "video/quicktime" })).toBe(true);
  });
  it("false for image MIME types and empty", () => {
    expect(isVideoFile({ type: "image/png" })).toBe(false);
    expect(isVideoFile({ type: "" })).toBe(false);
  });
});

describe("defaultFrameTime", () => {
  it("returns 10% of duration", () => {
    expect(defaultFrameTime(10)).toBeCloseTo(1);
    expect(defaultFrameTime(30)).toBeCloseTo(3);
  });
  it("clamps to [0, duration] and handles tiny/invalid durations", () => {
    expect(defaultFrameTime(0)).toBe(0);
    expect(defaultFrameTime(-5)).toBe(0);
    expect(defaultFrameTime(Number.NaN)).toBe(0);
  });
});

describe("frameFileName", () => {
  it("builds frame-<seconds>.jpg with 2 decimals", () => {
    expect(frameFileName(1.5)).toBe("frame-1.50.jpg");
    expect(frameFileName(0)).toBe("frame-0.00.jpg");
  });
});

describe("frame export constants", () => {
  it("cap 1600 and jpeg quality 0.92", () => {
    expect(FRAME_MAX_SIDE).toBe(1600);
    expect(FRAME_JPEG_QUALITY).toBe(0.92);
  });
});

describe("ref video duration bounds", () => {
  it("2..10s inclusive ok; outside not", () => {
    expect(REF_VIDEO_MIN_SECONDS).toBe(2);
    expect(REF_VIDEO_MAX_SECONDS).toBe(10);
    expect(isRefVideoDurationOk(2)).toBe(true);
    expect(isRefVideoDurationOk(10)).toBe(true);
    expect(isRefVideoDurationOk(1.5)).toBe(false);
    expect(isRefVideoDurationOk(11)).toBe(false);
    expect(isRefVideoDurationOk(Number.NaN)).toBe(false);
  });
});
