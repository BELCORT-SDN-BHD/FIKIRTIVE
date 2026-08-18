/**
 * understanding.test.ts — #784 理解端口。
 *
 * 纪律:**全程 mock,一个字节都不出网。** `fetch` 被换掉,所以任何一次真调用都会立刻暴露
 * (未被 stub 的调用会打到 vi.fn() 上,而不是打到供应商)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  UNDERSTANDING_CAPS,
  UNDERSTANDING_JSON_SCHEMAS,
  UNDERSTANDING_VIDEO_SAMPLE_FPS,
} from "@fikirtive/core";
import {
  ArkUnderstandingProvider,
  MockUnderstandingProvider,
  classifyUnderstandingFailure,
  createUnderstandingProvider,
  isProviderConfigError,
  isUnreadableMediaError,
  understandingErrorUsage,
} from "./understanding.js";
import { RequestGate, __setProviderRequestGateForTests } from "./provider-concurrency.js";

/** 闸门以内的一张普通手机照 / 一段 12 秒的片 —— 每个请求都必须带上素材元数据(见 belt)。 */
const OK_IMAGE_MEDIA = { width: 4032, height: 3024, sizeBytes: 3_500_000, durationS: null };
const OK_VIDEO_MEDIA = { width: 1920, height: 1080, sizeBytes: 8_000_000, durationS: 12 };

const IMAGE_REQ = { kind: "image-caption" as const, mediaUrl: "https://store.example/x.jpg?sig=SECRET", mime: "image/jpeg", media: OK_IMAGE_MEDIA };
const VIDEO_REQ = { kind: "video-qa" as const, mediaUrl: "https://store.example/x.mp4?sig=SECRET", mime: "video/mp4", media: OK_VIDEO_MEDIA };
const DOC_REQ = { kind: "doc-extract" as const, mediaUrl: "https://store.example/menu.jpg?sig=SECRET", mime: "image/jpeg", media: OK_IMAGE_MEDIA };

let fetchMock: ReturnType<typeof vi.fn>;

function okResponse(content: string, usage = { prompt_tokens: 900, completion_tokens: 120 }) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content } }], usage }),
  };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  __setProviderRequestGateForTests(new RequestGate(4));
});

afterEach(() => {
  vi.unstubAllGlobals();
  __setProviderRequestGateForTests(undefined);
});

describe("请求体:成本敏感的每一项都真的发出去了", () => {
  it("图片走 image_url + 低精度,并带上这个 kind 的输出上限与 json_schema", async () => {
    fetchMock.mockResolvedValue(okResponse('{"summary":"a mug","isDocument":false}'));
    await new ArkUnderstandingProvider("k").understand(IMAGE_REQ);

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse((init as { body: string }).body);
    expect(body.max_tokens).toBe(UNDERSTANDING_CAPS["image-caption"].maxOutputTokens);
    expect(body.temperature).toBe(0);
    const part = body.messages[0].content[0];
    expect(part.type).toBe("image_url");
    expect(part.image_url.detail).toBe("low");
    expect(body.response_format.json_schema.name).toBe(UNDERSTANDING_JSON_SCHEMAS["image-caption"]!.name);
    expect(body.response_format.json_schema.strict).toBe(true);
  });

  it("模型 id 带版本号 —— 裸别名在本账户 404,那正是全平台理解静默死掉的原因", async () => {
    fetchMock.mockResolvedValue(okResponse('{"summary":"x","isDocument":false}'));
    await new ArkUnderstandingProvider("k").understand(IMAGE_REQ);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.model).toMatch(/-\d{6}$/);
  });

  it("思考显式关掉 —— 默认开着比关着贵约 4 倍、慢约 4 倍,而且更不准", async () => {
    fetchMock.mockResolvedValue(okResponse('{"summary":"x","isDocument":false}'));
    await new ArkUnderstandingProvider("k").understand(IMAGE_REQ);
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.thinking).toEqual({ type: "disabled" });
  });

  it("视频走 video_url 并带上抽帧帧率 —— 少了它,「不到一条视频 1%」当场不成立", async () => {
    fetchMock.mockResolvedValue(okResponse('{"summary":"a shop","facts":[]}'));
    await new ArkUnderstandingProvider("k").understand(VIDEO_REQ);

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    const part = body.messages[0].content[0];
    expect(part.type).toBe("video_url");
    expect(part.video_url.fps).toBe(UNDERSTANDING_VIDEO_SAMPLE_FPS);
    expect(part.video_url.detail).toBe("low");
  });

  it("菜单那一趟用的是 doc-extract 的上限与 schema,不是 caption 的", async () => {
    fetchMock.mockResolvedValue(okResponse('{"products":[]}'));
    await new ArkUnderstandingProvider("k").understand(DOC_REQ);

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body.max_tokens).toBe(UNDERSTANDING_CAPS["doc-extract"].maxOutputTokens);
    expect(body.response_format.json_schema.name).toBe(UNDERSTANDING_JSON_SCHEMAS["doc-extract"]!.name);
  });

  it("key 走 Authorization 头,永远不进 URL", async () => {
    fetchMock.mockResolvedValue(okResponse('{"summary":"x","isDocument":false}'));
    await new ArkUnderstandingProvider("super-secret").understand(IMAGE_REQ);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).not.toContain("super-secret");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe("Bearer super-secret");
  });
});

describe("用量与产物", () => {
  it("回传 token 用量 —— 这是事后核对「真的没超预算」的唯一依据", async () => {
    fetchMock.mockResolvedValue(okResponse('{"summary":"x","isDocument":false}', { prompt_tokens: 1234, completion_tokens: 56 }));
    const out = await new ArkUnderstandingProvider("k").understand(IMAGE_REQ);
    expect(out.usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
    expect(out.text).toContain("summary");
  });

  it("用量字段缺失/垃圾时落 0,不炸也不变成 NaN", async () => {
    fetchMock.mockResolvedValue(okResponse('{"summary":"x","isDocument":false}', {} as never));
    const out = await new ArkUnderstandingProvider("k").understand(IMAGE_REQ);
    expect(out.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });

  it("分段文本回复也收得住", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: [{ type: "text", text: '{"summary":' }, { type: "text", text: '"x","isDocument":false}' }] } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    });
    const out = await new ArkUnderstandingProvider("k").understand(IMAGE_REQ);
    expect(out.text).toBe('{"summary":"x","isDocument":false}');
  });
});

describe("classifyUnderstandingFailure —— 判据表逐行", () => {
  // 判据表的每一行都在这里,因为这个函数决定的是「一份好文件会不会被永久判死」。
  it.each([
    // 供应商侧 / 限流:和这份文件、这份配置都没关系
    [408, "timeout", "transient"],
    [429, "rate limited", "transient"],
    [500, "internal error", "transient"],
    [503, "try again", "transient"],
    // HTTP 语义写死的那一个
    [415, "", "media"],
    // 供应商指名道姓说这份字节读不了
    [400, "failed to decode the image", "media"],
    [400, "invalid image: truncated data", "media"],
    [422, "unsupported media type", "media"],
    // **本次事故那一行**:模型 id 不解析
    [404, '{"error":{"code":"NotFound","message":"The model does not exist"}}', "config"],
    // key / 权限:同样是我方
    [401, "authentication error", "config"],
    [403, "permission denied", "config"],
    // schema 被拒的 400 —— 实测过的那一种(maxLength 不被接受)
    [400, '{"error":{"code":"InvalidParameter","message":"response_format is not valid"}}', "config"],
    // **证据不足的 400/422**:倒向 config,因为反过来判错的代价是每个商家的每份好文件
    [400, "", "config"],
    [422, "something went wrong", "config"],
  ] as const)("HTTP %i + %j ⇒ %s", (status, detail, expected) => {
    expect(classifyUnderstandingFailure(status, detail)).toBe(expected);
  });

  it("正文命中媒体措辞时不看 status code —— 400 也可以是真的文件坏了", () => {
    expect(classifyUnderstandingFailure(400, "IMAGE FORMAT not supported")).toBe("media");
    // 但 5xx 永远先是 transient:供应商自己崩了,不是这份文件的判决
    expect(classifyUnderstandingFailure(500, "failed to decode the image")).toBe("transient");
  });
});

describe("失败分类", () => {
  it("供应商指名说这份字节读不了 ⇒ **终止**失败(同一份字节重试永远同一个答案)", async () => {
    for (const [status, detail] of [
      [415, ""],
      [400, "failed to decode the image"],
      [422, "unsupported media type"],
    ] as const) {
      fetchMock.mockResolvedValue({ ok: false, status, text: async () => detail });
      const err = await new ArkUnderstandingProvider("k").understand(IMAGE_REQ).catch((e: unknown) => e);
      expect(isUnreadableMediaError(err)).toBe(true);
      expect(isProviderConfigError(err)).toBe(false);
    }
  });

  // 这一条就是 2026-08-18 事故的回归测试:404 曾经掉进「这份素材读不了」,于是每一份
  // 好文件被逐个永久判死。它现在必须是 config —— 一个**绝不写终态**的分类。
  it("模型 id 不解析(404)⇒ 配置类,不是「这个文件读不了」", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => '{"error":{"code":"NotFound","message":"The model does not exist"}}',
    });
    const err = await new ArkUnderstandingProvider("k").understand(IMAGE_REQ).catch((e: unknown) => e);
    expect(isProviderConfigError(err)).toBe(true);
    expect(isUnreadableMediaError(err)).toBe(false);
  });

  it("401 / 403 / 证据不足的 400 也是配置类 —— 一律不许判文件的死刑", async () => {
    for (const status of [400, 401, 403]) {
      fetchMock.mockResolvedValue({ ok: false, status, text: async () => "" });
      const err = await new ArkUnderstandingProvider("k").understand(IMAGE_REQ).catch((e: unknown) => e);
      expect(isProviderConfigError(err)).toBe(true);
      expect(isUnreadableMediaError(err)).toBe(false);
    }
  });

  it("429 / 5xx 是普通错误 —— 队列照常重试(理解不进商家账本,重试不会双扣)", async () => {
    for (const status of [429, 500, 503]) {
      fetchMock.mockResolvedValue({ ok: false, status, text: async () => "later" });
      const err = await new ArkUnderstandingProvider("k").understand(IMAGE_REQ).catch((e: unknown) => e);
      expect(isUnreadableMediaError(err)).toBe(false);
      expect(isProviderConfigError(err)).toBe(false);
      expect(err).toBeInstanceOf(Error);
    }
  });

  it("空回复算失败,不会落一条空理解 —— 而且**用量跟着错误走**(那一趟钱已经花了)", async () => {
    fetchMock.mockResolvedValue(okResponse("   ", { prompt_tokens: 2_100, completion_tokens: 4 }));
    const err = await new ArkUnderstandingProvider("k").understand(IMAGE_REQ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    // 丢掉用量 ⇒ 平台日预算对这一整类失败是瞎的,连续空响应可以无限计费而账面为零
    expect(understandingErrorUsage(err)).toEqual({ inputTokens: 2_100, outputTokens: 4 });
    // 重试同一份字节不会变出正文,而每一次重试都要再付一次 —— 终止,不排队
    expect(isUnreadableMediaError(err)).toBe(true);
  });

  it("真的没花钱的那些错误不会凭空长出用量", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503, text: async () => "later" });
    const err = await new ArkUnderstandingProvider("k").understand(IMAGE_REQ).catch((e: unknown) => e);
    expect(understandingErrorUsage(err)).toBeNull();
  });

  it("错误信息里没有 presigned URL、没有 key、没有供应商名", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => "seedream model overloaded" });
    const err = (await new ArkUnderstandingProvider("k").understand(IMAGE_REQ).catch((e: unknown) => e)) as Error;
    const msg = err.message.toLowerCase();
    expect(msg).not.toContain("secret");
    expect(msg).not.toContain("seedream");
    expect(msg).not.toContain("store.example");
  });
});

describe("输入侧的硬闸(belt:请求体里只有输出 max_tokens,输入上限只能靠不发)", () => {
  it("尺寸还不知道 ⇒ 一个请求都不发(fail closed,不是「没有证据就放行」)", async () => {
    const p = new ArkUnderstandingProvider("k");
    await expect(
      p.understand({ ...IMAGE_REQ, media: { width: null, height: null, sizeBytes: 6 * 1024 * 1024, durationS: null } }),
    ).rejects.toThrow(/unknown/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("超闸门的图片 ⇒ 一个请求都不发", async () => {
    const p = new ArkUnderstandingProvider("k");
    await expect(
      p.understand({ ...DOC_REQ, media: { width: 8064, height: 6048, sizeBytes: 20_000_000, durationS: null } }),
    ).rejects.toThrow(/too-large/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("时长还不知道的视频 ⇒ 一个请求都不发(null 曾被当成 0 秒)", async () => {
    const p = new ArkUnderstandingProvider("k");
    await expect(p.understand({ ...VIDEO_REQ, media: { ...OK_VIDEO_MEDIA, durationS: null } })).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("闸门以内照发 —— belt 不该拦住最常见的那张照片", async () => {
    fetchMock.mockResolvedValue(okResponse('{"summary":"x","isDocument":false}'));
    await new ArkUnderstandingProvider("k").understand(IMAGE_REQ);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("并发闸门:理解不许把商家的生成挤成 429", () => {
  it("理解请求和付费生成走同一个进程内闸门", async () => {
    const gate = new RequestGate(1);
    __setProviderRequestGateForTests(gate);
    let peakSeen = 0;
    fetchMock.mockImplementation(async () => {
      peakSeen = Math.max(peakSeen, gate.inFlight);
      await new Promise((r) => setTimeout(r, 5));
      return okResponse('{"summary":"x","isDocument":false}');
    });
    const p = new ArkUnderstandingProvider("k");
    await Promise.all([p.understand(IMAGE_REQ), p.understand(IMAGE_REQ), p.understand(IMAGE_REQ)]);
    expect(gate.peakInFlight).toBeLessThanOrEqual(1);
    expect(peakSeen).toBeLessThanOrEqual(1);
  });
});

describe("工厂:安全默认", () => {
  it("未配供应商 → mock,不出网", () => {
    expect(createUnderstandingProvider({} as NodeJS.ProcessEnv)).toBeInstanceOf(MockUnderstandingProvider);
    expect(createUnderstandingProvider({ GENERATION_PROVIDER: "mock" } as NodeJS.ProcessEnv)).toBeInstanceOf(MockUnderstandingProvider);
  });

  it("选了供应商却没 key → 抛,不静默降级(配错不许假装在工作)", () => {
    expect(() => createUnderstandingProvider({ GENERATION_PROVIDER: "byteplus" } as NodeJS.ProcessEnv)).toThrow();
  });

  it("配齐了才拿到真端口", () => {
    const p = createUnderstandingProvider({ GENERATION_PROVIDER: "byteplus", BYTEPLUS_API_KEY: "k" } as NodeJS.ProcessEnv);
    expect(p).toBeInstanceOf(ArkUnderstandingProvider);
  });

  it("端口名是白标的", () => {
    const p = createUnderstandingProvider({ GENERATION_PROVIDER: "byteplus", BYTEPLUS_API_KEY: "k" } as NodeJS.ProcessEnv);
    expect(p.name.toLowerCase()).not.toMatch(/byteplus|bytedance|ark\b|seed/);
  });
});

describe("mock 端口本身", () => {
  it("三个 kind 都吐得出合法形状,离线也把 caption → doc-extract 那条线走通", async () => {
    const p = new MockUnderstandingProvider();
    const cap = JSON.parse((await p.understand(IMAGE_REQ)).text);
    expect(cap.isDocument).toBe(false);
    const menu = JSON.parse((await p.understand({ ...IMAGE_REQ, mediaUrl: "https://x/menu.jpg" })).text);
    expect(menu.isDocument).toBe(true);
    expect(JSON.parse((await p.understand(DOC_REQ)).text).products.length).toBeGreaterThan(0);
    expect(JSON.parse((await p.understand(VIDEO_REQ)).text).summary).toBeTruthy();
  });

  it("mock 一次网都不出", async () => {
    await new MockUnderstandingProvider().understand(IMAGE_REQ);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
