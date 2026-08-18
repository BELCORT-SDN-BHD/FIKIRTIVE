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
 * ── 2026-08-18 实测(本账户,只读核实)───────────────────────────────────────
 * 上一版这里写的是「模型 id 取自票面、还没核过」,而那句老实话后来**没人去核**:
 * 裸别名 `seed-2-0-mini` 在本账户不解析,生产两天里每一次理解请求都是 404。所以这一段
 * 现在写的是核实过的事实,不是待办:
 *   · 模型 id = `seed-2-0-mini-260428`(**带版本**,和本仓另外两台引擎同一条形态纪律)。
 *     裸别名实测 404;带版本实测 200,`response_format: json_schema` 被接受,六张真图
 *     六次读对。
 *   · `detail: "low"` **被尊重**:同一张图 low 记 642 prompt token、high 记 1304 ——
 *     像素闸那一段假设的「万一被忽略」没有发生(闸仍然留着,它是 belt)。
 *   · 这一族模型**默认开思考**,而思考按输出 token 计费:开着比关着贵约 4 倍、慢约 4 倍,
 *     准确率还更低(读一张菜单它会开始自我辩论)。所以请求体里显式 `thinking.disabled` ——
 *     那不是省钱的微调,是这条链路的正确档位。
 */
import {
  UNDERSTANDING_CAPS,
  UNDERSTANDING_JSON_SCHEMAS,
  UNDERSTANDING_MODEL,
  UNDERSTANDING_PROMPTS,
  UNDERSTANDING_REQUEST_TIMEOUT_MS,
  UNDERSTANDING_VIDEO_SAMPLE_FPS,
  understandingPreflight,
  type UnderstandingKind,
  type UnderstandingMedia,
} from "@fikirtive/core";
import { ARK_BASE } from "./byteplus.js";
import { providerRequestGate } from "./provider-concurrency.js";

/**
 * 内部代号 → 供应商基础模型 id。缺映射 = 立刻抛(fail closed),绝不猜。
 *
 * **带版本号**,和 IMAGE_MODEL_MAP / VIDEO_MODEL_MAP 一样(2026-08-18 只读核实:裸别名
 * `seed-2-0-mini` 在本账户 404,`seed-2-0-mini-260428` 200)。别名看起来更耐久,实际上
 * 是一个没人验过的假设 —— 而它失败的形状是 404,和「我们发错了参数」长得一模一样。
 */
const UNDERSTANDING_MODEL_MAP: Record<string, string> = {
  [UNDERSTANDING_MODEL]: "seed-2-0-mini-260428",
};

export interface UnderstandingRequest {
  kind: UnderstandingKind;
  /** 素材的短时效 presigned GET —— 由 worker 现签,永不收客户端传来的 URL(D19)。 */
  mediaUrl: string;
  /** 素材真实 mime(Asset.mime,ingest 已按字节校正过)。决定发图还是发视频。 */
  mime: string;
  /**
   * 素材的尺寸/时长/字节(Asset 的那几列)。**必填** —— 端口在发请求之前拿它再问一次
   * pre-flight(见 {@link ArkUnderstandingProvider.understand} 的 belt 段)。选填就等于
   * 「忘了传 = 静默放行」,而那正是这道 belt 存在的原因。
   */
  media: UnderstandingMedia;
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

/**
 * **我方**的请求或配置坏了(模型 id 不存在、key 不对、schema 被拒)——
 * 商家的文件一点问题都没有,所以它永远不许变成一行「这个文件读不了」的终态。
 *
 * 这是本次事故的形状:一个没核过的模型 id 让每一次调用都 404,而 404 之前被归进
 * 「这份素材读不了」那一类,于是每一个商家的每一份好文件被逐个永久判死。
 */
export function providerConfigError(message: string): Error {
  return Object.assign(new Error(message), { providerConfig: true as const });
}

export function isProviderConfigError(e: unknown): boolean {
  return e instanceof Error && (e as { providerConfig?: boolean }).providerConfig === true;
}

/**
 * 一次失败到底是**谁**坏了。三答案,三条处置路线(worker 的 handleUnderstand):
 *   `media`     这份字节读不了 ⇒ 终态 FAILED(重试同一份字节永远同一个答案)
 *   `config`    我们的请求/配置坏了 ⇒ **绝不写终态**,重试到上限后进可恢复的暂停态
 *   `transient` 供应商那边这会儿不行 ⇒ 普通重试
 */
export type UnderstandingFailureClass = "media" | "config" | "transient";

/**
 * 一句抱怨要算成「这份字节坏了」,必须**同时**满足两件事:
 *   ① 它指名在说这份**素材**(MEDIA_SUBJECT_WORDS),而不是在说我们发过去的别的东西;
 *   ② 它说的是**这些字节读不动**(MEDIA_DAMAGE_WORDS),而不是「这个东西我不支持/参数不对」。
 * 少任何一半都倒向 config。
 *
 * 为什么必须是两半(判官 P2-1):裸子串会自己长出反例。上一版名单里有一个光秃秃的
 * `decode`,而供应商回一句 "failed to decode request body"(**我方请求**坏了)照样命中 ——
 * 于是全租户的好文件又一次被判死刑,和本次事故一字不差的同一个形状,只是换了一扇门进来。
 *
 * 名单窄是刻意的,因为两个方向的代价不对称:把 config 错判成 media,一个配置错误会把
 * 每个商家的每一份好文件逐个永久判死;把 media 错判成 config,代价只是那一份文件多跑几次
 * 重试,然后停在一个可恢复的暂停态里 —— 没有任何东西被永久毁掉。
 */
const MEDIA_SUBJECT_WORDS = ["image", "video", "media", "picture", "frame"] as const;
/**
 * 刻意**不**收 `invalid` / `unsupported` / `format` 这三个词:它们最常出现的地方是
 * 「这个参数不对」和「这个模型不支持」——两者都是我方配置。实测形状 `The parameter
 * \`image_url\` specified in the request are not valid` 同时带 image 和 invalid,
 * 收了它们,这一句会被判成「商家的图坏了」。
 */
const MEDIA_DAMAGE_WORDS = ["decode", "corrupt", "damaged", "truncated", "unreadable"] as const;
/** HTTP 自己定义的那一句,语义无歧义(415 之外也可能出现在正文里)。 */
const UNSUPPORTED_MEDIA_TYPE = "unsupported media type";

/**
 * 失败分类的**唯一**判据。显式函数 + 逐形状测试,不是一个 status code 的一刀切
 * (上一版就是 `400 || 415 || 422 ⇒ 这份素材读不了`,而 400 同样是「我们发错了」最常见的
 * 回答 —— 实测 seed-1-6-flash 对我们的 maxLength schema 就回 400)。
 *
 * 判据表(逐行都有测试):
 *   | 形状                              | 归类       | 为什么                                  |
 *   |-----------------------------------|-----------|-----------------------------------------|
 *   | 408 / 429 / 5xx                   | transient | 供应商侧或限流,和这份文件、这份配置都无关   |
 *   | 415                               | media     | HTTP 语义就是「这个媒体类型我不收」         |
 *   | 正文里 "unsupported media type"     | media     | HTTP 自己定义的那句话,无歧义              |
 *   | 正文**同时**指名素材 + 说字节读不动    | media     | 供应商指名道姓说这份字节坏了               |
 *   | 其余 4xx(400/401/403/404/422)     | config    | **证据不足的一边** —— 见上,倒向「我方坏」  |
 *   | 其它                              | transient | 不该发生;不确定就不写终态                 |
 */
export function classifyUnderstandingFailure(status: number, detail: string): UnderstandingFailureClass {
  if (status === 408 || status === 429 || status >= 500) return "transient";
  if (status === 415) return "media";
  const body = (detail || "").toLowerCase();
  if (body.includes(UNSUPPORTED_MEDIA_TYPE)) return "media";
  // 两半都要:指名素材 **且** 说这些字节读不动。少一半 = 证据不足 = config。
  const namesTheMedia = MEDIA_SUBJECT_WORDS.some((word) => body.includes(word));
  const saysTheBytesAreBad = MEDIA_DAMAGE_WORDS.some((word) => body.includes(word));
  if (namesTheMedia && saysTheBytesAreBad) return "media";
  if (status >= 400) return "config";
  return "transient";
}

/**
 * 供应商回了 200、报了用量,但正文是空的 —— **这一趟钱已经花了**。
 *
 * 用量必须跟着错误走出这个函数(worker 拿它落库):上上版在这里抛一个普通 Error,用量随栈
 * 一起丢掉,于是平台日预算的 SUM 对这一整类失败视而不见,连续的空响应可以一直计费而账面
 * 永远是零。
 *
 * **它是 config 类,不是 media 类**(判官 P2-2)。上一版把空正文当成「这份文件读不了」写死
 * 终态,而空正文最可能的成因根本不在文件上 —— 最具体的那个形状:`thinking` 被重新打开
 * (供应商改默认,或者有人删了 `disabled`),思考 token 吃满 `max_tokens`,`content` 于是
 * 空着回来。那一刻**每个商家的每一份文件**都会拿到空正文,而按上一版的处置,它们会被逐行
 * 永久判死 —— 和 2026-08-18 那次事故一字不差,只是换了一扇门进来。
 *
 * 代价说清楚:和 404 不同,这条路**每一次重试都真的花钱**。兜住它的不是这个分支自己,是
 * 平台日预算那道闸(每一次调用之前都查一次 SUM);烧到上限就整条链路暂缓,次日复位。
 * 拿「一天至多烧掉日预算」换「商家的素材一件都不丢」——这条链路的纪律就是这么定的。
 */
export function emptyUnderstandingResponseError(usage: UnderstandingUsage): Error {
  return Object.assign(new Error("understanding response had no text"), {
    providerConfig: true as const,
    understandingUsage: usage,
  });
}

/** 错误上挂着的、**已经计费**的用量。没有就返回 null(那一趟真的没花钱)。 */
export function understandingErrorUsage(e: unknown): UnderstandingUsage | null {
  if (!(e instanceof Error)) return null;
  const usage = (e as { understandingUsage?: UnderstandingUsage }).understandingUsage;
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = Number(usage.inputTokens) || 0;
  const outputTokens = Number(usage.outputTokens) || 0;
  return { inputTokens, outputTokens };
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

    // ── 输入侧的硬闸(belt)────────────────────────────────────────────────────
    // 下面的请求体里只有 `max_tokens`,而那是**输出**上限:这个 API 没有任何「输入最多
    // 多少 token」的参数,所以输入侧唯一能设的闸就是「这份素材根本不发出去」。
    // worker 已经在签 URL 之前问过同一道闸;这里是第二道,用的是**同一个函数、同一组常量**
    // (@fikirtive/core `understandingPreflight`),不另抄一份数字。
    // 两道都在 fetch 之前 —— 拦住的时候一分钱没花、一个请求没发。
    const verdict = understandingPreflight(req.kind, req.media);
    if (verdict !== "ok") {
      throw new Error(`understanding refused this file before sending it (${verdict})`);
    }

    const body = {
      model,
      max_tokens: caps.maxOutputTokens,
      // 温度压到底:同一张图两次读出两套产品行,商家看到的是「Otto 记错了」。
      temperature: 0,
      // **显式关掉思考。** 这一族模型默认开着,而思考按输出 token 计费 —— 2026-08-18 实测:
      // 开着比关着贵约 4 倍、慢约 4 倍,读出来还更不准。这条链路要的是「看图说事实」,
      // 不是让模型对着一张菜单自我辩论。
      thinking: { type: "disabled" },
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
      const failure = classifyUnderstandingFailure(res.status, detail);
      console.error("understanding request failed:", { kind: req.kind, status: res.status, failure, detail });
      // 分三条路,判据在 classifyUnderstandingFailure(那张表就是这三行的全部理由)。
      if (failure === "media") throw unreadableMediaError(`understanding provider rejected the file (${res.status})`);
      if (failure === "config") {
        throw providerConfigError(`understanding request was refused before the file was read (${res.status})`);
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
    const usage: UnderstandingUsage = {
      inputTokens: Number(data.usage?.prompt_tokens) || 0,
      outputTokens: Number(data.usage?.completion_tokens) || 0,
    };
    // 200 + 空正文:失败,但**带着用量**失败(见 emptyUnderstandingResponseError)。
    if (!text.trim()) throw emptyUnderstandingResponseError(usage);
    return { text, usage };
  }
}

/**
 * 端口工厂。**默认 mock**:配错的环境不会安静地开始烧钱,开发/测试永远不碰网络。
 * (`createGenerationProvider` 从前是同一条默认,C1b ① 之后已经不是 —— 它在生产上缺配置会
 * 直接拒绝并退款。这里保留默认 mock 是因为钱的形状不同:素材理解**商家一分钱不付**,
 * 没有预留可退,也就没有「悄悄卖假货」这个失败模式。)
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
