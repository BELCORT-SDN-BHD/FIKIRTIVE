/**
 * CREATE-A3 后半段 —— 商家关掉的那个声音开关,到底有没有变成供应商请求体里的
 * `generate_audio: false`。
 *
 * 规格(docs/specs/creation-engine.md 验收表 CREATE-A3):
 *   「商家在视频规格选择器关掉声音开关后生成 ⇒ 交付视频无 AI 配音配乐
 *    (`generate_audio=false` 实发可查)」
 *
 * 「实发可查」这四个字要求的是**请求体**一级的证据,不是某个中间变量。所以这里断言的是
 * 真的 POST 出去的那段 JSON。前半段(界面开关 ⇒ 付费请求 `audio:false`)在
 * `apps/web/lib/__tests__/video-audio-toggle.test.ts`;两段接起来,从商家手指到供应商
 * 请求体是一条闭合的链。
 *
 * 另一半同样重要:**没碰过开关**(`audio` 未设)时请求体必须与本格出现之前逐字一致
 * (`generate_audio: true`)—— 一个默认值漂移就是替全体商家改了他们没批准的交付。
 *
 * 这个文件只读 `byteplus.ts` 现有形状,一个字都不改它。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BytePlusProvider } from "./byteplus.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init?: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => handler(String(url), init)));
}
const jsonRes = (body: any) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const bytesRes = () => ({ ok: true, status: 200, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });

/** 跑一次真实的提交路径,把 POST 出去的请求体原样交回来。 */
async function submitBodyFor(audio: boolean | undefined): Promise<any> {
  let submitBody: any;
  stubFetch((url, init) => {
    if (url.endsWith("/contents/generations/tasks") && init?.method === "POST") {
      submitBody = JSON.parse(init.body);
      return jsonRes({ id: "cgt-a3" });
    }
    if (url.includes("/contents/generations/tasks/cgt-a3")) {
      return jsonRes({ status: "succeeded", content: { video_url: "https://tos/v.mp4" }, usage: { total_tokens: 1 } });
    }
    return bytesRes();
  });
  const promise = new BytePlusProvider("ark-test").generateVideo({
    prompt: "roll",
    imageUrl: "https://r2/frame.png",
    durationSeconds: 5,
    model: "seedance-2-mini",
    resolution: "720p",
    aspectRatio: "16:9",
    ...(audio === undefined ? {} : { audio }),
  });
  await vi.runAllTimersAsync();
  await promise;
  return submitBody;
}

describe("CREATE-A3:声音开关落到供应商请求体", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("CREATE-A3:商家关掉声音 ⇒ 请求体 generate_audio 为 false", async () => {
    const body = await submitBodyFor(false);
    expect(body.generate_audio).toBe(false);
    // 顶层严格字段,不是塞进提示词的后缀 —— 松校验的后缀会被引擎悄悄换成默认值后照单计费。
    expect(body.content.at(-1)).toEqual({ type: "text", text: "roll" });
    expect(JSON.stringify(body)).not.toContain("--");
  });

  it("CREATE-A3:商家开着声音 ⇒ 请求体 generate_audio 为 true", async () => {
    expect((await submitBodyFor(true)).generate_audio).toBe(true);
  });

  it("CREATE-A3:未设声音 ⇒ 仍是 true,默认交付不因这一格的出现而漂移", async () => {
    expect((await submitBodyFor(undefined)).generate_audio).toBe(true);
  });

  it("CREATE-A3:声音那一格不碰任何会改价的字段", async () => {
    const off = await submitBodyFor(false);
    const on = await submitBodyFor(true);
    for (const key of ["model", "resolution", "duration", "ratio"] as const) {
      expect(off[key], key).toEqual(on[key]);
    }
  });
});
