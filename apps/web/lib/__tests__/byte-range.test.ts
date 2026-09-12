/**
 * SHARE-A1 / SHARE-A2(docs/specs/share-preview.md 已冻结 · v1)—— `Range:` 头的解析。
 *
 * 这一层只回答「客户端要哪一段」,不碰存储、不碰限流。它单独成模块是因为答错的方向不对称:
 *   · 解不出来就当没带 Range(200 整条),这是 RFC 9110 允许的退路,也是今天的行为;
 *   · 解错了偏移,客户看到的是一段错位的图/视频,而且没有任何报错。
 * 所以每一种形状都在这里钉死一次。
 */
import { describe, it, expect } from "vitest";
import { parseByteRange } from "../byte-range";

describe("SHARE-A1 —— Range 头解析", () => {
  it("SHARE-A1 —— `bytes=0-1048575` 解成前 1 MiB 的闭区间", () => {
    expect(parseByteRange("bytes=0-1048575", 300_000_000)).toEqual({ start: 0, end: 1_048_575 });
  });

  it("SHARE-A1 —— 开放式 `bytes=100-` 一路到对象末尾", () => {
    expect(parseByteRange("bytes=100-", 1000)).toEqual({ start: 100, end: 999 });
  });

  it("SHARE-A1 —— 后缀式 `bytes=-500` 是最后 500 字节", () => {
    expect(parseByteRange("bytes=-500", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("SHARE-A1 —— 后缀比对象还长时从 0 开始,而不是负偏移", () => {
    expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  it("SHARE-A1 —— 末端超出对象大小的,收到最后一个字节为止", () => {
    expect(parseByteRange("bytes=900-99999", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("SHARE-A1 —— 起点已经越过对象末尾 = 不可满足(416,不是悄悄回整条)", () => {
    expect(parseByteRange("bytes=1000-2000", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=1000-", 1000)).toBe("unsatisfiable");
  });

  it("SHARE-A1 —— 起点大于末端 = 不可满足", () => {
    expect(parseByteRange("bytes=500-100", 1000)).toBe("unsatisfiable");
  });

  it("SHARE-A1 —— 后缀式 `bytes=-0` 要的是「最后 0 个字节」= 不可满足(RFC 9110 §14.1.2)", () => {
    expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });

  it("SHARE-A1 —— 零长度对象上的任何 Range 都不可满足", () => {
    expect(parseByteRange("bytes=0-0", 0)).toBe("unsatisfiable");
  });

  it("SHARE-A2 —— 没有 Range 头 = null(照常 200 整条,普通浏览器那条路)", () => {
    expect(parseByteRange(null, 1000)).toBeNull();
    expect(parseByteRange("", 1000)).toBeNull();
  });

  it("SHARE-A2 —— 认不出来的形状(多段、非 bytes 单位、垃圾)一律当没带,回 200 整条", () => {
    expect(parseByteRange("bytes=0-99,200-299", 1000)).toBeNull(); // 多段:我们不做 multipart
    expect(parseByteRange("items=0-99", 1000)).toBeNull();
    expect(parseByteRange("bytes=-", 1000)).toBeNull();
    expect(parseByteRange("bytes=abc-def", 1000)).toBeNull();
    expect(parseByteRange("garbage", 1000)).toBeNull();
  });
});
