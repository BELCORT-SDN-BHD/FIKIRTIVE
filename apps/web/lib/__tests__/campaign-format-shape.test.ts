/**
 * #643 T2 —— 格式名 → 会不会是片子、会是什么形状。**一张表**，纯函数，无 DB 无花费。
 *
 * 这张表是被复核过的产品决定本身：商家在计划里写 "story"，产品就交付竖版。
 * 它同时被付费路径（campaign-generation-confirm）与确认页读，所以两边不可能分家。
 */
import { describe, expect, it } from "vitest";
import { GEN_IMAGE_ASPECTS, GEN_IMAGE_DEFAULT_ASPECT } from "@fikirtive/core";
import {
  VIDEO_FORMATS,
  campaignGenKindForFormat,
  campaignImageAspectForFormat,
} from "../campaign-format-shape";

describe("campaignGenKindForFormat", () => {
  it("片子格式出片，其余一律出图", () => {
    for (const format of VIDEO_FORMATS) expect(campaignGenKindForFormat(format), format).toBe("video");
    for (const format of ["image", "post", "story", "carousel", "banner", "whatever"]) {
      expect(campaignGenKindForFormat(format), format).toBe("image");
    }
  });
  it("大小写与空白不算不同的格式", () => {
    expect(campaignGenKindForFormat("  REEL ")).toBe("video");
    expect(campaignGenKindForFormat(" Story ")).toBe("image");
  });
});

describe("campaignImageAspectForFormat", () => {
  it("竖版位 ⇒ 9:16（Story 不再交付方图）", () => {
    for (const format of ["story", "stories", "vertical", "portrait"]) {
      expect(campaignImageAspectForFormat(format), format).toBe("9:16");
    }
  });
  it("横版位 ⇒ 16:9", () => {
    for (const format of ["banner", "cover", "landscape"]) {
      expect(campaignImageAspectForFormat(format), format).toBe("16:9");
    }
  });
  it("Feed / 方图位 ⇒ 1:1", () => {
    for (const format of ["feed", "feed-image", "post", "carousel", "square"]) {
      expect(campaignImageAspectForFormat(format), format).toBe("1:1");
    }
  });
  it("表上没有的格式 ⇒ 默认形状（不猜商家的意图）", () => {
    expect(campaignImageAspectForFormat("something_new")).toBe(GEN_IMAGE_DEFAULT_ASPECT);
    expect(campaignImageAspectForFormat("")).toBe(GEN_IMAGE_DEFAULT_ASPECT);
  });
  it("片子格式 ⇒ null（形状归视频侧，这张表不越权）", () => {
    for (const format of VIDEO_FORMATS) expect(campaignImageAspectForFormat(format), format).toBeNull();
  });
  it("表上每一格都真的在引擎菜单上 —— 不可能把一个收不下的形状送进付费请求", () => {
    const formats = [
      "story", "stories", "vertical", "portrait",
      "banner", "cover", "landscape",
      "feed", "feed-image", "post", "carousel", "square",
      "anything_else",
    ];
    for (const format of formats) {
      const aspect = campaignImageAspectForFormat(format);
      expect(aspect, format).not.toBeNull();
      expect(GEN_IMAGE_ASPECTS as readonly string[], format).toContain(aspect!);
    }
  });
  it("写法差异不算不同的格式", () => {
    expect(campaignImageAspectForFormat(" STORY ")).toBe("9:16");
  });
});
