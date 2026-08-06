/**
 * verify-reference-video-mirror.test.ts — #663 P2-1。
 *
 * `apps/web/scripts/verify-reference-video.mjs` 是一次**花真钱**的付费验证:它的全部价值,
 * 建立在「这个请求体和生产真路一字不差」这句话上。这句话一旦失真,我们就是在花钱验证一个
 * 我们根本不发的请求 —— 判官 r2 抓到的正是这个:脚本省略了 `ratio`,而真实付费路径会把
 * 缺省画幅归一为模型默认(16:9),一路带进适配器请求体。
 *
 * 这道闸不 grep 源码文本(那只证明文件里有那几个字)。它把脚本里 `const body = { … }`
 * 那个**对象字面量整段取出来求值**,拿到脚本真会发出去的对象,再逐字段断言;`ratio` 的
 * 期望值也不写死,而是从同一份真相(core 的 `videoDefaults`)推导 —— 哪天模型默认画幅变了,
 * 这里立刻红,逼脚本跟着改。
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { REFERENCE_VIDEO_MODEL, videoDefaults } from "@fikirtive/core";

const SCRIPT = path.resolve(__dirname, "../../scripts/verify-reference-video.mjs");

/** 取出 `const body = { … };` 的字面量并求值(脚本自身有 top-level await + process.exit,
 *  不能直接 import)。字面量里引用的外部标识符在这里显式绑定。 */
function scriptBody(): Record<string, unknown> {
  const src = readFileSync(SCRIPT, "utf8");
  const start = src.indexOf("const body = {");
  expect(start, "脚本里找不到 `const body = {` —— 镜像闸失去了对象,先修这里").toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { end = i; break; }
  }
  expect(end, "`const body` 的花括号没有配平").toBeGreaterThan(open);
  const literal = src.slice(open, end + 1);
  return new Function("MODEL", "content", "duration", `return (${literal});`)(
    "dreamina-seedance-2-0-fast-260128",
    [{ type: "video_url" }, { type: "text" }],
    "5",
  ) as Record<string, unknown>;
}

describe("#663 P2-1 付费验证脚本 ↔ 真实付费路径(镜像)", () => {
  it("脚本发的控制项 = 真路发的控制项,画幅按模型默认归一(不是省略)", () => {
    const body = scriptBody();
    // 真路的缺省画幅归一在 apps/web/lib/batch-idempotency.ts(normalizeFactoryMaterial)
    // 完成:商家没选画幅 ⇒ 落 videoDefaults 的默认值,一路带到适配器 body.ratio。
    const defaultRatio = videoDefaults(REFERENCE_VIDEO_MODEL).aspectRatio;
    expect(defaultRatio).toBe("16:9"); // 现役参考视频模型的默认画幅
    expect(body).toEqual({
      model: "dreamina-seedance-2-0-fast-260128",
      content: [{ type: "video_url" }, { type: "text" }],
      resolution: "720p",
      duration: 5,
      ratio: defaultRatio,
      generate_audio: true,
      watermark: false,
      execution_expires_after: 3600,
    });
  });
});
