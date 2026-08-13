import { describe, it, expect, vi, afterEach } from "vitest";
import { FalProvider } from "./index.js";

// ---------------------------------------------------------------------------
// FalProvider 的付费边界(#661/#664 边界同款钉板,$0,fetch 全 stub)
//
// 家规(#664/#665 判官链定案):**只有可证明引擎没花钱才许 PLAIN(可重试);已计费
// 或结果不明一律 chargedError(终态)** —— 重投一次就是再计一次费(双扣)。
//
// fal 的 fal.run 是**同步**端点:POST 本身就是计费事件(响应直接携带成片)。按这把
// 尺子逐形状落位:
//   - POST 4xx(限流 / 参数校验 / 鉴权被拒)  → 引擎在跑模型之前就拒了这单,
//                                              可证明没花钱 ⇒ PLAIN 可重投
//   - POST 的 fetch 自己抛(网络断、响应丢失)→ 请求可能已经到达引擎并执行,
//                                              结果不明 ⇒ 终态 charged
//   - POST 5xx                                → 服务端出错,不能证明模型没跑,
//                                              结果不明 ⇒ 终态 charged
//   - POST 2xx 之后的任何死法                 → 已计费 ⇒ 终态 charged
//
// (「非 2xx 一律没花钱」是这个文件早先的错误概括,判官 r1 P1-1 已推翻:能证明没
//  花钱的只有 4xx 那一格,5xx 与「连响应都没拿到」都属结果不明。)
//
// fal 是 legacy fallback(GENERATION_PROVIDER=fal 才启用),现役生产走 byteplus;
// 但家规不分现役与备用 —— 它一旦被选中就是真金白银的路。这道边界此前只由一次性
// 脚本 scripts/tools/fal-charge-boundary.mjs 证明过三格(CI 不跑),脚本本尊已随之
// 归档到 scripts/archive/;其余各格在这里补齐。
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init?: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => handler(String(url), init)));
}

const POST = (url: string) => url.includes("fal.run");

describe("FalProvider.generateVideo — 付费边界(POST 2xx 即已计费)", () => {
  // 与原脚本一致:带源帧的 i2v 请求;模型用唯一在册的视频 id(#647 T6)。
  async function callOnce() {
    let err: any;
    try {
      await new FalProvider("test-key").generateVideo({
        prompt: "x", imageUrl: "https://r2/frame.png", durationSeconds: 5, model: "seedance-2-mini",
      });
    } catch (e) { err = e; }
    return err;
  }

  it("POST 429(4xx:引擎在跑模型前就限流拒单)→ PLAIN 可重试,不带 charged", async () => {
    stubFetch(() => ({ ok: false, status: 429, text: async () => "rate limited" }));
    const err = await callOnce();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("429");
    expect(err.charged).toBeFalsy(); // 没花过的钱不许记成花过 —— worker 可安全重投
  });

  it("POST 400(4xx:参数被校验拒绝,同样在计费前)→ PLAIN 可重试", async () => {
    stubFetch(() => ({ ok: false, status: 400, text: async () => "bad request" }));
    const err = await callOnce();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("400");
    expect(err.charged).toBeFalsy();
  });

  // 判官 r1 P1-1:付费 POST 自己抛(网络断 / 响应途中丢失)。同步端点的请求可能已经
  // 到达引擎并执行完毕,只是回不来了 —— 这是标准的「结果不明」,与 byteplus「submit
  // 2xx 但回执读不出来」同尺(#664)。此前它原样 PLAIN 逸出 ⇒ worker 重投 ⇒ 双扣。
  it("POST 的 fetch 自己抛(连响应都没拿到,结果不明)→ chargedError 终态", async () => {
    stubFetch(() => { throw new TypeError("fetch failed: ECONNRESET"); });
    const err = await callOnce();
    expect(err).toBeInstanceOf(Error);
    expect(err.charged).toBe(true);
  });

  // 判官 r1 P1-1:5xx 不能证明模型没跑过(网关超时、上游 500 都可能发生在执行之后)。
  it("POST 500(服务端错误,无法证明模型没跑)→ chargedError 终态", async () => {
    stubFetch(() => ({ ok: false, status: 500, text: async () => "internal error" }));
    const err = await callOnce();
    expect(err).toBeInstanceOf(Error);
    expect(err.charged).toBe(true);
  });

  it("POST 2xx 后结果下载 503(片子出了、钱花了,只是没拿到)→ chargedError 终态", async () => {
    stubFetch((url) => POST(url)
      ? { ok: true, status: 200, json: async () => ({ video: { url: "https://cdn/out.mp4" } }) }
      : { ok: false, status: 503 });
    const err = await callOnce();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/billed/);
    expect(err.charged).toBe(true); // 重投 = 再 POST 一次 = 双扣,必须终态
  });

  it("POST 2xx 但响应里没有 video url(已计费,结果读不出来)→ chargedError 终态", async () => {
    stubFetch(() => ({ ok: true, status: 200, json: async () => ({}) }));
    const err = await callOnce();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/billed/);
    expect(err.charged).toBe(true); // 「结果不明」≠「没出片」—— 与 #661 的边界同一条纪律
  });

  // 判官 r1 P2-1:POST 2xx 之后还有三种此前零钉板的死法(实现已正确,这里把它钉住,
  // 免得哪天有人把 try/catch 的范围改小了没人发现)。写法参照 byteplus.test.ts:269-307。
  it("POST 2xx 但回执 JSON 损坏(已计费,响应读不出来)→ chargedError 终态", async () => {
    stubFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } }));
    const err = await callOnce();
    expect(err.charged).toBe(true);
  });

  it("POST 2xx 后结果下载连接直接断(fetch 自己 reject,连状态码都没有)→ chargedError 终态", async () => {
    stubFetch((url) => {
      if (POST(url)) return { ok: true, status: 200, json: async () => ({ video: { url: "https://cdn/out.mp4" } }) };
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    const err = await callOnce();
    expect(err.charged).toBe(true);
  });

  it("POST 2xx 后读流中断(arrayBuffer 抛,字节没拿全)→ chargedError 终态", async () => {
    stubFetch((url) => POST(url)
      ? { ok: true, status: 200, json: async () => ({ video: { url: "https://cdn/out.mp4" } }) }
      : { ok: true, status: 200, arrayBuffer: async () => { throw new Error("stream aborted mid-body"); } });
    const err = await callOnce();
    expect(err.charged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 同一把尺子的图片侧。fal 的图片端点同样是同步计费端点(POST 2xx 即已出图、已计费),
// #664 只补了它的 post-2xx 段;POST 自己抛与 POST 5xx 这两格与视频侧同病同治。
// ---------------------------------------------------------------------------
describe("FalProvider.generate(图片)— 同一把尺子", () => {
  async function callImage() {
    let err: any;
    try {
      await new FalProvider("test-key").generate({
        prompt: "x", inputImageUrls: [], count: 1, model: "seedream", aspectRatio: "1:1",
      });
    } catch (e) { err = e; }
    return err;
  }
  const okPost = { ok: true, status: 200, json: async () => ({ images: [{ url: "https://cdn/out.png", content_type: "image/png" }] }) };

  it("POST 429(4xx:引擎在跑模型前就限流拒单)→ PLAIN 可重试,不带 charged", async () => {
    stubFetch(() => ({ ok: false, status: 429, text: async () => "rate limited" }));
    const err = await callImage();
    expect(err.message).toContain("429");
    expect(err.charged).toBeFalsy();
  });

  it("POST 的 fetch 自己抛(连响应都没拿到,结果不明)→ chargedError 终态", async () => {
    stubFetch(() => { throw new TypeError("fetch failed: ECONNRESET"); });
    const err = await callImage();
    expect(err).toBeInstanceOf(Error);
    expect(err.charged).toBe(true);
  });

  it("POST 500(服务端错误,无法证明模型没跑)→ chargedError 终态", async () => {
    stubFetch(() => ({ ok: false, status: 500, text: async () => "internal error" }));
    const err = await callImage();
    expect(err).toBeInstanceOf(Error);
    expect(err.charged).toBe(true);
  });

  it("POST 2xx 但回执 JSON 损坏(已计费)→ chargedError 终态", async () => {
    stubFetch(() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected end of JSON input"); } }));
    const err = await callImage();
    expect(err.charged).toBe(true);
  });

  it("POST 2xx 后结果下载连接直接断(已计费)→ chargedError 终态", async () => {
    stubFetch((url) => {
      if (POST(url)) return okPost;
      throw new TypeError("fetch failed: ECONNREFUSED");
    });
    const err = await callImage();
    expect(err.charged).toBe(true);
  });

  it("POST 2xx 后读流中断(arrayBuffer 抛,已计费)→ chargedError 终态", async () => {
    stubFetch((url) => POST(url)
      ? okPost
      : { ok: true, status: 200, arrayBuffer: async () => { throw new Error("stream aborted mid-body"); } });
    const err = await callImage();
    expect(err.charged).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// #785 —— 备用适配器没有多素材参考那条路,所以它必须在**付费 POST 之前**拒绝,
// 而不是把商家的产品图/代言人照片悄悄丢掉、照样做一支没有它们的片子并计费。
// 这与旁边那行「整段参考视频」守的是同一条规矩(#644 起就在)。
// ---------------------------------------------------------------------------
describe("FalProvider — #785 元素参考照", () => {
  it("带元素参考照 ⇒ 付费 POST 之前拒绝(fetch 一次都没发)", async () => {
    const calls: string[] = [];
    stubFetch((url: string) => { calls.push(url); return okPost; });
    await expect(new FalProvider("k").generateVideo({
      prompt: "our product on a beach", imageUrl: "",
      refImageUrls: ["https://r2/product.png"],
      durationSeconds: 5, model: "seedance-2-mini",
    })).rejects.toThrow(/does not support element reference photos/);
    expect(calls).toEqual([]);
  });
});
