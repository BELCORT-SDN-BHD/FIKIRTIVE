/**
 * 合集卡上那两行小字的纯函数(前端基线 §7.3②;验收 FRONT-A6 的显示面)。
 *
 * 钉住的是两条「不许再回到夹具」的规则:数量与时间都从真实的值算出来,不是写死的字符串。
 */
import { describe, it, expect } from "vitest";

import {
  collectionItemCountLabel,
  collectionUpdatedLabel,
} from "../library-collections-model";

const NOW = new Date("2026-09-03T12:00:00.000Z");

describe("FRONT-A6:合集卡的数量与时间来自真实的值", () => {
  it("FRONT-A6:数量的单复数按真实条数走", () => {
    expect(collectionItemCountLabel(0)).toBe("0 items");
    expect(collectionItemCountLabel(1)).toBe("1 item");
    expect(collectionItemCountLabel(12)).toBe("12 items");
  });

  it("FRONT-A6:一周以内说相对时间,更久写日期", () => {
    expect(collectionUpdatedLabel("2026-09-03T11:59:40.000Z", NOW)).toBe("Updated just now");
    expect(collectionUpdatedLabel("2026-09-03T11:58:00.000Z", NOW)).toBe("Updated 2 minutes ago");
    expect(collectionUpdatedLabel("2026-09-03T11:00:00.000Z", NOW)).toBe("Updated 1 hour ago");
    expect(collectionUpdatedLabel("2026-09-01T12:00:00.000Z", NOW)).toBe("Updated 2 days ago");
    expect(collectionUpdatedLabel("2026-08-12T12:00:00.000Z", NOW)).toBe("Updated on 12 Aug 2026");
  });

  it("FRONT-A6:时钟偏移出来的未来时间不显示负数", () => {
    expect(collectionUpdatedLabel("2026-09-03T12:05:00.000Z", NOW)).toBe("Updated just now");
  });

  it("FRONT-A6:读不出来的时间说 recently,不编一个日期", () => {
    expect(collectionUpdatedLabel("not-a-date", NOW)).toBe("Updated recently");
  });
});
