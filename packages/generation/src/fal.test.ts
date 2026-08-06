import { describe, it, expect, vi, afterEach } from "vitest";
import { FalProvider } from "./index.js";

// ---------------------------------------------------------------------------
// FalProvider.generateVideo 的付费边界(#661 边界同款钉板,$0,fetch 全 stub)
//
// fal 的同步端点(fal.run)一旦 POST 返回 2xx,模型就已经跑了、钱就已经花了。
// 所以边界只有一条:
//   - POST 非 2xx(引擎没跑)      → PLAIN 可重试,不带 charged
//   - POST 2xx 之后的任何死法      → chargedError 终态 —— worker 重投就是再 POST
//                                    一次、再计一次费(双扣)
//
// fal 是 legacy fallback(GENERATION_PROVIDER=fal 才启用),不在 #580 的卡面
// lockstep 闸内;但它一旦被选中就是真金白银的路,这道边界此前只由一次性脚本
// scripts/tools/fal-charge-boundary.mjs 证明过(CI 不跑)。这里把那三个用例
// 升格为正式 vitest —— 哪天有人动 index.ts 的 chargedError 分界,这里红。
// 脚本本尊已随之归档到 scripts/archive/。
// ---------------------------------------------------------------------------

afterEach(() => vi.unstubAllGlobals());

function stubFetch(handler: (url: string, init?: any) => any) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: any) => handler(String(url), init)));
}

describe("FalProvider.generateVideo — 付费边界(POST 2xx 即已计费)", () => {
  // 与原脚本一致:带源帧的 i2v 请求;模型用唯一在册的视频 id(#647 T6)。
  async function callOnce() {
    let err: any;
    try {
      await new FalProvider("test-key").generateVideo({
        prompt: "x", imageUrl: "https://r2/frame.png", durationSeconds: 5, model: "seedance-2-fast",
      });
    } catch (e) { err = e; }
    return err;
  }

  it("POST 非 2xx(429 限流,引擎没跑)→ PLAIN 可重试,不带 charged", async () => {
    stubFetch(() => ({ ok: false, status: 429, text: async () => "rate limited" }));
    const err = await callOnce();
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("429");
    expect(err.charged).toBeFalsy(); // 没花过的钱不许记成花过 —— worker 可安全重投
  });

  it("POST 2xx 后结果下载 503(片子出了、钱花了,只是没拿到)→ chargedError 终态", async () => {
    stubFetch((url) => url.includes("fal.run")
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
});
