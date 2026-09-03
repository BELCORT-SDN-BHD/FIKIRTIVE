/**
 * Shot/session generation contract (redesign — Gen space "Generate").
 *
 * Unlike refgen (which produces an entity's ReferenceImages), this produces a
 * Generation (a candidate/shot result) the way uploadCandidates does — same
 * Generation row, source GENERATED, optionally bound to a shot. Conditioning
 * is the @mentioned entities' reference images, resolved server-side from
 * entityIds (D19 trust boundary — no client URLs).
 *
 * v1 = image (t2i / ref-conditioned edit) via the shared GenerationProvider.
 * Video (i2v) lands as a follow-up slice on this same skeleton.
 */
import { z } from "zod";
import { costPinValue, type CostPinKey } from "./cost-pins.js";
import { anchoredVideoAction, anchoredActionUnavailableReason } from "./video-actions.js";
import { redactProviderNames } from "./provider-secrecy.js";

/**
 * 图片引擎菜单 —— **两个槽位**(Creation S2 §8.1①,2026-09-02)。
 *
 * `seedream` 是 lite 档(默认;组图),`seedream-pro` 是 pro 档(透明底 / 人物精修)。
 * 两个键都是**内部槽位名**,不是商家可见字符串:商家那一侧只看得到能力名词
 * (画布只发 `capability-image-N` 别名,`provider-secrecy` 再兜一层),供应商真 id
 * 只住在 `packages/generation/src/byteplus.ts` 的映射表里。
 *
 * 上架一个图片槽位要同时落三处,缺一处「卖什么」与「做什么」当场分家:
 * ①本菜单 ②`GEN_IMAGE_MODEL_OPTIONS` ③`GEN_IMAGE_COST_PIN`(编译期强制)。
 * 而**能不能卖**是另一回事:见 `spend.ts` 的 `SELLABLE_IMAGE_VARIANTS` ——
 * 菜单是能力,白名单是价目,pro 的大图与图层分离今天没有价,所以不可售。
 */
export const GEN_MODELS = ["seedream", "seedream-pro"] as const;
export type GenModel = (typeof GEN_MODELS)[number];

/**
 * 图片**图种**(SKU 的第二根轴,Creation S2 §8.1①)。
 *
 * 为什么需要它:图片的 SKU 不只是「哪个槽位」——pro 槽位下面有三种图,而
 * 规格只给了其中一种价(标准图 2cr/张)。大图的计价单位从未实证(`cost-pins.ts`
 * 规矩 ②:大图不入表 = 不可售),图层分离在 S1「不做」节里被明令排除。
 * 少了这根轴,`assertSpendableModel` 就只能判到槽位级,pro 一上架等于把三种图
 * 一起放行 —— 其中两种根本没有价。
 *
 * 默认是 `standard`:今天没有任何入口能请求另外两种,它们只可能来自程序内调用,
 * 而那正是 CREATE-A6 要挡的那一下。
 */
export const GEN_IMAGE_VARIANTS = ["standard", "large", "layered"] as const;
export type GenImageVariant = (typeof GEN_IMAGE_VARIANTS)[number];
export const GEN_IMAGE_DEFAULT_VARIANT: GenImageVariant = "standard";
/**
 * 视频引擎菜单 —— **在产的只有这一台**。
 *
 * #647 T6:这里原本挂着 13 格,其中 12 格(kling / veo3.1 系 / ltx-2 / pixverse-v6 /
 * grok-imagine / wan-2.5 / hailuo-02 / seedance-2)全部走当时的备用供应商接线,**从来
 * 没有在生产出过一条片**。它们同时占着事实表、档位表、费率表、接线表各一格,后台各一个
 * 开关,知识库各一列家族 —— 一整片「说的」而没有「做的」。菜单上没有一格是假的(#641),
 * 所以它们下架;那个备用供应商本身也已在 #952 整族删除(ADR 0003)。
 *
 * 留下的 seedance-2-mini 是 BytePlus 直连、在产实付、毛利闸盯着的那一台。
 * 要再卖一台:先给它 flat 且清地板的价(FLAT_PRICED_VIDEO_MODELS + 成本输入),
 * 再在这里、事实表、档位表、费率与 @fikirtive/generation 的 VIDEO_CFG 一起加 ——
 * 缺一处,「卖什么」和「做什么」当场分家。
 *
 * #769(Founder 已裁 2026-08-08,眼看 7 条真实对比成片后原话「目前来说 mini 就行了」):
 * 这一格从 `seedance-2-fast` **换 key** 到 `seedance-2-mini`,不是在同一个 key 底下悄悄
 * 换后端 id。理由是这张表管的是「我们卖哪一台引擎」,而这个集合正是
 * `FLAT_PRICED_VIDEO_MODELS`「上架一台新引擎绝不能自动可售」那条纪律的锚点 ——
 * 留着 fast 的 key 跑 mini,新引擎就**继承**了老引擎的售价资格,那条纪律当场失效;
 * 同时事实表的 label、毛利闸的成本 key 与手抄来源、以及 GenJob 落库的引擎名会全部说谎。
 * 换 key 之后 `modelFamily()` 仍按前缀归到 seedance 家族,知识库的调教一格不用改。
 *
 * Seedance 2.5 同日(2026-08-08)评估过、**当日裁定不做**,留一句免得下次有人再发现一遍:
 * 引擎本身在册可见(`dreamina-seedance-2-5-260628`,4–30 秒、480p/720p、24fps),但牌价
 * $10.70/M 是 mini 的 3.06 倍,现行价目表卖它会跌破地板;账户侧的计费项开通也没到位。
 * 先把 mini 的能力面做尽。要重启这件事:先裁价,再实测参数面(元数据不给比例与像素表,
 * 照抄 2.0 的就是本文件明令禁止的「给没核过的档位编数字」)。
 *
 * Creation S2 §8.1①(2026-09-02):第二格 `seedance-2-0` 上架,走的正是上面那条纪律 ——
 * 它有自己的成本钉点(`video:seedance-2.0:1080p-*`)、自己的已裁价(1080p 11cr/秒,
 * Founder 2026-09-02 追认)、自己的映射表条目,而**不是**在 mini 的 key 底下换后端 id。
 * 它只为一件事存在:1080p 高清档,mini 给不出这一档。
 */
export const GEN_VIDEO_MODELS = ["seedance-2-mini", "seedance-2-0"] as const;
export type GenVideoModel = (typeof GEN_VIDEO_MODELS)[number];

export const GEN_KINDS = ["image", "video"] as const;
export type GenKind = (typeof GEN_KINDS)[number];

/** 知识库按 FAMILY 建格 —— 同一家族的不同版本(seedream 4.5 / 5)共用一条指令,
 *  Founder 调一次而不是每个版本调一次。
 *
 *  #647 T6:原本九个家族,其中七个(kling / veo / ltx / wan / pixverse / grok / hailuo)
 *  是那 12 台假视频引擎带进来的。引擎下架,家族跟着下架 —— 留下的两个正好是两台在产
 *  引擎各自的家族。加一台新引擎:先在 GEN_MODELS / GEN_VIDEO_MODELS 上架,再回来加它的
 *  家族(`menu-truth.test.ts` 钉着两边必须同集)。 */
export const MODEL_FAMILIES = ["seedream", "seedance"] as const;
export type ModelFamily = (typeof MODEL_FAMILIES)[number];

/** The generation MODES the knowledge base keys on alongside family. */
export const GEN_MODES = ["t2i", "i2i", "t2v", "i2v", "i2v-tail"] as const;
export type GenMode = (typeof GEN_MODES)[number];

/** 每个模式属于哪一种作业。知识格是 family × mode,而**家族只服务一种 kind** ——
 *  这张表就是「哪些格子真会被问到」的判据(见 `familyModes`)。 */
export const GEN_MODE_KIND: Record<GenMode, GenKind> = {
  "t2i": "image",
  "i2i": "image",
  "t2v": "video",
  "i2v": "video",
  "i2v-tail": "video",
};

/** Map a (version-specific) model id → its research family, by prefix so a
 *  future version bump inherits the family automatically. An unknown id returns
 *  undefined (the skill falls back to a family-neutral base prompt) — NEVER throws.
 *  seedream/seedance both start "seed" but the full prefixes disambiguate.
 *  #647 T6:下架模型的 id 从此也走这条 undefined —— 「不知道」比「编一个家族出来」诚实。 */
export function modelFamily(modelId: string): ModelFamily | undefined {
  if (modelId.startsWith("seedream")) return "seedream";
  if (modelId.startsWith("seedance")) return "seedance";
  return undefined;
}

/**
 * 一个家族**真会被问到**的模式(#647 T6)。
 *
 * 知识格原本是 9 家族 × 5 模式 = 45 格,读它的两条路(`getEnhanceDirective` /
 * `getCastRule`)都按 (modelFamily(实际模型), deriveMode(实际请求)) 取值 —— 于是
 * 「图像家族 × t2v」这种跨 kind 的格子**永远取不到**:Founder 可以在后台把它填满,
 * 引擎一辈子看不见。那也是一格假菜单。
 *
 * 纯派生,不手抄:家族服务哪种 kind,由在册模型说了算;kind 对应哪几个模式,由
 * `GEN_MODE_KIND` 说了算。上架/下架一个模型,格子当场跟着变。
 */
export function familyModes(family: ModelFamily): GenMode[] {
  const kinds = new Set<GenKind>();
  for (const m of GEN_MODELS) if (modelFamily(m) === family) kinds.add("image");
  for (const m of GEN_VIDEO_MODELS) if (modelFamily(m) === family) kinds.add("video");
  return GEN_MODES.filter((mode) => kinds.has(GEN_MODE_KIND[mode]));
}

/** Derive the generation MODE from a server-resolved request shape — the other
 *  axis the knowledge base keys on. PURE: the caller resolves the booleans from
 *  owned DB state first (R3 — the server is authoritative, never a client mode
 *  string). Mirrors the worker's branching: image + conditioning refs → i2i
 *  (edit), image alone → t2i; video + start frame → i2v (+ end frame → i2v-tail),
 *  video alone → t2v. (An end frame without a start is meaningless → t2v.) */
export function deriveMode(input: {
  kind: GenKind;
  conditioned?: boolean;
  hasSourceImage?: boolean;
  hasTailImage?: boolean;
}): GenMode {
  if (input.kind === "image") return input.conditioned ? "i2i" : "t2i";
  if (input.hasSourceImage) return input.hasTailImage ? "i2v-tail" : "i2v";
  return "t2v";
}

export const MAX_GEN_COUNT = 4;
export const MAX_GEN_PROMPT = 2000;
export const MAX_GEN_ENTITIES = 8;
/** 元素名的长度上限(与 Library 表单同一把尺)。只用来给传输层封顶,不做业务判断。 */
export const MAX_ENTITY_NAME = 120;
export const GEN_VIDEO_SECONDS = 5;
export const REFERENCE_VIDEO_MODEL: GenVideoModel = "seedance-2-mini";
/** Whole-clip reference video window: Seedance needs ≥2s; the upper bound protects COGS
 *  (BytePlus bills by input duration, our charge is flat per resolution). Enforced in the
 *  composer AND server-side in the worker (via Asset.durationS from ingest's ffprobe). */
export const REF_VIDEO_MIN_SECONDS = 2;
export const REF_VIDEO_MAX_SECONDS = 6;
/**
 * #785 —— 一次视频任务里 `image_url` 部件的**总上限 9 张**(首帧/末帧也算在这 9 张里)。
 *
 * 出处与它的诚实度:Seedance 2.0 系列的多模态参考上限(9 图 / 3 视频 / 3 音频)在彼时
 * 另一家模型仓库的入参 schema 与多份三方 API 文档上一致(2026-08-13 核)。第一方 Ark 文档页是
 * JS 渲染的,抓不到正文,所以这个数**没有第一方逐字出处** —— 本文件的规矩是「没核过的
 * 数字不许编」,这里守的是同一条规矩的另一面:**取三方一致的那个数,并且只往少了送**。
 *
 * 为什么可以带着这点不确定上路:上限估高的后果是 task-create 被 4xx 拒绝,而 4xx 是本仓库
 * 唯一「可证明没花钱」的失败(见 byteplus.ts 的 paidPost)—— 退款 + 记零花费,不会有钱的
 * 损失。真正不可接受的是**反过来**:把上限当无限,一次送十几张,那才是拿商家的钱赌。
 *
 * 上限**含首帧/末帧**,因为它们与参考照是同一种部件(`type: "image_url"`)。
 */
export const MAX_VIDEO_IMAGE_PARTS = 9;
/** Image price is flat per image; video price is dynamic — see videoPriceUsd
 *  (scales with duration × resolution × audio × count). */
/**
 * RECORD-ONLY 图片成本记账基准(GenJob.spentUsd + 毛利报表)—— **不是收费**。图片一律按
 * `pricedGenCredits` 收 1 credit/张,与这个数无关(`spend.test.ts` 有钉子测试守着)。
 *
 * $0.035/张:官方按张计价,不分尺寸与比例(所以 #642 补齐八个画幅没有新价格档)。
 * 来源 https://docs.byteplus.com/en/docs/ModelArk/Pricing(2026-08-05 核);同值另有
 * 2026-06 真实账单佐证(docs/design/2026-07-03-harmony-04-costing-model.md §二)。
 *
 * 旧值 $0.04 是当初备用供应商的基数占位 —— F39 的注释自认「pending the founder's
 * actual Ark per-image rate」,高记约 14%。#644 改真。
 *
 * 数值已收编 `cost-pins.ts`(成本的单一权威),此处只是命名出口 —— 改价改钉点,不改这行。
 */
export const GEN_PRICE_USD_PER_IMAGE = costPinValue("image:seedream-lite:per-image");

/* ---------------- image shape (#642) ---------------- */

/** 图片画幅菜单，**default-first**（照视频侧的选项表写法）。图像引擎**按张计价、不分
 *  尺寸比例**，所以补齐画幅没有新价格档、没有 COGS 压力 —— 价格路径一行都不用改。 */
export const GEN_IMAGE_ASPECTS = ["1:1", "9:16", "16:9", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;
export type GenImageAspect = (typeof GEN_IMAGE_ASPECTS)[number];
/** 菜单第一项 = 未指定画幅时的默认（t2i 默认方图，与 2026-06-29 起的既有行为一致）。 */
export const GEN_IMAGE_DEFAULT_ASPECT: GenImageAspect = GEN_IMAGE_ASPECTS[0];

/**
 * 引擎对「宽×高」写法的硬约束：总像素必须落在闭区间内，比例必须在 [1/16, 16]。
 *
 * **区间是逐槽位的**，不是全家族一份 —— 规格 §1 明写「各槽位能力差异以逐槽
 * `supported_params` 实查回执为准」。pro 的上限比 lite **低**（4,624,220 < 16,777,216），
 * 所以画幅菜单不能整张照抄：照抄会让契约闸放行一个 pro 收不下的 `size`，商家在付费路上
 * 撞一次必然的「生成失败」。`GEN_IMAGE_MODEL_OPTIONS` 因此逐槽取值，`gen.test.ts` 双向钉着
 * （留下的每一格都在区间内，排除的每一格都真的超限）。
 *
 * 回执来源（零成本只读查询，2026-09-02）：
 *  - lite `seedream-5-0` → `size` 说明「总像素 [3686400, 16777216]，宽高比 [1/16, 16]」
 *    （`arkcli models get seedream-5-0 --transform supported_params --format json`）；
 *  - pro `dola-seedream-5-0-pro` → `size` 说明「总像素 [921600, 4624220]，宽高比 [1/16, 16]」
 *    （回执原件 `preserved/creation-probe-2026-09-02/experiment-3/supported_params-pro.json`）。
 */
export const GEN_IMAGE_MODEL_PIXEL_LIMITS: Record<GenModel, { min: number; max: number }> = {
  "seedream":     { min: 3_686_400, max: 16_777_216 },
  "seedream-pro": { min:   921_600, max:  4_624_220 },
};

/** 默认槽位（lite）的区间 —— 既有命名出口，现在从上表取，不再是第二份手抄。 */
export const GEN_IMAGE_MIN_PIXELS = GEN_IMAGE_MODEL_PIXEL_LIMITS["seedream"].min;
export const GEN_IMAGE_MAX_PIXELS = GEN_IMAGE_MODEL_PIXEL_LIMITS["seedream"].max;

/**
 * 画幅 → 执行层真正发出去的**确切** WxH（2K 档）。
 *
 * 这是「说的」与「做的」共用的**同一份**数据：图像适配器按它拼 `size`
 * （`packages/generation/src/byteplus.ts`），卡面文案按它报尺寸
 * （`EXECUTED_SPEC.image.outputSizes` 直接引用这张表）。改这里一处，两边同时改口。
 *
 * 取值口径：
 *  - 1:1 保持 2048×2048，与今日逐字节一致（补齐画幅不改变既有方图行为）；
 *  - 其余各档取 2K 档格点，并且**每一档都 ≥ GEN_IMAGE_MIN_PIXELS**（引擎下限）；
 *  - **每一档都精确约分为它自称的比例**（零容差，`gen.test.ts` 用整数约分逐档比对）。
 *    这不是洁癖：商家买的是 9:16，一个「差不多的 9:16」就是一次没说出口的降级。
 *    上一版 9:16 取 1600×2848，约分是 50:89（偏 0.125%），已按判官 r1 P2 改为精确格点。
 */
export const GEN_IMAGE_SIZES: Record<GenImageAspect, { width: number; height: number }> = {
  "1:1":  { width: 2048, height: 2048 }, // 4,194,304 px — 精确 1:1
  "9:16": { width: 1620, height: 2880 }, // 4,665,600 px — 精确 9:16（1620 = 9×180, 2880 = 16×180）
  "16:9": { width: 2880, height: 1620 }, // 4,665,600 px — 精确 16:9
  "4:3":  { width: 2304, height: 1728 }, // 3,981,312 px — 精确 4:3
  "3:4":  { width: 1728, height: 2304 }, // 3,981,312 px — 精确 3:4
  "3:2":  { width: 2496, height: 1664 }, // 4,153,344 px — 精确 3:2
  "2:3":  { width: 1664, height: 2496 }, // 4,153,344 px — 精确 2:3
  "21:9": { width: 3136, height: 1344 }, // 4,214,784 px — 精确 21:9（约分 7:3）
};

/** Per-model image controls — mirrors `VideoModelOptions`. Lists are default-first;
 *  `maxCount` = batch ceiling (one request per image, unless the model can make a
 *  coherent SET — see `coherentSet`). */
export type ImageModelOptions = {
  aspectRatios: string[];
  maxCount: number;
  /**
   * #777 —— 这台引擎能不能**一次请求出一整组连贯的图**(同一个模特的五个角度、
   * 同一件产品的五个尺寸,角色与风格从头到尾是同一个)。
   *
   * 它是**能力位**,不是价目:开着的时候,`count` 张图从「count 次调用」变成
   * 「一次调用出 count 张」。商家的收费一格不动(仍是每张 1 显示 credit,
   * `pricedGenCredits` 一行都没改),变的是供应商侧的调用形状 —— 这正是本票
   * 「计费口径变化」的全部内容。
   *
   * 为什么必须是**每台引擎各自声明**而不是一个全局开关:参数面没有在本仓库的
   * 账户上实测过(本工作区禁止真实供应商调用)。这一格就是唯一的开关 ——
   * 部署窗口实测不通过,把它改成 false,组图这条路当场整条下线,菜单、契约、
   * 材料绑定与卡面会一起跟着闭嘴,不需要再找第二处。
   */
  coherentSet: boolean;
};
export const GEN_IMAGE_MODEL_OPTIONS: Record<GenModel, ImageModelOptions> = {
  "seedream": { aspectRatios: [...GEN_IMAGE_ASPECTS], maxCount: MAX_GEN_COUNT, coherentSet: true },
  // Creation S2 §8.1①:pro 槽位。批量与 lite 同(按张计价、不分尺寸比例),但**画幅表
  // 不能照抄** —— 判据是 pro 自己那份 `supported_params` 回执(见
  // `GEN_IMAGE_MODEL_PIXEL_LIMITS` 上面那段的出处):它的总像素上限只有 4,624,220,
  // 而 `GEN_IMAGE_SIZES` 里 16:9 与 9:16 两格的 2K 格点都是 2880×1620 = 4,665,600 px,
  // 超限 41,380 px。照抄整张表 = 契约闸放行两个 pro 必拒的 size,适配器照旧 POST,
  // 商家在付费路上撞一次注定的「生成失败」。所以这里只留落在 pro 区间内的六格
  // (不改 `GEN_IMAGE_SIZES` 的任何数字:那张表是 lite 与卡面共用的,pro 的格点没有回执)。
  // `coherentSet` 保守取 **false** —— 组图是**逐槽实测**才敢开的能力位(见上面那段注释:
  // 「参数面没有在本仓库的账户上实测过」),pro 的组图行为尚未实测,未验先禁。
  "seedream-pro": {
    aspectRatios: ["1:1", "4:3", "3:4", "3:2", "2:3", "21:9"],
    maxCount: MAX_GEN_COUNT,
    coherentSet: false,
  },
};

/**
 * **图片槽位 → 成本钉点**(成本的单一权威在 `cost-pins.ts`,这里只做映射)。
 *
 * 类型 `Record<GenModel, CostPinKey>` 就是这条围栏的全部内容:图片菜单加一格而不给它
 * 配成本钉点,**编译期就红**。`margin-truth.ts` 的 `IMAGE_MODEL_COST_PIN` 现在是本表的
 * 别名(CI 闸读的是那个名字),不是第二份手抄 —— 成本只有一处说了算。
 */
export const GEN_IMAGE_COST_PIN: Record<GenModel, CostPinKey> = {
  "seedream": "image:seedream-lite:per-image",
  "seedream-pro": "image:seedream-pro:per-image",
};

/** 一张图的记账成本(USD)。菜单外的历史 id 回落 lite 档 —— 与 `GEN_PRICE_USD_PER_IMAGE`
 *  的既有行为逐字一致(本函数上线前所有图片行都按这个数记账),纯函数,永不抛。 */
export function genImageCostUsd(model: string): number {
  const pin = GEN_IMAGE_COST_PIN[model as GenModel];
  return pin ? costPinValue(pin) : GEN_PRICE_USD_PER_IMAGE;
}

/** 认不出来的图片槽位。商家可见字符串里一个型号名都不许有(S1 九问4)。 */
export const IMAGE_TIER_UNKNOWN = "that image tier isn't available";

/**
 * 无约束字符串(DB 里的 `GenJob.model`)→ 图片菜单上的一格,**认不出来就抛**。
 *
 * 判官 r1 P2 落修的配套件:端口契约(`GenerationRequest.model`)现在是两张菜单的并集,
 * 所以 worker 不再靠 `as` 强转把一个任意字符串塞进去 —— 它必须先收窄。
 *
 * 收窄的方向只能是**拒绝**,不能是回落默认槽位:回落 = 一条没在册的历史行照常跑、
 * 照常收钱,而商家买的那台引擎根本没跑。抛在任何付费调用之前 ⇒ 与适配器过去那句
 * 「no image model mapping」落在同一个 try 里、同一条 fail-closed 退款路上,
 * 只是现在由**编译器看得见的那一层**说出口。
 */
export function genImageModel(model: string): GenModel {
  if (!(GEN_MODELS as readonly string[]).includes(model)) throw new Error(IMAGE_TIER_UNKNOWN);
  return model as GenModel;
}

/** 这台引擎能不能一次出一整组连贯图(#777)。菜单外的 id 一律 false —— 「不知道」
 *  按「不能」处理,绝不让一个没在册的模型走上组图那条路。PURE,永不抛。 */
export function supportsCoherentSet(model: string): boolean {
  return GEN_IMAGE_MODEL_OPTIONS[model as GenModel]?.coherentSet === true;
}

/** 一组连贯图至少要两张 —— 一张图不成组,把 `coherentSet` 挂在 count=1 上只是
 *  一个说了不算数的开关(而它会进材料绑定,让同一个请求莫名其妙判成换了内容)。 */
export const COHERENT_SET_MIN_IMAGES = 2;

/** A model's default image selections (first of each list) — mirrors `videoDefaults`.
 *  Never throws on an unknown id: an unmapped model falls back to the default aspect. */
export function imageDefaults(model: GenModel): { aspectRatio: string } {
  const o = GEN_IMAGE_MODEL_OPTIONS[model] as ImageModelOptions | undefined;
  return { aspectRatio: o?.aspectRatios[0] ?? GEN_IMAGE_DEFAULT_ASPECT };
}

/** 画幅 → 执行层真会产出的像素尺寸。缺省/未知一律回落默认画幅（纯函数，永不抛）——
 *  历史行（迁移前没有画幅快照）走的就是这一条，产出与它们当年一致的方图。 */
export function imageOutputSize(aspectRatio?: string | null): { width: number; height: number } {
  const size = GEN_IMAGE_SIZES[(aspectRatio ?? "") as GenImageAspect];
  return size ?? GEN_IMAGE_SIZES[GEN_IMAGE_DEFAULT_ASPECT];
}

/** 越限的 `size` 被适配器**在 POST 之前**拒掉时抛的那句话。商家可见字符串里
 *  一个型号名都不许有(S1 九问4),所以这里只说能力名词。 */
export const IMAGE_SIZE_OUT_OF_RANGE = "that image shape isn't available on this image tier";

/**
 * 画幅 → 这个**槽位**真发得出去的像素尺寸(判官 r1 P1 落修)。
 *
 * `imageOutputSize` 只认画幅,不认槽位 —— 于是同一格 16:9(2880×1620 = 4,665,600 px)
 * 在 lite 上合法、在 pro 上超限(上限 4,624,220 px),而适配器过去照样 POST 出去。
 * 正常新建路径有契约闸(`genRequest` 按 `GEN_IMAGE_MODEL_OPTIONS[model].aspectRatios`
 * 收窄)挡着,但那道闸挡不住**从数据库快照来的历史行 / 畸形行**:worker 把
 * `job.imageOptions.aspectRatio` 原样信任地交给适配器。所以这道闸必须长在**适配器
 * 会经过的那一层**,也就是这里。
 *
 * **越限 = 抛错拒绝,不是降级、不是自动缩小**(规格「未验先禁」):自动换一个尺寸
 * 就是收了钱交一个商家没买的形状,而且没有一个字说过。未知槽位同样拒 ——
 * 「不知道这台引擎收多大」按「不许发」处理。
 *
 * 抛出的时机在任何付费 POST **之前**,所以这条路是可证明零花费的失败(worker 退款)。
 */
export function imageOutputSizeForModel(
  model: string,
  aspectRatio?: string | null,
): { width: number; height: number } {
  const size = imageOutputSize(aspectRatio);
  const limits = GEN_IMAGE_MODEL_PIXEL_LIMITS[model as GenModel];
  if (!limits) throw new Error(IMAGE_SIZE_OUT_OF_RANGE);
  const pixels = size.width * size.height;
  if (pixels < limits.min || pixels > limits.max) throw new Error(IMAGE_SIZE_OUT_OF_RANGE);
  return size;
}

/**
 * #643 T2 —— 商家说的形状 → 菜单上的那一格。认不出来就 `null`，**绝不猜**。
 *
 * 为什么需要它：商家的原话经 Otto 落到 `desiredAspect` 上时，可能写成 `9x16`、`portrait`，
 * 也可能写成 `9:16`。严格逐字比对会把前两种当成「菜单外的值」，于是静默掉成方图 ——
 * 商家要竖版、拿到方图，而且没人说过一句话。这里只做**写法归一 + 三个明确的人话别名**，
 * 不做模糊猜测：认不出来返回 null，由调用方走「如实披露的降级」那条路。
 *
 * 别名口径（只收敛到菜单上确实存在的一格）：
 *   portrait / vertical → 9:16；landscape / horizontal → 16:9；square → 1:1。
 * 「portrait」在设计上也可以是 3:4 或 2:3 —— 这里取最常用的一格，而这个选择**会被说出口**
 * （卡面/选择器显示的就是真会交付的那一格），不是一次静默替商家做主。
 */
const IMAGE_ASPECT_ALIASES: Record<string, GenImageAspect> = {
  portrait: "9:16",
  vertical: "9:16",
  landscape: "16:9",
  horizontal: "16:9",
  square: "1:1",
};

export function normalizeImageAspect(raw?: string | null): GenImageAspect | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const alias = IMAGE_ASPECT_ALIASES[trimmed];
  if (alias) return alias;
  // 写法归一：`9 x 16` / `9×16` / `9 : 16` 都是同一个形状。
  const canonical = trimmed.replace(/[x×:：\s]+/gu, ":");
  return (GEN_IMAGE_ASPECTS as readonly string[]).includes(canonical)
    ? (canonical as GenImageAspect)
    : null;
}

/** Per-model facts: `label` for INTERNAL/audit copy only (engine names never reach a
 *  merchant surface), `sound` = generates native audio, `tail` = supports an end frame.
 *  Controls + price live in the two helpers below. */
export const GEN_VIDEO_MODEL_INFO: Record<GenVideoModel, { label: string; sound: boolean; tail: boolean }> = {
  "seedance-2-mini": { label: "Seedance 2.0 mini", sound: true, tail: true }, // #646 T5: first+last frames ARE supported (two role-tagged frames in one task)
  // Creation S2 §8.1①. `label` is INTERNAL/audit copy only — it never reaches a merchant
  // surface (that is what provider-secrecy + the capability aliases are for).
  "seedance-2-0": { label: "Seedance 2.0", sound: true, tail: true },
};

/** Per-model controls — each exposes exactly what its engine accepts. Empty array =
 *  no such control. `audioToggle` false = always silent. Lists are picker order.
 *  `maxCount` = batch ceiling (we enqueue N one-clip jobs — the video endpoint has no
 *  num_videos param). Add a model: one entry here + one in @fikirtive/generation's
 *  VIDEO_CFG (双声明纪律 —— 删的时候同样两边一起删,见 GEN_VIDEO_MODELS). */
export type VideoModelOptions = {
  durations: number[];
  resolutions: string[];
  aspectRatios: string[];
  fps: number[];
  audioToggle: boolean;
  maxCount: number;
  /** EXPLICIT defaults (#645 T4). Absent ⇒ first of each list, the pre-#645 rule.
   *  Present ⇒ list order is free to be the PICKER's order without moving what a
   *  merchant gets when they choose nothing. Every value here must be in its list
   *  (pinned by video-tiers.test.ts) — a default off the menu is a default the
   *  contract gate would reject. */
  defaults?: { seconds?: number; resolution?: string; aspectRatio?: string };
  /** i2v-only shape default (#645 T4): with a source frame the engine matches the
   *  frame instead of being told a ratio. Mirrors the image side's「改这张图不变形状」. */
  i2vAspectRatio?: string;
};

/** 「跟着首帧走」——引擎自选比例。**不是一个具体形状**:卡面必须如实显示 Adaptive,
 *  不许翻译成 16:9 之类的具体值(那就是又一次替商家做主还不说话)。 */
export const VIDEO_ASPECT_ADAPTIVE = "adaptive";
export const GEN_VIDEO_MODEL_OPTIONS: Record<GenVideoModel, VideoModelOptions> = {
  // #645 T4:引擎真能给的每一档都开出来 —— duration 整数 [4,15]、480p/720p(mini 无 1080p)、
  // 六比例 + adaptive。列表顺序 = picker 顺序;默认值显式写在 `defaults` 里,与今日逐字一致。
  // #769:换 fast→mini 时这一整格**逐字不动** —— 2026-08-08 对着 mini 实测过参数面,
  // resolution / duration / seed / ratio / generate_audio / priority / return_last_frame 全部
  // 接受并生效,camera_fixed / draft / frames 同样被拒,帧率同为 24fps。抄一份没核过的
  // 档位表是这个文件明令禁止的事,所以这里是「实测同形」而不是「照抄 fast」。
  "seedance-2-mini": {
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["720p", "480p"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", VIDEO_ASPECT_ADAPTIVE],
    fps: [], audioToggle: true, maxCount: 4,
    defaults: { seconds: 5, resolution: "720p", aspectRatio: "16:9" },
    i2vAspectRatio: VIDEO_ASPECT_ADAPTIVE,
  },
  // Creation S2 §8.1① —— 高清槽位。这张表是**能力**表(引擎能给什么),不是价目表:
  //   · 分辨率**照回执如实开四档**(规格 §8.1① 记录的 `supported_params` 回执结论
  //     `[480p, 720p, 1080p, 4k]`)。判官 r1 P2 落修:此前这里先删掉了 4k,于是一张
  //     自称「能力表」的结构不再如实表达供应商能力,而「能力」与「可售」混成一件事之后,
  //     付费闸那一层就再也证明不了自己 —— 4k 会被**契约闸**(引擎做不到)拒,而事实是
  //     引擎做得到、我们**没有给它定价**。4k 不卖改由可售白名单
  //     `SELLABLE_VIDEO_RESOLUTIONS`(spend.ts)排除:行为一格不变(仍然 fail closed、
  //     一分钱收不到),变的是**由哪一道闸如实开口**;
  //   · 时长与 mini 同(4–15 整秒);
  //   · `audioToggle` true —— 声音是 2.0 全系能力,且**不影响报价**(CREATE-A3);
  //   · 参考音频同样是 2.0 全系能力,所以它**不是**升档到本槽位的理由(S1 九问4)。
  // 能力 ≠ 可售:本槽位今天只有 1080p 有自己的成本钉点与已裁价,4k/720p/480p 在
  // `SELLABLE_VIDEO_RESOLUTIONS`(spend.ts)之外 = 不可售,fail closed。默认档写 1080p,
  // 正是因为这是它唯一卖得出去的那一档 —— 默认值落在白名单外就是一个卖不掉的默认。
  "seedance-2-0": {
    durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    resolutions: ["1080p", "720p", "480p", "4k"],
    aspectRatios: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", VIDEO_ASPECT_ADAPTIVE],
    fps: [], audioToggle: true, maxCount: 4,
    defaults: { seconds: 5, resolution: "1080p", aspectRatio: "16:9" },
    i2vAspectRatio: VIDEO_ASPECT_ADAPTIVE,
  },
};

/* ---------------- 能力路由(Creation S2 §8.1①,CREATE-A4)---------------- */

/** 高清档的分辨率名 —— 路由判据写一次,别处引用。 */
export const HD_VIDEO_RESOLUTION = "1080p";
/** 高清档落在哪个槽位;其余分辨率一律走默认槽位。 */
export const HD_VIDEO_MODEL: GenVideoModel = "seedance-2-0";
export const DEFAULT_VIDEO_MODEL: GenVideoModel = "seedance-2-mini";
/** 透明底 / 人物精修落在哪个图片槽位;其余走默认槽位。 */
export const PRO_IMAGE_MODEL: GenModel = "seedream-pro";
export const DEFAULT_IMAGE_MODEL: GenModel = "seedream";

/**
 * 图片侧的**升档能力**(哪几件事非 pro 不可)。缺省全 false ⇒ 走 lite。
 *
 * `fineDetail` 是**今天商家真的选得到的那一格**(判官 r1 P1 落修):付费请求上带
 * `fineDetail: true`,服务端据此挑槽位。商家那一侧看到的是一句能力("Fine detail"),
 * 请求里也只有这个布尔值 —— 型号名一个字都不出现,槽位由服务端选。
 *
 * `transparent` / `portraitRefine` 是同一族里**还没有入口**的两格(随批 II 的增强稿
 * 带各自的界面进来)。留着它们不是「以后可能用得上」:路由判据是同一条(这三件事
 * 都非 pro 不可),写成三个字段是为了让入口一格一格接进来时不必回头改判据。
 */
export type ImageRouteCapabilities = {
  /** 商家在图片选项里勾的那一格 —— 高细节/精修。今天唯一有生产入口的能力位。 */
  fineDetail?: boolean | null;
  transparent?: boolean | null;
  portraitRefine?: boolean | null;
};

/**
 * **路由理由 —— 商家看得见的那句话**(S1 九问4「商家永远只见能力,不见型号」)。
 *
 * 一个函数两个调用点:请求侧路由的时候说这句话,worker 落 `Generation.routeReason`
 * 的时候**重算**同一句话(纯函数,输入是已冻结的 job 行:kind + model + resolution)。
 * 两边同源,所以商家看到的理由与库里存的理由不可能分家。
 *
 * 句子里只允许出现**能力名词**(1080p / HD tier / transparent background / …),
 * 一个型号名都不许有 —— `provider-secrecy` 是兜底,不是许可证。
 * 返回 null = 这一趟没有发生升档(走的是默认槽位),没什么可解释的。
 */
export function routeReasonFor(input: { kind: GenKind; model: string; resolution?: string | null }): string | null {
  if (input.kind === "video") {
    if (input.model !== HD_VIDEO_MODEL) return null;
    return input.resolution === HD_VIDEO_RESOLUTION
      ? `You asked for ${HD_VIDEO_RESOLUTION}, so this went to the HD tier.`
      : "This went to the HD tier.";
  }
  if (input.model !== PRO_IMAGE_MODEL) return null;
  return "You asked for a capability only the fine-detail tier can do, so this went there.";
}

/**
 * **路由理由跨过商家边界时的唯一出口**(Creation ① Codex r2 P1 落修)。
 *
 * 它与上面的 `routeReasonFor` 是同一个门的两扇:一扇写、一扇放行。放在同一个文件里,
 * 是因为「谁能读这一列」这件事只该有一个答案 —— r2 之前有两个:资产回执
 * (`getGeneration`)过了一层白标,出片轮询(`getGenJob`)把库里的字符串**原样**交给
 * 浏览器。同一列数据、两条产品路、两种口径,那不是纵深防御,那是一个洞:任何一天有人
 * 往这一列写进带型号名的字符串(手工回填、别处的旧代码、一次迁移),轮询这条路就把它
 * 念给商家听了。所以两条路现在都只能从这一个函数出去。
 *
 * 两件事在这一处做完:
 *   ① **空即未知** —— null / 空串 / 过滤后只剩空白,一律 null。「这一趟没升档」与
 *      「有一句空话」不是一回事,界面据此整块不渲染,而不是编一句「用了默认档」;
 *   ② **白标** —— 过 `redactProviderNames`。今天写进这一列的句子由我们自己的纯函数
 *      (`routeReasonFor`)写、只含能力名词,所以这一层是纵深防御;但「兜底不是许可证」
 *      的反面同样成立 —— 兜底必须真的在,否则那句话只是一句话。
 */
export function merchantRouteReason(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const shown = redactProviderNames(stored).trim();
  return shown.length > 0 ? shown : null;
}

/**
 * 视频能力路由:**按商家请求的分辨率挑槽位**,不按型号名。
 * 1080p → 高清槽位;其余(含未指定)→ 默认槽位。纯函数,永不抛。
 */
export function routeVideoModel(resolution?: string | null): { model: GenVideoModel; reason: string | null } {
  const model = resolution === HD_VIDEO_RESOLUTION ? HD_VIDEO_MODEL : DEFAULT_VIDEO_MODEL;
  return { model, reason: routeReasonFor({ kind: "video", model, resolution }) };
}

/**
 * 图片能力路由:**按能力挑槽位**。高细节 / 透明底 / 人物精修 → pro;其余 → lite。
 * 参考 S1 九问4:「图片＝5.0-lite(默认;组图)／5.0-pro(透明底、人物精修路由)」。
 */
export function routeImageModel(caps?: ImageRouteCapabilities): { model: GenModel; reason: string | null } {
  const model = caps?.fineDetail || caps?.transparent || caps?.portraitRefine
    ? PRO_IMAGE_MODEL
    : DEFAULT_IMAGE_MODEL;
  return { model, reason: routeReasonFor({ kind: "image", model }) };
}

/**
 * A model's default selections — explicit `defaults` where the model declares them,
 * else first of each list (audio on for sound models).
 *
 * #645 T4:`hasSourceImage` 分开 t2v 与 i2v 的**形状**默认。i2v(动这张图/接首帧)默认
 * 走模型的 `i2vAspectRatio`(Seedance = adaptive):有首帧时形状该跟着首帧走,而不是被
 * 一个默认值悄悄改成别的画幅 —— 与图片侧「改这张图不变形状」同一条原则。其余三项
 * (时长/分辨率/声音)两条路一致。
 *
 * #647 T6 历史安全:菜单收窄之后,库里仍存着写着已下架模型名的老 GenJob 行,而读它们的
 * 每一条路(记账、价签、worker 重算)都会把那个字符串强转成 `GenVideoModel` 送进来。
 * 菜单外的 id **不抛异常**(抛了就是卡面渲染直接崩),而是回一份**空规格** ——
 * 「我不知道这台引擎当年给的是什么」。空规格不会被误认成一份真档位:秒数 0 与空
 * 分辨率既不在任何按秒价目表上,也不在任何档位表上,所以下游只会落到护栏,
 * 绝不会把一个编出来的数字当成真值。
 */
export function videoDefaults(
  model: GenVideoModel,
  opts?: { hasSourceImage?: boolean },
): { seconds: number; resolution: string; aspectRatio: string; fps: number; audio: boolean } {
  const o = GEN_VIDEO_MODEL_OPTIONS[model] as VideoModelOptions | undefined;
  if (!o) return { seconds: 0, resolution: "", aspectRatio: "", fps: 0, audio: false };
  const t2vAspect = o.defaults?.aspectRatio ?? o.aspectRatios[0] ?? "";
  const i2vAspect = opts?.hasSourceImage && o.i2vAspectRatio && o.aspectRatios.includes(o.i2vAspectRatio)
    ? o.i2vAspectRatio
    : t2vAspect;
  return {
    seconds: o.defaults?.seconds ?? o.durations[0]!,
    resolution: o.defaults?.resolution ?? o.resolutions[0] ?? "",
    aspectRatio: i2vAspect,
    fps: o.fps[0] ?? 0,
    audio: o.audioToggle,
  };
}

/* ---------------- 视频引擎官方 token 计价(#644 记账真相) ---------------- */

/**
 * 视频引擎按 **token** 计价,不是按秒:
 *
 *   tokens = (输入视频秒数 + 输出秒数) × 宽 × 高 × fps / 1024
 *
 * 来源:https://docs.byteplus.com/en/docs/ModelArk/Pricing(2026-08-05 核)。
 * 720p 16:9 @24fps ⇒ 1280 × 720 × 24 / 1024 = 21,600 tokens/秒(720p 9:16 像素数相同,
 * 同值;同档不同比例的像素差 ~1%,不另立档)。
 *
 * 用官方成品价反向校验本公式(三条全中,以 #644 当时在产的 fast 牌价 $5.60/$3.30 为例):
 *   720p 5s  无视频输入 = 108,000 tok × $5.60/M = $0.6048  → 官方 $0.60  ✓
 *   720p 10s 无视频输入 = 216,000 tok × $5.60/M = $1.2096  → 官方 $1.21  ✓
 *   720p 5s  含参考视频 = (4…15 + 5)s × 21,600 × $3.30/M = $0.64…$1.43 → 官方区间 ✓
 *
 * **公式与在产引擎无关**:#769 换成 mini 之后校验照旧成立,只是每 M token 的单价换成
 * mini 的牌价(见下面两个常量)。tokens 的算法、24fps、像素表都是 Seedance 2.0 系列共用的。
 *
 * 只覆盖**现役 720p 档**。480p 等新档随 T4(档位扩容)带各自的官方核验一起进来 ——
 * 这里不给没核过的档位编数字。
 */
export const BYTEPLUS_720P_TOKENS_PER_SECOND = 21_600;
/** 官方 token 公式里的帧率(Seedance 2.0 系列输出恒 24fps)。 */
export const BYTEPLUS_VIDEO_FPS = 24;

/**
 * Seedance 2.0 系列**官方输出像素表**(Create-task 文档
 * https://docs.byteplus.com/en/docs/ModelArk/1520757,2026-07-31 核,Seedance 2.0 系列列)。
 *
 * 为什么必须有这张表(#645 T4):同一个分辨率档,不同比例的像素数**差得很远** ——
 * 720p 的 4:3 是 927,408px,比 16:9 的 921,600px 多 0.6%;成本按 token 走,token 按像素走,
 * 所以「720p 一个价」的成本其实是一段区间。毛利地板只有按**最差比例**建模才算数,
 * 否则商家挑了最贵的比例,我们就在自己不知情的情况下卖到地板下面去。
 */
export const SEEDANCE_VIDEO_PIXELS: Record<"480p" | "720p", Record<string, readonly [number, number]>> = {
  "480p": { "16:9": [864, 496], "4:3": [752, 560], "1:1": [640, 640], "3:4": [560, 752], "9:16": [496, 864], "21:9": [992, 432] },
  "720p": { "16:9": [1280, 720], "4:3": [1112, 834], "1:1": [960, 960], "3:4": [834, 1112], "9:16": [720, 1280], "21:9": [1470, 630] },
};

/** 某一分辨率档下**最贵**那个比例的 tokens/秒(= 最大像素 × 24fps / 1024)。纯函数。
 *  720p ⇒ 4:3/3:4 的 927,408px ⇒ 21,736.125 tok/s;480p ⇒ 21:9 的 428,544px ⇒ 10,044 tok/s。 */
export function seedanceWorstRatioTokensPerSecond(resolution: "480p" | "720p"): number {
  const widest = Math.max(...Object.values(SEEDANCE_VIDEO_PIXELS[resolution]).map(([w, h]) => w * h));
  return (widest * BYTEPLUS_VIDEO_FPS) / 1024;
}
/**
 * 无视频输入(t2v / i2v)牌价,$/M tokens。
 *
 * #769(2026-08-08):在产引擎换 mini,牌价 $5.60/M → **$3.50/M**。
 * 来源 = ModelArk 模型档案 `dreamina-seedance-2-0-mini-260615` 的 `pricing.charge_items`,
 * 类型 `NV2VCompletion`(non-video-to-video,即无视频输入那档)的 **`original_price`**
 * 0.0035 / K tokens。**抄牌价不抄折后价**:同一条记录上 `price` 是 0.0014 / K
 * ($1.40/M 折后),我们不抄它 —— 折扣既不保证续、也可能静默失效,成本按牌价记才安全。
 * 同一读法在 fast 的档案上复核过:`NV2VCompletion.original_price` = 0.0056/K = $5.60/M,
 * 与 #644 手抄自定价页的旧值逐字相同 —— 两个来源互证,读法没有走样。
 *
 * 数值已收编 `cost-pins.ts`(成本的单一权威),此处只是命名出口 —— 改价改钉点,不改这行。
 */
export const BYTEPLUS_USD_PER_MTOKEN = costPinValue("video:seedance-2-mini:t2v-per-mtoken");
/**
 * 含视频输入(整段参考视频)牌价,$/M tokens —— 比无视频输入那档更便宜。
 *
 * #769:同一份 mini 档案的 `V2VCompletion.original_price` = 0.0021 / K = **$2.10/M**
 * (fast 是 0.0033/K = $3.30/M,同样与 #644 的旧值互证)。折后价 $0.84/M 同样不抄。
 *
 * 数值已收编 `cost-pins.ts`(成本的单一权威),此处只是命名出口 —— 改价改钉点,不改这行。
 */
export const BYTEPLUS_USD_PER_MTOKEN_WITH_VIDEO_INPUT = costPinValue("video:seedance-2-mini:v2v-per-mtoken");
/**
 * 参考视频输入的**最低计费秒数**(token 地板)。官方「含参考视频 720p 5s」区间下限
 * $0.64 恰好 = (4 + 5) 秒 × 21,600 × $3.30/M(fast 牌价),即输入不足 4 秒也按 4 秒计
 * —— 与引擎自身 4 秒最短时长一致。我们的参考片窗口是 2–6 秒(REF_VIDEO_MIN/MAX_SECONDS),
 * 所以这条地板会真的咬到 2–3 秒的参考片。
 *
 * #769:mini 与 fast 的最短时长同为 4 秒(档位表 durations 起于 4),这条地板照旧成立;
 * 单价换成 mini 的那一档,秒数口径不动。
 */
export const BYTEPLUS_MIN_BILLED_INPUT_SECONDS = 4;

/** 按官方 token 公式算 COGS(USD)。纯函数,RECORD-ONLY —— 收费在 spend.ts。
 *  `tokensPerSecond` 缺省 = 720p 16:9 那一档(整段参考视频沿用它,见下)。 */
export function byteplusVideoCogsUsd(opts: {
  outputSeconds: number;
  referenceInputSeconds?: number;
  tokensPerSecond?: number;
}): number {
  const rawInput = opts.referenceInputSeconds ?? 0;
  const hasVideoInput = rawInput > 0;
  const billedInput = hasVideoInput ? Math.max(rawInput, BYTEPLUS_MIN_BILLED_INPUT_SECONDS) : 0;
  const tokens = (opts.outputSeconds + billedInput) * (opts.tokensPerSecond ?? BYTEPLUS_720P_TOKENS_PER_SECOND);
  const usdPerMToken = hasVideoInput ? BYTEPLUS_USD_PER_MTOKEN_WITH_VIDEO_INPUT : BYTEPLUS_USD_PER_MTOKEN;
  return (tokens * usdPerMToken) / 1_000_000;
}

/** 现役视频档(seedance-2-mini @720p 16:9)每秒等效记账成本 = **$0.0756/s**(#769 前是
 *  fast 的 $0.12096/s)。RECORD-ONLY。
 *  #645 后它不再是收费/毛利的基准(那条路按最差比例走,见下),只留给整段参考视频那一档。 */
export const SEEDANCE_720P_COGS_USD_PER_SECOND = byteplusVideoCogsUsd({ outputSeconds: 1 });

/**
 * **每秒记账成本,按各档的最差比例**(#645 T4)。RECORD-ONLY。
 *   720p = 21,736.125 tok/s × $3.50/M = **$0.0760764375/s**(4:3 / 3:4)
 *   480p = 10,044     tok/s × $3.50/M = **$0.035154/s**(21:9)
 * (#769 之前是 fast 牌价 $5.60/M ⇒ $0.1217223 / $0.0562464。像素表与 tok/s 一格没动,
 *  变的只有每 M token 的单价。)
 *
 * 为什么按最差比例记而不是按这一单真实的比例:收费是**按档**的(同一档六个比例一个价),
 * 所以毛利也只能按档判 —— 判据必须是这一档里最贵的那个比例,否则「平均起来是够的」会
 * 掩盖掉真正卖亏的那几个比例。同一条保守原则下,记账宁可高估:与
 * `REFERENCE_VIDEO_COGS_USD` 取参考片窗口上限是同一个理由(「记上限,永不低估成本」)。
 * 代价是 16:9 这类便宜比例被高记 ≤0.6%,方向永远安全。
 */
export const SEEDANCE_COGS_USD_PER_SECOND: Record<"480p" | "720p", number> = {
  "480p": byteplusVideoCogsUsd({ outputSeconds: 1, tokensPerSecond: seedanceWorstRatioTokensPerSecond("480p") }),
  "720p": byteplusVideoCogsUsd({ outputSeconds: 1, tokensPerSecond: seedanceWorstRatioTokensPerSecond("720p") }),
};

/**
 * **1080p 档的每秒成本 = $0.3773385/s**,由 `cost-pins.ts` 的**两条钉点**推导:
 * $0.0077/K token × 245,025 token ÷ 5 秒。
 *
 * 为什么不走上面那条「像素表 × 牌价」的公式:官方像素表(docs/1520757)只给了 480p 与
 * 720p 两档,1080p 的成本我们手上是一份**实测账单**(245,025 token/5s,比官方公式推的
 * 243,000 高 0.83%,差异未解释 —— 取实测,记高不记低)。拿 720p 的回退值当 1080p 的成本
 * 会便宜五倍,那就是卖一单亏一单。
 *
 * 本常量此前住在 `spend.ts`(定价侧),但成本的命名出口一律在本文件与其它成本基准同住,
 * 而且**成本函数**(`videoRateUsdPerSec`)也要用它 —— 放两份就会漂移。spend.ts 现在
 * 从这里取,并按原名再导出一次,消费方一行都不用改。
 */
export const SEEDANCE_1080P_COGS_USD_PER_SECOND =
  (costPinValue("video:seedance-2.0:1080p-per-ktoken") *
    costPinValue("video:seedance-2.0:1080p-tokens-per-5s")) /
  1000 /
  5;

/** 高清槽位的每秒成本表。今天只有 1080p 一档有钉点(它也是这个槽位唯一可售的那一档)。 */
export const SEEDANCE_2_0_COGS_USD_PER_SECOND: Record<string, number> = {
  "1080p": SEEDANCE_1080P_COGS_USD_PER_SECOND,
};

/**
 * 整段参考视频的记账成本 = **$0.49896**,按我们参考片窗口的**上限**保守记
 * (6s 参考输入 + 5s 出片,mini 含视频输入档 $2.10/M)。真实区间 $0.40824(≤4s 参考,
 * 吃地板)… $0.49896(6s 参考);记上限,永不低估成本。
 *
 * RECORD-ONLY —— 收费是 spend.ts 的 `REFERENCE_VIDEO_CREDITS`(16cr),与本值无关。
 * 沿革:$0.85(2026-06 资源包折后价 $3.564/M)→ #644 改真为 fast 牌价 $3.30/M 的
 * $0.78408 → #769 换 mini 牌价 $2.10/M 的 $0.49896。收费三次都没动。
 */
export const REFERENCE_VIDEO_COGS_USD = byteplusVideoCogsUsd({
  outputSeconds: GEN_VIDEO_SECONDS,
  referenceInputSeconds: REF_VIDEO_MAX_SECONDS,
});

/**
 * Per-second COGS rate ($/s) by model/resolution — the record-only cost basis.
 *
 * #644/#645:在产那一档走官方 token 公式,按**档 × 最差比例**分开(480p 是真的半价档,
 * 记成 720p 会把它的毛利算错)。未知/缺省分辨率一律回落到更贵的 720p —— 记账宁可高估。
 * 声音开关不影响 2.0 系列价格,所以这一档不看 audio。
 *
 * #647 T6:菜单外的 id(下架前存下的历史行)回 **0** —— 那 12 台引擎的费率是从当初备用
 * 供应商各自的定价页抄来的,引擎既已下架,那些数字就再没有人核过;留着它们等于让一条谁都不再验证的
 * 价格继续参与记账。0 的意思是「这一趟的成本我们不知道」,而不是「这一趟不花钱」:
 * 记账是 record-only,而**收费**那一侧(spend.ts)对同一批 id 走的是护栏价,不是 0。
 */
function videoRateUsdPerSec(model: GenVideoModel, resolution: string): number {
  if (model === "seedance-2-mini") {
    return SEEDANCE_COGS_USD_PER_SECOND[resolution as "480p" | "720p"] ?? SEEDANCE_COGS_USD_PER_SECOND["720p"];
  }
  if (model === HD_VIDEO_MODEL) {
    // Creation S2 §8.1①:高清槽位的成本**只有 1080p 有钉点**(实测账单,见 cost-pins.ts)。
    // 它的 720p/480p 是**能力**而不是可售 SKU,所以这里不给它们编一个数字 —— 未知分辨率
    // 一律回落到本槽位最贵的那一档(记账宁可高估,与 mini 回落 720p 同一条规矩)。
    return SEEDANCE_2_0_COGS_USD_PER_SECOND[resolution] ?? SEEDANCE_2_0_COGS_USD_PER_SECOND[HD_VIDEO_RESOLUTION]!;
  }
  return 0;
}

/** Live total for a batch: count × seconds × per-second rate. */
export function videoPriceUsd(model: GenVideoModel, opts: { seconds: number; resolution: string; audio: boolean; count: number }): number {
  // `audio` 留在入参里:调用方(卡面报价、worker 结算)手上就有它,而声音开关在别的引擎上
  // 曾经是改价的。现在这一台不看它 —— 2.0 系列声音免费(#646 T5 已核)。
  return opts.count * opts.seconds * videoRateUsdPerSec(model, opts.resolution);
}

/**
 * 「源资产没有提示词」时,资产详情面板那个动作发出去的那一句 —— **只在这里定义一次**。
 *
 * 补的是哪个洞(D5,2026-09-03 真供应商走查实证):上传进来的素材,`Generation.promptText`
 * 是空串(`apps/web/lib/actions.ts` 与 `upload-actions.ts` 的上传路一律写 ""),而面板把
 * 那一列原样当作请求的 `prompt` 送出去。下面 `genRequest.prompt` 要求非空,于是「对上传的
 * 图按 Animate」整单在服务端被拒(`That generation request is out of bounds.`),连 GenJob
 * 都不建 —— 商家自己拍的产品照因此根本动不了,而同一张图打了字的 Generate edit 能建单。
 * 裁剪那条路早就有同族兜底(`source.promptText || "cropped"`),Animate 没补。
 *
 * 三条纪律写在这里,所以调用方不必各记一遍:
 *   · **它是我们替这次动作写的一句话,不是商家原话。** 所以它只会落进 `GenJob.prompt`
 *     与回执的「实发」那一栏;「你写的」那一栏(`GenJob.requestedPrompt`)只由
 *     `merchant-prompt-provenance` 那条进程内通道写,兜底句一个字都进不去。
 *   · **它不动一分钱。** 计价只看型号 / 张数 / 秒数 / 分辨率(`pricedGenCredits`),
 *     提示词不是入参 —— 兜底前后报价逐字相同。
 *   · **只有 `animate` 有兜底,而且是因为它带着那张图。** `handleAnimate` 送
 *     `sourceGenerationId`(i2v:引擎真看得见源图),所以「Animate this image」是句成立的
 *     指令。别的动作一律没有:
 *       - `regen` —— `handleRegen` **不带** `sourceGenerationId`(`DetailPanel.tsx`),
 *         这条路今天是纯文生图。给它兜一句「Recreate this image」,引擎手上根本没有那张
 *         照片,商家花了钱只会拿到一张无关的图 —— 比原来的 $0 拒收更糟。所以上传素材按
 *         Regenerate 维持拒收,等 i2i 请求形状接上再谈(变更登记 2026-09-03)。
 *       - `edit` 的那句话就是商家自己敲的字(空 = 没输入,该拒);`template` 的句子由模板
 *         自己拼。给它们兜底等于替商家发明意图。
 */
export const ASSET_ACTION_FALLBACK_PROMPTS = {
  animate: "Animate this image",
} as const satisfies Record<string, string>;

/**
 * 上传进来的素材按 **Regenerate** 时,商家看到的那一句 —— **只在这里定义一次**。
 *
 * 为什么还是拒收:上面那段已经写明,`handleRegen` 不送 `sourceGenerationId`,引擎手上根本
 * 没有那张照片,兜一句「Recreate this image」只会让商家花了钱拿到一张无关的图。所以这条路
 * 维持 $0、不建 GenJob —— 变的只是**说法**。
 *
 * 变的是什么(Founder 2026-09-03 裁决):原来商家看到的是 `genRequest` 那句通用出界话
 * 「That generation request is out of bounds.」——它既没说是哪一步不行,也没给下一步。现在
 * 这条路自己答:说清「上传的图还不能重做」,并把同一张图上真的能用的两个动作指给他。
 *
 * 它与钱无关:拒收发生在算幂等键、进 `startGen`、动账本**之前**,前后都是 $0。
 */
export const ASSET_REGEN_UPLOAD_REFUSAL =
  "Uploads can’t be regenerated yet. Try Animate or Edit instead.";

/**
 * 上面那张表的**唯一**读法:这个动作 + 这一句提示词,真正该发出去的是哪一句。
 *
 * 空串 / 只有空白 / 缺席 ⇒ 该动作的兜底句(没有兜底的动作回 null,由 `genRequest` 照旧拒 ——
 * 今天 `animate` 以外的每一个动作都走这一支)。
 * 商家真写了字 ⇒ 原样返回,一个字节都不动(所以既有的生成图 Animate 零行为变化)。
 * PURE。
 */
export function assetActionPrompt(op: string, prompt: unknown): string | null {
  if (typeof prompt === "string" && prompt.trim().length > 0) return prompt;
  return (ASSET_ACTION_FALLBACK_PROMPTS as Record<string, string | undefined>)[op] ?? null;
}

export const genRequest = z
  .object({
    projectId: z.string().min(1).max(64),
    // when set, the result attaches to this shot; else it lands unattached
    shotId: z.string().min(1).max(64).nullish(),
    // i2v source: a specific owned Generation's image to animate (Gen space
    // upload→animate). Server-validated owner+project; not a client URL (D19).
    sourceGenerationId: z.string().min(1).max(64).nullish(),
    // optional end frame for i2v (interpolate source→tail). Same trust boundary.
    tailGenerationId: z.string().min(1).max(64).nullish(),
    // whole-clip reference video (Seedance 2.0 reference_video). Server-validated
    // owner+project+video-ext, like sourceGenerationId. Only used by video plans.
    referenceVideoGenerationId: z.string().min(1).max(64).nullish(),
    prompt: z.string().trim().min(1).max(MAX_GEN_PROMPT),
    // #914 r6 (判官 r5 P2) — THE MERCHANT'S OWN WORDS ARE **NOT** A FIELD HERE, deliberately.
    //
    // The receipt's left-hand side ("what you wrote", GenJob.requestedPrompt) used to ride in
    // this schema. Every entry point that parses this object is a Server Action the browser can
    // call directly, so accepting it here let any caller write an arbitrary sentence into a record
    // the merchant is later shown as evidence — the #882 approvedEntities lesson ("approved A,
    // ran B") applied to provenance instead of instructions. Because this schema is `.strict()`,
    // leaving the field OUT means a request carrying it is rejected outright, before any spend.
    //
    // The one place that can honestly produce this fact is the one place that composes
    // (coworkGenerate): it holds the before and after in the same breath. It hands the value to
    // startCoworkGen over an in-process channel that cannot survive serialization —
    // apps/web/lib/merchant-prompt-provenance.ts — and startGen writes it from there alone.
    entityIds: z.array(z.string().min(1).max(64)).max(MAX_GEN_ENTITIES).default([]),
    // Phase C: { [entityId]: variantId } — which named variant each @mention
    // selected. Absent → all mentions condition on the entity's base refs
    // (backward-compat). Both key and value are bounded so a malformed id can
    // never reach the worker and silently spend on a degraded generation.
    variantSel: z.record(z.string().min(1).max(64), z.string().min(1).max(64)).optional(),
    // #774 判官 r2 P1:每个 @元素在**批准那一刻**的名字与类型。引擎认人那几句机器指令
    // 里的名字只能来自这里 —— 它由铸卡侧写在卡上、商家批准前就看得见,由 `startGen` 落到
    // `GenJob.approvedEntities`,worker 只读那一列,绝不在付费调用前重读活名称。缺席 =
    // 这一趟没有获批的名字(旧卡、或非卡入口),worker 照旧编号,只是不写名字。
    approvedEntities: z
      .array(
        z.object({
          id: z.string().min(1).max(64),
          type: z.enum(["CHARACTER", "LOCATION", "PRODUCT", "BRANDMARK"]),
          name: z.string().min(1).max(MAX_ENTITY_NAME),
        }),
      )
      .max(MAX_GEN_ENTITIES)
      .optional(),
    count: z.number().int().min(1).max(MAX_GEN_COUNT),
    kind: z.enum(GEN_KINDS).default("image"),
    model: z.string().min(1).max(40).default("seedream"),
    // REQUIRED double-submit key — every spend request must carry one so it ALWAYS
    // flows through the dedup machinery (startGen pre-check + the partial-unique index);
    // a keyless request could otherwise bypass dedup and double-charge. Every family is
    // DERIVED ON THE SERVER from the merchant's intent, never minted per click by a browser:
    // asset:<op>:<intent hash> (detail panel + templates), canvas:<action hash>,
    // cowork:<cardId> (exactly-once-ever), batch:<logical hash>:attempt:<attempt hash>.
    // A per-click or wall-clock key is the double-charge bug itself — the same intent
    // resubmitted (reload, second tab, double click) must produce the SAME key. Never omit it.
    idempotencyKey: z.string().min(1).max(80),
    // cowork tag: when set, this gen belongs to a Cowork thread — startGen persists it
    // onto GenJob.threadId so the worker can tag the Generation and the studio views can
    // filter cowork drafts out. Bounded like the other ids.
    threadId: z.string().min(1).max(64).nullish(),
    // video controls (optional overrides; absent → the model's videoDefaults).
    // Each is validated against the chosen model's option set in the refine below.
    durationSeconds: z.number().int().min(1).max(60).nullish(),
    resolution: z.string().max(12).nullish(),
    // shape. Shared by BOTH kinds (#642): video validates against the video model's
    // aspectRatios, image against GEN_IMAGE_MODEL_OPTIONS. Absent → the kind's default
    // (image: 1:1, unchanged from the pre-#642 fixed square).
    aspectRatio: z.string().max(12).nullish(),
    fps: z.number().int().min(1).max(120).nullish(),
    audio: z.boolean().nullish(),
    /**
     * #777 —— 「这 count 张是**一组**要连贯的图」。true ⇒ 执行层一次请求出齐整组
     * (同模特多角度/同产品多尺寸,角色与风格连续);缺省/false ⇒ 各出各的,与今日
     * 逐字一致。
     *
     * 钱:一格不动。收费仍是 `pricedGenCredits` 的每张 1 显示 credit,reserve == settle,
     * 幂等键的家族与长度都没变。它进的是**材料**(`GenJob.imageOptions`),所以
     * 「一组连贯图」与「N 张散图」在同一个 batchId 的同一格上是**不同内容** ——
     * 复用/重放判据会照实拒,不会把商家批的一组图静默换成散图(反之亦然)。
     */
    coherentSet: z.boolean().nullish(),
    /**
     * Creation S2 §8.1①(CREATE-A6 / CREATE-A12,判官 r1 P1 落修)——
     * **商家勾的那一格能力**:这一张要走高细节/精修。
     *
     * 它是**能力位,不是型号**:请求里没有、也不许有任何槽位名。服务端读它、
     * 由 `routeImageModel` 挑槽位(`gen-actions.ts` 的 `routeCapabilitySlot`),
     * 于是「商家说的是能力,我们挑的是引擎」这句话在生产路径上第一次成立。
     *
     * 钱:**它会改价**(pro 槽位 2cr/张 vs lite 1cr/张),所以它和张数、形状一样是
     * 商家授权内容的一部分 —— 界面必须在按下之前把新的价显示出来,而请求带的
     * `expectedCredits` 会被服务端逐格重算比对(对不上就在 create/reserve 之前拒)。
     * 路由结果落在材料的 `model` 那一格上,所以「勾了精修的那一单」与「没勾的那一单」
     * 在幂等判据上本来就是**不同内容**,不必再多存一格。
     */
    fineDetail: z.boolean().nullish(),
  })
  .strict()
  // model must match the kind's menu — an unknown video model must never reach
  // the worker and silently spend on a fallback (money safety).
  .superRefine((v, ctx) => {
    // Phase C: every variantSel key must be an @mentioned entity. A selection for an
    // entity not in entityIds is an inconsistent request the worker would ignore — and
    // with an empty entityIds it could still spend as unconditioned t2i. Reject it
    // before it can be persisted or spent (validate-before-spend).
    if (v.variantSel) {
      for (const k of Object.keys(v.variantSel)) {
        if (!v.entityIds.includes(k)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["variantSel"], message: "variantSel references an entity that isn't @mentioned" });
      }
    }
    // #774:审批身份只能覆盖这一趟真的 @ 到的元素。多出来的一条身份 = 一条没人 @ 过、
    // 却会被写进模型指令的名字,所以在能落库之前拒掉(validate-before-spend)。
    if (v.approvedEntities) {
      const ids = new Set<string>();
      for (const e of v.approvedEntities) {
        if (!v.entityIds.includes(e.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["approvedEntities"], message: "approvedEntities references an entity that isn't @mentioned" });
        if (ids.has(e.id)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["approvedEntities"], message: "approvedEntities carries two identities for the same entity" });
        ids.add(e.id);
      }
    }
    const menu: readonly string[] = v.kind === "video" ? GEN_VIDEO_MODELS : GEN_MODELS;
    if (!menu.includes(v.model)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: `model "${v.model}" is not valid for ${v.kind}` });
    }
    // an end frame (tail) is only valid for a video model that supports it — never
    // enqueue (and later pay for) a clip whose model would silently ignore it.
    if (v.tailGenerationId) {
      const supportsTail = v.kind === "video" && GEN_VIDEO_MODEL_INFO[v.model as GenVideoModel]?.tail === true;
      if (!supportsTail) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tailGenerationId"], message: "this model doesn't support an end frame" });
      // #646: an end frame is meaningless without a start frame, and the worker resolves the
      // start frame from EXACTLY two places (apps/worker/src/jobs/gen.ts:641-663): an explicit
      // sourceGenerationId, else the shot's latest still via shotId. With neither, the worker
      // short-circuits the tail lookup — the end frame vanishes and the merchant pays for an
      // ordinary clip. Reject the shape here, before anything is reserved.
      if (!v.sourceGenerationId && !v.shotId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tailGenerationId"], message: "an end frame needs a start frame — pick a source image, or a shot that has one" });
      }
      // first+last frames and whole-clip reference video are mutually exclusive scenarios for
      // the engine (same rule the provider enforces pre-spend).
      if (v.referenceVideoGenerationId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["tailGenerationId"], message: "an end frame can't be combined with a reference video" });
      }
    }
    // every chosen video control must be in the model's option set — a value the
    // engine endpoint would reject (or a more expensive one than priced) must never
    // reach the worker and spend.
    if (v.kind === "video" && (GEN_VIDEO_MODELS as readonly string[]).includes(v.model)) {
      const o = GEN_VIDEO_MODEL_OPTIONS[v.model as GenVideoModel];
      const bad = (path: string, msg: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message: msg });
      if (v.durationSeconds != null && !o.durations.includes(v.durationSeconds)) bad("durationSeconds", "duration not available for this model");
      if (v.resolution && !o.resolutions.includes(v.resolution)) bad("resolution", "resolution not available for this model");
      if (v.aspectRatio && !o.aspectRatios.includes(v.aspectRatio)) bad("aspectRatio", "aspect ratio not available for this model");
      if (v.fps != null && !o.fps.includes(v.fps)) bad("fps", "fps not available for this model");
      if (v.audio === false && !o.audioToggle) bad("audio", "this model can't turn audio off");
      if (v.count > o.maxCount) bad("count", "too many clips for this model");
    }
    // #642: same gate on the image side — a shape the image engine can't produce must
    // never reach the worker and spend. (Price is unaffected: the image engine bills per
    // image regardless of shape, so every option below costs exactly the same.)
    if (v.kind === "image" && (GEN_MODELS as readonly string[]).includes(v.model)) {
      const o = GEN_IMAGE_MODEL_OPTIONS[v.model as GenModel];
      if (v.aspectRatio && !o.aspectRatios.includes(v.aspectRatio)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["aspectRatio"], message: "aspect ratio not available for this model" });
      }
      if (v.count > o.maxCount) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["count"], message: "too many images for this model" });
      }
    }
    // #777 组图闸:**验证在花钱之前**,与画幅/档位同一条规矩。三种请求一律拒,
    // 因为它们都会让「商家批的」与「执行层做的」分家:
    //   - 视频要组图:视频端点没有这个能力,放行就是收了钱做不出承诺的东西;
    //   - 引擎不支持:能力位是唯一的开关,菜单外的模型永远走不到这条路;
    //   - 只要一张:一张图不成组,而它会进材料绑定 —— 一个说了不算数的开关
    //     会让同一个请求在重放时判成「换了内容」,把商家的合法重试挡死。
    if (v.coherentSet === true) {
      if (v.kind !== "image") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coherentSet"], message: "a coherent set is only available for images" });
      } else if (!supportsCoherentSet(v.model)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coherentSet"], message: "this model can't make one coherent set" });
      } else if (v.count < COHERENT_SET_MIN_IMAGES) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["coherentSet"], message: `a coherent set needs at least ${COHERENT_SET_MIN_IMAGES} images` });
      }
    }
    // Creation S2 §8.1①(CREATE-A6)—— 「精修」这一格闸,与组图同一条规矩:
    // **验证在花钱之前**,而且两种请求都会让「商家勾的」与「真跑的」分家:
    //   - 视频带图片能力位:视频那条路根本读不到它,放行就是收了钱做别的事;
    //   - 勾了精修却落在别的槽位上:能力路由(`routeCapabilitySlot`)本来就会把它挑到
    //     pro 去,所以走到这里还不是 pro 的,只可能是一次绕开路由的直接构造 ——
    //     那正是这道闸存在的理由(与 #882 approvedEntities 同一类)。
    if (v.fineDetail === true) {
      if (v.kind !== "image") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fineDetail"], message: "fine detail is only available for images" });
      } else if (v.model !== PRO_IMAGE_MODEL) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["fineDetail"], message: "fine detail isn't available on this image tier" });
      }
    }
    if (v.referenceVideoGenerationId) {
      if (v.kind !== "video") ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["referenceVideoGenerationId"], message: "reference video is only valid for video generation" });
      if (v.model !== REFERENCE_VIDEO_MODEL) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["model"], message: "reference video requires Seedance 2.0 mini" });
      if (v.durationSeconds != null && v.durationSeconds !== GEN_VIDEO_SECONDS) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["durationSeconds"], message: "reference video output is fixed at 5 seconds" });
      }
    }
    /**
     * #775 判官 r3 P1-1 —— **锚在商家自己那条片子上的请求,两条硬形状**。
     *
     * 这道闸长在付费 schema 上,而不是只长在铸卡侧,理由就是判官的两个探针:它们都发生在
     * **执行时**。铸卡侧管得再好,只要执行侧没问同一个问题,一个公开 Server Action 就能把
     * 「商家批准的那张卡」和「真正送去花钱的那份请求」拆成两件事(与 #882 的
     * `approvedEntities` 同一类病)。
     *
     * ① 官方句式说要改/接**那条片子**,那这条请求就必须真的带着一条片子。带不上却照发,
     *    引擎收到的是一句指着 `<Video_1>` 的指令而请求里根本没有 Video_1 —— 一次注定
     *    让商家失望的付费运行。
     * ② 输出形状只能跟着那条片子(`adaptive`)或干脆不说。官方陷阱:这两种任务上再指定一个
     *    比例,请求会**先被收下、事后才异步失败** —— 商家看到的是批准之后石沉大海。
     *    缺席也放行:不说 = 引擎自己跟着输入走,与 adaptive 同义,而我们绝不发明一个值。
     *
     * 判据只有一处(`anchoredVideoAction`,与铸卡侧、与写这段字的装配器同一份),
     * 且**只对官方句式那两档收紧** —— 普通文生视频、首帧动画、以及「照着这条做一条新的」
     * (同样带参考视频、但提示词不是官方句式)一个字节都不受影响,画布那条路的合法画幅
     * 语义原样保留。
     */
    const anchoredAction = v.kind === "video" ? anchoredVideoAction(v.prompt) : null;
    if (anchoredAction) {
      /**
       * #922 —— **下架的动作花不出钱**,哪怕请求形状完全合法。
       *
       * 这一条排在另外两条前面,因为它管的不是形状而是「这件事现在做不做」。上面两道闸
       * 都假设这趟运行本身是要做的;续写下架之后,一条带着片子、比例也对的续写请求仍然
       * 不许扣钱 —— 铸卡两面已经不产它了,能走到这里的只剩下架之前铸好的残留卡、或者
       * 直接构造的请求,而那两种正是这道闸存在的理由(与上面判官 r3 的两个探针同一类)。
       *
       * 名单在 core 的 `ANCHORED_ACTION_UNAVAILABLE` —— 铸卡两面读的是同一份。
       * 这里的 message 与别的 schema 消息同一个体例(内部用;商家看到的是 startGen 统一的
       * 那一句),商家读得到的那句人话由铸卡两面在**花钱之前**说。
       */
      const unavailable = anchoredActionUnavailableReason(anchoredAction);
      if (unavailable) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["prompt"],
          message: "carrying a clip on is not available right now",
        });
      }
      if (!v.referenceVideoGenerationId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["referenceVideoGenerationId"],
          message: "this prompt edits or continues a clip, so it needs that clip attached",
        });
      }
      if (v.aspectRatio != null && v.aspectRatio !== VIDEO_ASPECT_ADAPTIVE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aspectRatio"],
          message: "editing or continuing a clip keeps the clip's own shape",
        });
      }
    }
  });
export type GenRequest = z.infer<typeof genRequest>;

export const genJobData = z.object({ genJobId: z.string().min(1).max(64) }).strict();
export type GenJobData = z.infer<typeof genJobData>;

export const GEN_QUEUE = "gen";
export const GEN_DLQ = `${GEN_QUEUE}.dlq`;

/** Otto 深度研究队列名（研究 S3）。approve 动作把 { jobId } 发到这个队列;worker
 *  注册消费者 handleResearch。 */
export const RESEARCH_QUEUE = "research";
export const RESEARCH_DLQ = `${RESEARCH_QUEUE}.dlq`;

/** Research queue job payload — just the ResearchJob id; the worker owner-scopes everything off it. */
export const researchJobData = z.object({ jobId: z.string().min(1).max(64) }).strict();
export type ResearchJobData = z.infer<typeof researchJobData>;

/**
 * RESEARCH_QUEUE_POLICY — **retryLimit: 0 is a MONEY-SAFETY decision** (Otto research S3).
 *
 * A research run spends real credits (LLM tokens, metered by withLlmBudget in the worker). If a
 * run fails, it must NOT auto-retry — a retry could re-enter the spend path. Instead the card is
 * marked "failed" and the user re-approves (a fresh card → a fresh refId), so a human is always in
 * the loop before credits are spent again. The worker also CAS-gates status QUEUED→RUNNING so any
 * pg-boss redelivery is a no-op; retryLimit:0 is belt-and-suspenders on top of that.
 *
 * expireInSeconds is generous — a deep research run does many sequential LLM turns + page reads.
 */
export const RESEARCH_QUEUE_POLICY = {
  retryLimit: 0,
  expireInSeconds: 60 * 30,
  deadLetter: RESEARCH_DLQ,
} as const;
export const GEN_RETRY_LIMIT = 2;
export const GEN_QUEUE_POLICY = {
  retryLimit: GEN_RETRY_LIMIT,
  retryBackoff: true,
  // base seconds for the retry backoff. WITHOUT this, pg-boss defaults retry_delay=0, which
  // makes `retryBackoff` a silent no-op (start_after = now()) — a failed paid gen would retry
  // INSTANTLY (hammering the engine on a transient 5xx). With it, retries are spaced (30s, then grows).
  retryDelay: 30,
  // > the longest realistic engine call so a still-running gen is never expired +
  // redelivered (which would let the duplicate-delivery fail-closed wrongly FAIL an
  // active paid job). Both web (dispatch) and worker (consumer) create the queue
  // with THIS policy, so boot order can't leave them split.
  expireInSeconds: 60 * 20,
  deadLetter: GEN_DLQ,
} as const;
