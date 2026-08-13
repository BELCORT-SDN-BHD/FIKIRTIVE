/**
 * understanding — 素材理解的供应商端口(#784)。
 *
 * 和 `GenerationProvider` 是**两个**端口,不是一个端口多一个方法,理由是钱的形状不同:
 * 生成的每一次调用都是商家付过钱的一笔,失败要分「扣没扣」;理解是平台自己出的、
 * 不到千分之几分钱的一次读图,失败就是失败,重试一次的代价接近零。把两种钱塞进一个
 * 端口,迟早会有人把 `chargedError` 那套纪律套到不该套的地方,或者反过来。
 *
 * 白标:内部 kind → 供应商模型 id 的映射只住在这个文件里(和 IMAGE_MODEL_MAP /
 * VIDEO_MODEL_MAP 同一条纪律),错误信息里不出现供应商名。
 *
 * 未核实的地方,老实写在这里(与本仓「不确认就不发明参数」的规矩一致):
 *   · 模型 id `seed-2-0-mini` 取自票面。本仓其它两台引擎的 id 都是 arkcli 只读核实过的
 *     **带版本**形态,这一台还没核过 —— 部署窗口必须先 `arkcli models get` 核一次。
 *     核不到就让它照下面的 fail-closed 抛错,不要猜一个版本号补上去。
 *   · 视频输入的 `fps` 抽帧参数、`detail: "low"` 与 `response_format: json_schema`
 *     都按官方文档形状发出;账户上的参数目录当时是空的,同样在部署窗口实测一次。
 * 这两条都不挡本票:mock 端口下整条链路是完整的,而 key 没配时工厂本来就回 mock。
 */
import {
  UNDERSTANDING_CAPS,
  UNDERSTANDING_JSON_SCHEMAS,
  UNDERSTANDING_MODEL,
  UNDERSTANDING_PROMPTS,
  UNDERSTANDING_REQUEST_TIMEOUT_MS,
  UNDERSTANDING_VIDEO_SAMPLE_FPS,
  type UnderstandingKind,
} from "@fikirtive/core";
import { ARK_BASE } from "./byteplus.js";
import { providerRequestGate } from "./provider-concurrency.js";

/** 内部代号 → 供应商基础模型 id。缺映射 = 立刻抛(fail closed),绝不猜。 */
const UNDERSTANDING_MODEL_MAP: Record<string, string> = { [UNDERSTANDING_MODEL]: "seed-2-0-mini" };

export interface UnderstandingRequest {
  kind: UnderstandingKind;
  /** 素材的短时效 presigned GET —— 由 worker 现签,永不收客户端传来的 URL(D19)。 */
  mediaUrl: string;
  /** 素材真实 mime(Asset.mime,ingest 已按字节校正过)。决定发图还是发视频。 */
  mime: string;
}

export interface UnderstandingUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface UnderstandingResult {
  /** 模型回的原文。结构化解析在 core(parseUnderstandingJson + 各 kind 的清洗)。 */
  text: string;
  usage: UnderstandingUsage;
}

export interface UnderstandingProvider {
  readonly name: string;
  understand(req: UnderstandingRequest): Promise<UnderstandingResult>;
}

/** 素材读不出来(损坏、格式不受支持)——**重试也没用**,worker 直接落 FAILED 不再排队。 */
export function unreadableMediaError(message: string): Error {
  return Object.assign(new Error(message), { unreadable: true as const });
}

export function isUnreadableMediaError(e: unknown): boolean {
  return e instanceof Error && (e as { unreadable?: boolean }).unreadable === true;
}

/* ---------------- mock(离线、确定性、$0)---------------- */

/**
 * 离线端口。**每一个测试都走它**(工程纪律:理解相关的测试绝不真调供应商),
 * 未配 key 的开发环境也走它。产物是合法的 json_schema 形状,所以 worker 的
 * 落盘、BrandRecord upsert、品牌记忆写入都能在没有网络的情况下被完整测到。
 *
 * 一个刻意的细节:文件名里带 `menu` 的图片会把 `isDocument` 置 true —— 三件套之间
 * 那条连接线(caption → doc-extract)因此在离线下也是活的,而不是只有真调用才走得通。
 */
export class MockUnderstandingProvider implements UnderstandingProvider {
  readonly name = "mock";
  async understand(req: UnderstandingRequest): Promise<UnderstandingResult> {
    const looksLikeMenu = /menu|price|flyer/i.test(req.mediaUrl);
    const body =
      req.kind === "image-caption"
        ? {
            summary: "A product photo from the owner's library.",
            category: "product",
            colors: ["warm neutral"],
            scene: "studio",
            isDocument: looksLikeMenu,
          }
        : req.kind === "doc-extract"
          ? { products: [{ name: "Sample item", price: "RM 10", category: "menu" }] }
          : { summary: "A short walk through a small shop.", facts: ["The shop has counter seating."] };
    const text = JSON.stringify(body);
    return { text, usage: { inputTokens: 100, outputTokens: Math.ceil(text.length / 4) } };
  }
}

/* ---------------- 生产端口 ---------------- */

/** 图片一张、视频一段 —— 视频按低帧率抽帧,这是「不到一条视频 1%」能成立的前提。 */
function contentPartFor(req: UnderstandingRequest): Record<string, unknown> {
  const base = (req.mime || "").toLowerCase();
  if (base.startsWith("video/")) {
    return { type: "video_url", video_url: { url: req.mediaUrl, fps: UNDERSTANDING_VIDEO_SAMPLE_FPS, detail: "low" } };
  }
  // 图片(含被 caption 判成菜单后再跑 doc-extract 的那一张):低精度已经够读大字菜单,
  // 而高精度会把输入 token 推高一个量级 —— 那正是承诺破掉的地方。
  return { type: "image_url", image_url: { url: req.mediaUrl, detail: "low" } };
}

export class ArkUnderstandingProvider implements UnderstandingProvider {
  readonly name = "understanding";
  constructor(private apiKey: string) {}

  async understand(req: UnderstandingRequest): Promise<UnderstandingResult> {
    const model = UNDERSTANDING_MODEL_MAP[UNDERSTANDING_MODEL];
    // fail closed:没核实过的模型 id 宁可整条队列不跑,也不发一个猜出来的 id。
    if (!model) throw new Error("understanding provider has no model mapping");
    const caps = UNDERSTANDING_CAPS[req.kind];
    const schema = UNDERSTANDING_JSON_SCHEMAS[req.kind];

    const body = {
      model,
      max_tokens: caps.maxOutputTokens,
      // 温度压到底:同一张图两次读出两套产品行,商家看到的是「Otto 记错了」。
      temperature: 0,
      messages: [
        {
          role: "user",
          content: [contentPartFor(req), { type: "text", text: UNDERSTANDING_PROMPTS[req.kind] }],
        },
      ],
      ...(schema
        ? { response_format: { type: "json_schema", json_schema: { name: schema.name, strict: true, schema: schema.schema } } }
        : {}),
    };

    // 和付费生成打的是**同一个账户**的并发额度,所以走同一个进程内闸门。理解请求便宜,
    // 但它占的位子和一张付费图占的位子一样大 —— 不进闸门,理解就会把商家的生成挤成 429。
    const res = await providerRequestGate()
      .run(() =>
        fetch(`${ARK_BASE}/chat/completions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(UNDERSTANDING_REQUEST_TIMEOUT_MS),
        }),
      )
      .catch((e: unknown) => {
        // 连回应都没有。这里**不需要**生成那一侧的「算不算扣过费」纪律:理解不进商家账本,
        // 重试一次的代价是我们自己那几厘钱。所以是普通错误,让队列正常重试。
        throw new Error(`understanding request got no response (${e instanceof Error ? e.message : String(e)})`);
      });

    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 300);
      // 日志里带 status 与截断后的 detail,但**不带 mediaUrl**(presigned URL 带签名)。
      // detail 只进服务器日志,不进抛出的 message —— 那条 message 会被 worker 落库,
      // 而供应商的回话里可能带模型名。
      console.error("understanding request failed:", { kind: req.kind, status: res.status, detail });
      // 400/415/422 = 这段素材它读不了。重试同一份字节永远是同一个答案 —— 终止,不排队。
      if (res.status === 400 || res.status === 415 || res.status === 422) {
        throw unreadableMediaError(`understanding provider rejected the file (${res.status})`);
      }
      throw new Error(`understanding request failed (${res.status})`);
    }

    let data: {
      choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    try {
      data = (await res.json()) as typeof data;
    } catch (e) {
      throw new Error(`understanding response was unreadable (${e instanceof Error ? e.message : String(e)})`);
    }
    const raw = data.choices?.[0]?.message?.content;
    // 多模态回复可能是字符串,也可能是 [{type:"text",text:"…"}] —— 两种都收,别的形状当读不出来。
    const text =
      typeof raw === "string"
        ? raw
        : Array.isArray(raw)
          ? raw
              .map((p) => (p && typeof p === "object" && typeof (p as { text?: unknown }).text === "string" ? (p as { text: string }).text : ""))
              .join("")
          : "";
    if (!text.trim()) throw new Error("understanding response had no text");
    return {
      text,
      usage: {
        inputTokens: Number(data.usage?.prompt_tokens) || 0,
        outputTokens: Number(data.usage?.completion_tokens) || 0,
      },
    };
  }
}

/**
 * 端口工厂。**默认 mock**,和 `createGenerationProvider` 同一条安全默认:
 * 配错的生产环境不会安静地开始烧钱,开发/测试永远不碰网络。
 *
 * 复用 `GENERATION_PROVIDER=byteplus` 与同一把 key:理解走的是同一个供应商账户,
 * 多开一个开关只会多一种「两个变量对不上」的配置漂移。总开关是产品侧的
 * `ASSET_UNDERSTANDING`(@fikirtive/core),不在这里再造一个。
 */
export function createUnderstandingProvider(env: NodeJS.ProcessEnv = process.env): UnderstandingProvider {
  if (env.GENERATION_PROVIDER === "byteplus") {
    const key = env.BYTEPLUS_API_KEY;
    if (!key) throw new Error("GENERATION_PROVIDER=byteplus but BYTEPLUS_API_KEY is not set");
    return new ArkUnderstandingProvider(key);
  }
  return new MockUnderstandingProvider();
}
