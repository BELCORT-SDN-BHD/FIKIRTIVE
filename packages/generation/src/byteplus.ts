import type { GenerationProvider, GenerationRequest, GeneratedImage, VideoRequest, GeneratedVideo, GenerationReceipt, VideoSubmission, VideoPollResult } from "@fikirtive/core";
import {
  imageOutputSizeForModel,
  MAX_VIDEO_IMAGE_PARTS,
  personRejectionSentence,
  REFERENCE_IMAGE_PERSON_REJECTED,
  referenceImagePersonRejected,
  classifyProviderQuotaExceeded,
  GENERATION_ENGINE_UNAVAILABLE,
  videoReferencesRide,
} from "@fikirtive/core";
import { chargedError, permanentInputError, extFromUrl } from "./index.js";
import { providerRequestGate } from "./provider-concurrency.js";

/** #776 —— 落库的提示词上限。引擎报回来的是它自己改写过的一段文字,长度不由我们决定,
 *  所以在**入口**处封顶一次,而不是指望下游每个读者都记得。超长的截断,不是丢弃:
 *  半句真话仍然是真话,而丢弃会把「引擎报过」抹成「引擎没报」。 */
const MAX_FINAL_PROMPT_CHARS = 4_000;

/** 正整数才是计费量。0 / 负数 / 小数 / NaN / Infinity 都不是引擎在报数,是我们读错了 —— 一律当没读到。 */
function positiveInt(v: unknown): number | undefined {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : undefined;
}

function finalPromptOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed.slice(0, MAX_FINAL_PROMPT_CHARS) : undefined;
}

/**
 * #776 —— 从引擎的响应里读**回执**。两条产品线的响应形状**不同**,所以这里是两个函数,
 * 各自只读自己那份官方契约里真实存在的字段。
 *
 * 三条纪律,缺一条这两个函数就会变成一个新的花钱风险:
 *
 *   ① **永不抛**。它们在付费边界的**内侧**被调用 —— 图片路径上 `res.ok` 之后的每一次抛出
 *      都会被那圈 catch 翻译成 chargedError 并终态失败。一个记账字段读崩了就把一单已经
 *      成功的生成判成失败,是拿商家的钱赔我们的好奇心。所以整段包在 try 里,任何异常都
 *      退化成「没读到」。
 *   ② **不发明**。字段缺席、类型不对、数值不合理,一律回 undefined,让 worker 落 null =
 *      未知。这两个数会被拿去反查毛利和向商家解释结果,编出来的比空着危险得多。
 *   ③ **只读**。不改请求体、不影响 status 判定、不参与 charged/permanent 的分类。
 */

/**
 * 图片响应(`POST /images/generations`,同步)。
 *
 * 官方契约(两处独立取证一致):
 *   · 本仓自己的**付费实测**留档 —— `docs/superpowers/specs/2026-06-29-phase2-byteplus-migration-design.md:27`
 *     `{ model, created, data:[{url,size}], usage:{output_tokens,total_tokens,generated_images} }`;
 *   · 官方 SDK 类型 —— `Image{Url,B64Json,Size}` / `GenerateImagesUsage{GeneratedImages,OutputTokens,TotalTokens}`。
 *
 * 于是两件事被钉死:
 *   · **计费量是 `generated_images`(张),不是 `total_tokens`**。后者是像素数换算
 *     (2048² = 16,384),跟这一单收多少钱没有关系 —— 本仓的账单核实也写明图按**张**计费
 *     $0.035。把 16,384 记成计费量,毛利对账会当场差四个数量级,而这一列存在的全部理由
 *     就是让毛利可反查;
 *   · 图片响应里**没有** `revised_prompt` —— 官方 `Image` 结构只有 url / b64_json / size。
 *     所以图片这条路上「引擎真正跑的那句提示词」是**未知**,如实空着,绝不去 `data[i]` 上
 *     捞一个契约里不存在的字段来撑场面。
 */
export function readImageReceipt(payload: unknown): GenerationReceipt | undefined {
  try {
    const usage = ((payload as Record<string, unknown> | null)?.usage ?? {}) as Record<string, unknown>;
    const billedUnits = positiveInt(usage.generated_images);
    return billedUnits === undefined ? undefined : { billedUnits };
  } catch {
    return undefined; // 回执读不回来,绝不许反过来影响这一单的结果或扣费
  }
}

/**
 * 视频任务响应(`GET /contents/generations/tasks/{id}`,轮询到 succeeded 的那一份)。
 *
 * 官方契约(同样两处取证):本仓付费实测留档 `…migration-design.md:40`
 * `{ status, content:{video_url}, usage:{total_tokens}, resolution, ratio, duration, framespersecond, seed }`,
 * 官方 SDK `GetContentGenerationTaskResponse` 另有 `revised_prompt`(顶层,可空)。
 *
 * 于是:
 *   · **视频按 token 计费**(5s/720p 实测 108,900),所以这条路上的计费量就是
 *     `usage.total_tokens` —— 和图片那条路的单位**不同**,而这是引擎自己的口径,不是我们的
 *     选择;`GenJob.kind` 已经把两者分开,读的人不会混;
 *   · `revised_prompt` 在这里是**真实字段**,即引擎服务端改写后真正跑的那句话。它可空,空
 *     就是未知。
 */
export function readVideoReceipt(payload: unknown): GenerationReceipt | undefined {
  try {
    const p = (payload ?? {}) as Record<string, unknown>;
    const usage = (p.usage ?? {}) as Record<string, unknown>;
    const billedUnits = positiveInt(usage.total_tokens);
    const finalPrompt = finalPromptOf(p.revised_prompt);
    if (billedUnits === undefined && finalPrompt === undefined) return undefined;
    return {
      ...(finalPrompt !== undefined ? { finalPrompt } : {}),
      ...(billedUnits !== undefined ? { billedUnits } : {}),
    };
  } catch {
    return undefined; // 同上
  }
}

export const ARK_BASE = "https://ark.ap-southeast.bytepluses.com/api/v3";
/** internal model id → Ark foundation-model id (verified active on the account). */
export const IMAGE_MODEL_MAP: Record<string, string> = {
  seedream: "seedream-5-0-260128",
  // Creation S2 §8.1①(2026-09-02):pro 图槽位。供应商 id 只住在这张表里 —— 商家可见的
  // 任何字符串都不许出现型号名(S1 九问4;`provider-secrecy` 是兜底,不是许可证)。
  // 版本尾只读核实(r1 判官 P1 落修,2026-09-02):`arkcli models get dola-seedream-5-0-pro`
  // → `id` = `dola-seedream-5-0-pro-260628`、`version` = `primary_version` = `260628`;
  // `arkcli models versions dola-seedream-5-0-pro` 只回这一个版本。与视频侧同理:
  // 这一格的价(2cr/张、毛利 77.5%)钉在一个**版本相关**的牌价上,基名会跟着平台换版本走。
  "seedream-pro": "dola-seedream-5-0-pro-260628",
};
/** #769(Founder 已裁 2026-08-08):战役视频引擎从 2.0 Fast 换 2.0 mini。
 *  版本化 id 取自 ModelArk 模型档案(只读核实):`arkcli models get dreamina-seedance-2-0-mini`
 *  → `id` / `primary_version` = `dreamina-seedance-2-0-mini-260615`;
 *  `arkcli models versions dreamina-seedance-2-0-mini` 只回这一个版本 260615。 */
export const VIDEO_MODEL_MAP: Record<string, string> = {
  "seedance-2-mini": "dreamina-seedance-2-0-mini-260615",
  // Creation S2 §8.1①(2026-09-02):高清槽位。与 mini 一样,这里是**唯一**允许出现供应商
  // id 的地方;`@fikirtive/core` 的菜单只认内部槽位名 `seedance-2-0`。
  //
  // 版本尾同样只读核实过(r1 判官 P1 落修,2026-09-02):
  //   `arkcli models get dreamina-seedance-2-0`
  //     → `id` = `dreamina-seedance-2-0-260128`、`version` = `primary_version` = `260128`;
  //   `arkcli models versions dreamina-seedance-2-0` 只回这一个版本 260128。
  // 为什么非写版本尾不可:基名会跟着平台换版本走,而 1080p 全 12 档的毛利地基是一次
  // **版本相关**的实测(cost-pins `video:seedance-2.0:1080p-tokens-per-5s = 245,025`,
  // 2026-08-29 实测账单)。基名成功且计费,只是按我们从未量过的那一版计费 ——
  // 那不是「id 错就 4xx、可证明没花钱」的那条路,而是一笔按未知成本收的钱。
  // 换版本 = 重跑一次实测再改这一行,不许只改 id。
  "seedance-2-0": "dreamina-seedance-2-0-260128",
};

/**
 * #795 — every call out to the engine gets a deadline, because a socket that never answers is
 * not a slow generation, it is a WORKER SEAT held open forever.
 *
 * `fetch` has no default timeout. Node's undici will wait on a half-open connection until the
 * OS gives up — minutes to never. There is exactly one generation seat today (#760 is the
 * ticket that widens it), so one hung socket is the whole product's generation capacity, and
 * nothing in the retry machinery below can fire because nothing has failed yet: the request is
 * still "in flight". The deadline is what turns "hung forever, silently" into "failed, and the
 * charge boundary above decides what that costs".
 *
 * THREE SIZES, because three different things are being waited for:
 *   · CONTROL (video submit, video poll) — a request the engine answers from its own queue
 *     state, WITHOUT rendering anything inside it. 60s is already ~20× the measured p99;
 *     past it the connection is not slow, it is gone.
 *   · RENDER (the image POST) — see `ARK_IMAGE_TIMEOUT_MS` below.
 *   · TRANSFER (image/video download) — bytes over the wire from object storage. A 15-minute
 *     720p clip is tens of megabytes, so this one has to tolerate a genuinely slow pipe; 5 min
 *     is generous for that and still far inside the worker's own 40-minute message expiry
 *     (#1386 widened GEN_QUEUE_POLICY.expireInSeconds from 20m to 40m).
 *
 * WHAT A TIMEOUT COSTS. Aborting is a network failure, so it lands on the SAME classification
 * the charge boundary already applies to "no response at all": outcome unknown ⇒ treated as
 * billed (a plain retry would POST a second time and pay twice). Timing out therefore never
 * loosens the money rule — it only stops the seat being held.
 */
export const ARK_CONTROL_TIMEOUT_MS = 60_000;
export const ARK_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/**
 * Creation §5 :177 —— **图片那一次 POST 不是控制面调用,它就是渲染本身**。
 *
 * `/images/generations` 是同步端点:请求发出去之后连接一直开着,模型在里面画图,画完了图
 * 才随响应回来。所以这条调用的时长 = **出图时长**,不是「引擎回一句队列状态要多久」。
 * #795 当时把它和视频 submit 一起塞进 `ARK_CONTROL_TIMEOUT_MS`(60s)—— 那是按后者
 * (任务创建,不渲染)量出来的尺寸,套在前者身上是量错了东西。
 *
 * 这个量错在 staging E2E Round 1 变成了**门槛 A3 的 FAIL**:商家对一张已生成图点
 * `Create variations`,job `01M1ZRF0D1JWSCZGHN8EX6YCNJ` 于 `05:39:42.124Z` 创建、
 * `05:40:42.828Z` FAILED —— **60.704 秒**,而这条路上只有一个 60 秒的钟。60s 一到,
 * fetch 被 abort ⇒ 走「结果不明 ⇒ 按已计费」那条(它是对的,别动)⇒ 终态失败 + 退款,
 * 落库的正是 `generation provider returned only 0/1 usable images`、spent=true、
 * spentUsd=USD0.035、billedUnits=null(证据 `docs/audits/fullstack-staging-2026-09-08/
 * backend-evidence.md:110`、`report-round1.md:198`)。商家一张图没拿到,毛利照烧。
 *
 * 60s 从来就不宽裕:同一轮走查里**成功**的图片作业整单耗时 27.6s / 28.9s / 31.6s,带参考图
 * 合成的那单 41.4s(`backend-evidence.md:31,82,154,188`)—— 60s 只有它的 1.5 倍,一次比平常
 * 慢的渲染就越线。5 分钟与下载面同尺寸:够一次真慢的出图,又远在 worker 自己那条钟链之内
 * (供应商超时 < stale 35m < 队列过期 40m < 清道夫 45m,#1386 一并加宽,由
 * `apps/worker/src/jobs/clock-invariants.test.ts` 守着)。
 *
 * 钱路语义一格没动:超时仍然是 charged,仍然终态、仍然退款。变的只是**在判它死之前愿意等
 * 多久** —— 等到了,商家拿到他已经付过钱的那张图。
 */
export const ARK_IMAGE_TIMEOUT_MS = 5 * 60_000;

/**
 * 一次付费 POST 该配哪一把尺 —— 判据只有一条:**这次连接里有没有在渲染**。
 *
 * 导出成函数(而不是在调用点各写各的)是为了让「图片 POST 用的是渲染面的尺寸」这件事
 * 可以被直接断言,而不是靠读 `paidPost` 的实现推。
 */
export function arkPostTimeoutMs(what: "image request" | "video submit"): number {
  return what === "image request" ? ARK_IMAGE_TIMEOUT_MS : ARK_CONTROL_TIMEOUT_MS;
}

/**
 * #1435(零排队)— how long from SUBMISSION the WORKER keeps rescheduling polls before it gives
 * up on a video task (outcome unknown ⇒ treated as billed). This replaced the old
 * `VIDEO_POLL_TIMEOUT_MS`, which bounded how long a SINGLE blocking call polled in-process —
 * that concept no longer exists: `pollVideo` below takes one look and returns, so nothing in
 * THIS package loops or sleeps any more (see gen.ts's resume-poll branch, which owns the
 * reschedule loop across many short pg-boss deliveries).
 *
 * Anchored on the ENGINE's own termination clock, not an arbitrary client patience budget: the
 * submit body always sends `execution_expires_after: 3600` (below), so the provider itself kills
 * an abandoned task at exactly one hour and a poll after that should observe `expired` ($0, not
 * billed). This constant is that one hour PLUS a safety margin for poll-cadence gaps and clock
 * skew — past it, something is wrong even by the engine's own clock, so treat it as ambiguous
 * rather than silently polling forever.
 *
 * Exported for apps/worker/src/jobs/clock-invariants.test.ts (QUEUE-A6): unlike the old
 * VIDEO_POLL_TIMEOUT_MS, this is NOT part of the provider-timeout < stale < expiry < reaper
 * chain any more — a video task no longer occupies one worker slot (or one `providerRequestGate`
 * slot) for its whole life, so it no longer needs to fit inside GEN_STALE_MS/queue-expiry/
 * GEN_REAP_MS. It is instead the input to its OWN reaper rule (apps/worker/src/jobs/gen.ts,
 * `isGenRowStale`), anchored on `submittedAt` rather than claim time.
 */
export const VIDEO_SUBMISSION_ABANDON_MS = 65 * 60_000;

/**
 * #1435 判官初审 P1-3 —— 商家可见的等待上限(产品口径),与上面 `VIDEO_SUBMISSION_ABANDON_MS`
 * 是**两把不同的尺子**,量的是两件不同的事:
 *
 *   - 这一把(`VIDEO_MERCHANT_WAIT_MS`,15m):gen.ts 的 resume-poll 分支——也就是消息**正常
 *     按计划送达、真的在轮询**的那条主路——用它判「等太久,不再等了」。过线就抛
 *     `chargedError`,终态 FAILED + 退款,绝不继续轮询、也绝不让这一单有机会活到
 *     `poll.status==="failed"` reason=expired 那条分支去自然重投:那条分支的失败是 PLAIN(不带
 *     charged),会 requeue 回 QUEUED,而 QUEUED 的下一次投递读不到在飞任务标记,只能当成全新
 *     提交——判官实测这条链子在引擎 60m 自己判 expired、又被当作可重试的 PLAIN 错误之后,能在
 *     `GEN_RETRY_LIMIT`(2,即最多 3 次总尝试)内让同一单**真的重新付费提交最多 3 次**,而
 *     "expired 官方口径 $0" 这件事探针从未实测过(README §1"未实测")——这把 15m 的尺子存在
 *     的意义就是让这单商家可见的作业**根本活不到**引擎那 60m 自己判 expired 的那一刻,金钱
 *     风险因此不成立,不是靠信一句未验证的官方文档兜底。
 *   - 上一把(`VIDEO_SUBMISSION_ABANDON_MS`,65m):**只**留给 `apps/worker/src/jobs/gen.ts`
 *     的 `isGenRowStale`(清道夫扫描)当兜底——它管的是消息**彻底丢失**(pg-boss 没能按计划
 *     把下一次轮询消息送回来,这一行的 resume-poll 分支因此**从未有机会跑起来**判断 15m)那
 *     种情形。这时唯一能发现异常的只有独立的定期清道夫扫描,它需要自己一把足够宽松的尺子
 *     (65m,比引擎自己的 60m 终止钟还多一段安全边际),不能沿用 15m——15m 对"消息按计划
 *     送达、只是视频真的还没渲染完"这种健康情形太短,会把正常在飞的视频误判成丢失消息。
 *
 * 两把尺子谁都不覆盖谁:15m 是主动轮询路的产品口径,65m 是被动清道夫路的消息丢失兜底,
 * 各自只在自己的场景里生效。
 */
export const VIDEO_MERCHANT_WAIT_MS = 15 * 60_000;

/**
 * #782 r2 — how long the FREE last frame may hold the paid clip hostage.
 *
 * The clip is already downloaded and already billed by the time this runs; the still is a
 * by-product. "Best-effort" therefore has to cover the slow case as well as the failing one:
 * an unbounded `await` on a stalled TOS connection would keep the job GENERATING for as long
 * as the socket stayed open, and every minute of that is a minute closer to the queue expiry
 * that would REDELIVER a clip we already paid for. Eight seconds is far past a real 1–2 MB
 * PNG fetch and far short of any of the worker's clocks, so it can only ever fire on a hang.
 * On timeout we drop the still and return the clip — the pre-#782 outcome.
 */
export const LAST_FRAME_FETCH_TIMEOUT_MS = 8_000;

export class BytePlusProvider implements GenerationProvider {
  readonly name = "byteplus";
  constructor(private apiKey: string) {}

  private headers() {
    return { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" };
  }

  /** #672 — the one paid POST each Ark path makes, with the charge boundary applied
   *  to EVERY way it can die. House rule (settled across the #664/#665 judge chain):
   *  a failure may stay PLAIN (retryable) ONLY where it is provable the engine never
   *  spent; anything already billed — or whose outcome is unknown — is a chargedError
   *  the worker must terminal-fail, because a retry POSTs again and pays twice.
   *
   *  The two Ark paths buy different things with a 2xx (the image endpoint bills
   *  synchronously and returns the picture; the video endpoint accepts an order that
   *  bills on completion), but what a FAILED POST can PROVE is identical on both, so
   *  one yardstick serves both. Callers must not re-inspect the status: the
   *  classification lives here and nowhere else. */
  private async paidPost(
    what: "image request" | "video submit",
    url: string,
    model: string,
    body: unknown,
    /** FSE-001 —— 「参考图里有可辨真人」这一条拒绝要说的那句话。缺席 ⇒ 上传真人照那一句
     *  (`personRejectionSentence(undefined)`)。别的 4xx 一格不受它影响。 */
    personRejectionCopy?: string,
  ): Promise<Response> {
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      // #795 — a submit that never answers holds the only generation seat open. An abort
      // surfaces here as a rejected fetch, which is already the "outcome unknown ⇒ billed"
      // branch below: the deadline changes how long we wait, never who pays.
      //
      // Creation §5 :177 —— 尺寸按**这次连接里有没有在渲染**分:图片 POST 是同步渲染
      // (`ARK_IMAGE_TIMEOUT_MS`),视频 submit 只是建任务(`ARK_CONTROL_TIMEOUT_MS`)。
      signal: AbortSignal.timeout(arkPostTimeoutMs(what)),
    }).catch((e: unknown) => {
      // No response at all (connection reset, DNS, socket closed mid-flight). The
      // request may already have reached the engine — and been billed (image) or
      // turned into a task (video) — with only the reply lost. Outcome unknown ⇒
      // treated as billed, the same yardstick as "submit returned 2xx but the
      // receipt was unreadable" below (#664). PLAIN here would requeue and POST a
      // SECOND time against the same merchant request.
      const detail = e instanceof Error ? e.message : String(e);
      console.error(`generation provider ${what} got no response:`, { model, error: detail });
      throw chargedError(`generation provider ${what} got no response (${detail}); outcome unknown, treated as billed`);
    });
    if (res.ok) return res;
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    console.error(`generation provider ${what} failed:`, { model, status: res.status, detail });
    // 4xx — rejected BEFORE the engine spent anything (rate limit, validation, auth).
    // The only provably-free failure, so the only one that stays PLAIN and retries.
    if (res.status >= 400 && res.status < 500) {
      // #765 — one 4xx the MERCHANT can act on, and the only one this adapter translates.
      // Retrying a rate limit or a gateway wobble is right; retrying this is not. The engine
      // looked at the reference image, saw a face it reads as a real person, and refused the
      // task — and it refuses the same picture identically every time. Left on the generic
      // route the merchant waits out the whole retry budget and is then told "it didn't go
      // through", with the reason and the way out never spoken. So it becomes terminal here,
      // carrying the sentence they read on both surfaces.
      //
      // Still NOT charged: this is a task-create rejection, provably free, so the hold is
      // refunded and no spend is recorded. `permanent` changes only when the worker gives up.
      //
      // FAIL CLOSED twice over. `referenceImagePersonRejected` recognises only the measured
      // shape, so any other 4xx falls through to the generic line below; and only the VIDEO
      // submit is asked, because the video task-create endpoint is where that shape was
      // measured (2026-08-08, 4 refusals of 4 face shapes). The image endpoint has never been
      // seen to return it, and a refusal we invented would be worse than a generic one.
      //
      // FSE-001(staging E2E 2026-09-08)—— **同一条拒绝,两种来路**。被拒的那张图血统里带
      // 官方演员(CHARACTER 元素照)时,原来那句「去 Library 挑一个演员」把已经用了官方演员的
      // 商家打发回他刚来的地方 —— 照做一遍,同一句拒绝。选哪一句的判据由
      // worker 随请求带下来(它才是从自有 id 解析引用的那一层),句子本身仍然只有
      // `@fikirtive/core/gen-failure` 一份白名单。
      if (what === "video submit" && referenceImagePersonRejected(detail)) {
        throw permanentInputError(personRejectionCopy ?? REFERENCE_IMAGE_PERSON_REJECTED);
      }
      // #1435(QUEUE-A5)— video submit specifically: the queue-depth 429 reuses `QuotaExceeded`
      // for more than one real condition (see `classifyProviderQuotaExceeded`'s doc for why this
      // is message-based, not code-based, and why "queue-full"/"unknown" fall through to the
      // SAME ordinary retryable line below rather than getting special-cased). Scoped to video
      // submit only — the image path is untouched per spec §3 ("图片路不改").
      if (what === "video submit" && res.status === 429 && classifyProviderQuotaExceeded(detail) === "quota-exhausted") {
        throw permanentInputError(GENERATION_ENGINE_UNAVAILABLE);
      }
      throw new Error(`generation provider ${what} failed (${res.status})`);
    }
    // 5xx (and any other non-2xx) — a server-side error cannot prove the engine didn't
    // run/accept: a gateway timeout or upstream 500 can land AFTER that happened.
    // Fail closed: what we cannot prove was free is treated as spent.
    throw chargedError(`generation provider ${what} failed (${res.status}); outcome unknown, treated as billed`);
  }

  async generate(req: GenerationRequest): Promise<GeneratedImage[]> {
    const model = IMAGE_MODEL_MAP[req.model];
    if (!model) throw new Error("generation provider has no image model mapping"); // pre-spend
    const conditioned = req.inputImageUrls.length > 0;
    // #642: the merchant's shape, as the exact pixels the engine will produce.
    // The WxH form is bound by the engine to total pixels and ratio — and the bounds are
    // **per slot**, not one family-wide pair (`GEN_IMAGE_MODEL_PIXEL_LIMITS`): pro's ceiling
    // (4,624,220 px) is LOWER than lite's, so 16:9 / 9:16 (2880×1620 = 4,665,600 px) are
    // legal on lite and over the line on pro.
    //
    // 判官 r1 P1 落修 —— 这里改成**逐模型校验**，而不是拿一张全家族共用的尺寸表拼 `size`。
    // 新建请求那一路有契约闸（`genRequest` 按槽位自己的 `aspectRatios` 收窄），但那道闸
    // 挡不住 **worker 从数据库快照重放的那一路**：`job.imageOptions.aspectRatio` 是一个无约束
    // 字符串，历史行与畸形行都会原样送到这里。越限 = **抛错拒绝，不降级、不自动缩小**
    // （规格「未验先禁」），而且抛在任何付费 POST **之前** ⇒ 可证明零花费、worker 退款。
    // Price is unaffected either way: this engine bills per image, not per size.
    const { width, height } = imageOutputSizeForModel(req.model, req.aspectRatio);
    // #777 组图:整组一次请求出齐。分岔在这里,因为**下面那条路的每一条注释都建立在
    // 「一次 POST = 一张图」上** —— 计费边界、并发闸的占位、短交判定,全部按那个前提写的。
    // 把两种形状塞进同一个循环,只会让那些注释开始说谎。
    if (req.coherentSet && req.count > 1) {
      return this.#coherentSet(req, model, width, height);
    }
    // one request per image (count <= MAX_GEN_COUNT); each is all-or-nothing.
    //
    // #796 判官 r1 P1-1 — THIS is where a "job" stops being one request. A single image job
    // fans out `count` paid POSTs at once, so N concurrent jobs are N×count concurrent requests
    // against an account whose ceiling is 10. Every POST therefore goes through the shared
    // process-wide gate (gen and refgen spend the SAME account budget); over-budget requests
    // WAIT instead of coming back as a 429, which a merchant reads as "generation failed".
    // The gate is held around the POST only — the result download afterwards is not a call
    // against the generation API.
    const gate = providerRequestGate();
    const results = await Promise.allSettled(
      Array.from({ length: req.count }, async () => {
        // #672: this POST IS the billing event on a sync endpoint. paidPost() owns the
        // whole charge boundary for it — only a 4xx (rejected before the model ran) comes
        // back PLAIN; a network throw or a 5xx is "outcome unknown" ⇒ charged. Do not
        // re-inspect the status here.
        const res = await gate.run(() => this.paidPost("image request", `${ARK_BASE}/images/generations`, model, {
          model, prompt: req.prompt, size: `${width}x${height}`, response_format: "url",
          // F40: Ark Seedream defaults watermark=true — paying customers must not receive
          // watermarked images, so set it false explicitly.
          watermark: false,
          // Multi-reference conditioning: Ark Seedream's `image` field accepts an array of
          // source images (verified against ark.ap-southeast; ≤14 refs, inputs+outputs ≤ 15,
          // and the worker caps at MAX_CONDITIONING_IMAGES=10 → 10+1 ≤ 15). Send the whole
          // presigned set so product+logo+character all condition. Keep the proven single-
          // string form for exactly one ref (the live-verified prod shape); array only for 2+.
          ...(conditioned ? { image: req.inputImageUrls.length === 1 ? req.inputImageUrls[0] : req.inputImageUrls } : {}),
        }));
        // res.ok ⇒ billed; a failure past here is a CHARGED failure (a retry would re-bill).
        // EVERY way of dying past this line is wrapped, not just the ones with a status code:
        // a malformed receipt (`res.json()` throwing), a download whose connection drops
        // (`fetch` rejecting outright), a body that stops mid-stream (`arrayBuffer()` throwing).
        // An unmarked escape here reads to the batch logic below as a pre-charge failure and
        // gets retried — re-billing an image we already paid for.
        try {
          const data = (await res.json()) as { data?: { url: string }[]; usage?: unknown };
          const url = data.data?.[0]?.url;
          if (!url) throw chargedError("generation provider image response had no result URL");
          // #776:回执在下载**之前**读 —— 它读的是这份已经到手的响应,和字节能不能拿到无关。
          // readImageReceipt 永不抛,所以这一行不会把一单成功的生成推进 charged 分支。
          const receipt = readImageReceipt(data);
          // #795 — a stalled download is still a held seat. Past the deadline the abort lands in
          // the catch below, which already marks the failure charged (the image IS billed).
          const r = await fetch(url, { signal: AbortSignal.timeout(ARK_DOWNLOAD_TIMEOUT_MS) });
          if (!r.ok) throw chargedError(`image download → ${r.status}`);
          return {
            bytes: new Uint8Array(await r.arrayBuffer()),
            ext: extFromUrl(url) ?? "png",
            ...(receipt ? { receipt } : {}),
          } as GeneratedImage;
        } catch (e) {
          if (e instanceof Error && (e as { charged?: boolean }).charged) throw e; // already marked
          throw chargedError(`generation provider billed but the image result was unusable (${e instanceof Error ? e.message : String(e)})`);
        }
      }),
    );
    const ok = results.flatMap((s) => (s.status === "fulfilled" ? [s.value] : []));
    if (ok.length === req.count) return ok;
    // Shortfall (F05). If ANY image was billed — a promise fulfilled (its POST succeeded and
    // billed), or a rejection is marked charged (a post-POST failure, or a POST whose outcome is
    // unknown) — the batch is a CHARGED failure: a retry would re-bill, so fail closed as charged.
    // Only when EVERY rejection is a provably-free failure does the batch rethrow the first as a
    // PLAIN error, so the worker retries and the spend audit isn't polluted with phantom spend.
    // #672 narrowed what "provably free" means at the per-image level (a POST 4xx — nothing ran),
    // which narrows the batch by construction: a network throw or a 5xx on any single POST now
    // arrives here already marked charged and flips the whole batch closed. The previous reading
    // ("the POST itself 4xx/5xx'd, nothing billed") was the P0 hole — count images all throwing
    // produced zero marks, so the batch went PLAIN and the worker re-POSTed a batch that may
    // already have reached the engine.
    const rejections = results.flatMap((s) => (s.status === "rejected" ? [s.reason] : []));
    const anyCharged = ok.length > 0 || rejections.some((e) => e instanceof Error && (e as { charged?: boolean }).charged);
    if (anyCharged) throw chargedError(`generation provider returned only ${ok.length}/${req.count} usable images`);
    throw rejections[0] instanceof Error ? rejections[0] : new Error(String(rejections[0]));
  }

  /**
   * #777 —— **一次请求出一整组连贯的图**(同一个模特的多个角度、同一件产品的多个尺寸)。
   *
   * 与上面那条散图路的差别只有一处,但那一处是这张票的全部:count 张图从 count 次付费
   * POST 变成 **一次** 付费 POST。于是
   *   - 供应商侧账目形状变了:一次调用按张计费,而不是 N 次调用各计一次。**记账的钱数
   *     没变**(仍是每张 $0.035,`genSpentUsd` 一行没改),变的是调用次数;
   *   - 商家侧一格没变:仍是每张 1 显示 credit,`pricedGenCredits` 一行没改,
   *     reserve == settle 照旧;
   *   - 并发闸从占 count 格变成占 1 格 —— 这正是本票要的那个量级差(账户硬顶下,
   *     一次请求换 N 张)。
   *
   * 计费边界与散图路**同一把尺**,一处都没有放松:
   *   - POST 本身交给 `paidPost` 判定(4xx = 可证明没花钱 ⇒ PLAIN 可重投;
   *     网络抛/5xx = 结果不明 ⇒ charged 终结);
   *   - 2xx 之后的每一种死法都是 charged:回执读不出、URL 不齐、下载断流。
   *     这条路上「已计费」的粒度更粗 —— 一次 2xx 就把整组都计了费,所以张数不齐
   *     **必须**是 charged:重投会把整组再做一遍、再付一遍。
   */
  async #coherentSet(
    req: GenerationRequest,
    model: string,
    width: number,
    height: number,
  ): Promise<GeneratedImage[]> {
    const conditioned = req.inputImageUrls.length > 0;
    // 一次调用只占一格并发(散图路是 count 格)。闸只围住 POST —— 后面的结果下载
    // 不是一次生成 API 调用,与散图路同一条口径。
    const res = await providerRequestGate().run(() => this.paidPost("image request", `${ARK_BASE}/images/generations`, model, {
      model, prompt: req.prompt, size: `${width}x${height}`, response_format: "url",
      watermark: false,
      // 组图开关 + 这一组最多几张。`auto` 是引擎自己决定要不要成组、成几张,
      // `max_images` 是上限 —— 所以**可能少给**,少给的处理见下面的张数校验。
      sequential_image_generation: "auto",
      sequential_image_generation_options: { max_images: req.count },
      // 条件图与散图路逐字同形(单张用字符串、多张用数组)。引擎的硬约束是
      // 输入+输出 ≤ 15;worker 侧参考图上限 MAX_CONDITIONING_IMAGES=10,
      // 出图上限 MAX_GEN_COUNT=4 ⇒ 10+4 ≤ 15,永远撞不到。
      ...(conditioned ? { image: req.inputImageUrls.length === 1 ? req.inputImageUrls[0] : req.inputImageUrls } : {}),
    }));
    // res.ok ⇒ 这一整组都已计费。往下每一种死法都必须 charged。
    let urls: string[];
    try {
      const data = (await res.json()) as { data?: { url?: string }[] };
      urls = (data.data ?? []).map((item) => item?.url).filter((url): url is string => typeof url === "string" && url.length > 0);
    } catch (e) {
      throw chargedError(`generation provider billed but the coherent set receipt was unreadable (${e instanceof Error ? e.message : String(e)})`);
    }
    // 短交(引擎只出了一部分)。这一票**不改结算语义**:与今日散图路的 F05 逐字一致 ——
    // 整单失败、整单退款,商家一分钱不付,COGS 我们自己吃。charged ⇒ 不重投:
    // 重投会把整组再做一遍再付一遍,而商家手上还是什么都没有。
    if (urls.length !== req.count) {
      throw chargedError(`generation provider returned only ${urls.length}/${req.count} images in the coherent set`);
    }
    try {
      return await Promise.all(urls.map(async (url) => {
        // #795 —— 与散图路的结果下载同一条截止时间。这一组已经计了费,超时中止落进
        // 下面的 catch,照旧标 charged;deadline 改的只是「等多久」,不改谁付钱。
        const r = await fetch(url, { signal: AbortSignal.timeout(ARK_DOWNLOAD_TIMEOUT_MS) });
        if (!r.ok) throw chargedError(`image download → ${r.status}`);
        return { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(url) ?? "png" } as GeneratedImage;
      }));
    } catch (e) {
      if (e instanceof Error && (e as { charged?: boolean }).charged) throw e; // already marked
      throw chargedError(`generation provider billed but the coherent set was unusable (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  /**
   * #1435(零排队)—— submit-only. The gate is taken ONLY around the paid POST below, not around
   * this whole method and never again inside `pollVideo` — #796 判官 r1 P1-1's "a video task
   * holds one account slot for its whole life" reading is retired: it modeled the account's
   * ceiling as a TASK-duration budget because the old client-side implementation held a slot for
   * submit+poll (up to 60s + 15m) in one call. That was the actual, self-inflicted cost, not a
   * property of the account: the account's `concurrent_requests` ceiling (10, arkcli-measured,
   * `provider-concurrency.ts`) is about in-flight REQUESTS, exactly like the image path already
   * reads it. A submit and each later poll are each their own short request (≤`ARK_CONTROL_
   * TIMEOUT_MS`=60s), so this method's gate hold time is now the SAME order of magnitude as one
   * image POST — not 16 minutes. See `pollVideo` below for the other half.
   */
  async submitVideo(req: VideoRequest): Promise<VideoSubmission> {
    const model = VIDEO_MODEL_MAP[req.model];
    if (!model) throw new Error("generation provider has no video model mapping"); // pre-spend
    // #646 T5. First+last frames, single first frame, and whole-clip reference video are three
    // MUTUALLY EXCLUSIVE scenarios — they cannot be mixed in one task. Refuse the mixed shape
    // BEFORE the paid submit (no spend) rather than let the engine reject it after billing.
    // Video is always count=1 (startGen hardcodes it); the charge is flat per resolution.
    if (req.tailImageUrl && req.refVideoUrl) throw new Error("generation provider can't combine an end frame with a reference video"); // pre-spend
    const i2v = req.imageUrl.length > 0;
    // #785 —— @元素参考照是**第四个**场景(reference-to-video:一段文字 + 一组参考素材),
    // 与上面三个同样互斥。判据不在这里手写,读的是 core 的 `videoReferencesRide` —— 卡面
    // (批准前说几张)、worker(真送几张)、这道闸(付费前拒绝)三处必须同一句话。
    // pre-spend:走到这里还没有任何一个 POST 发出去。
    const refImageUrls = req.refImageUrls ?? [];
    if (refImageUrls.length > 0 && !videoReferencesRide({
      hasVideoStartFrame: i2v,
      hasVideoTailFrame: !!req.tailImageUrl,
      hasReferenceVideo: !!req.refVideoUrl,
    })) {
      throw new Error("generation provider can't combine element reference photos with a start frame, an end frame, or a reference video"); // pre-spend
    }
    // 部件总数的硬闸:首帧/末帧与参考照是同一种部件,共用 `MAX_VIDEO_IMAGE_PARTS` 个名额。
    // 上游(worker 的 round-robin,上限来自同一个 core 函数)本来就不会超,这是纵深防御 ——
    // 超了宁可在花钱之前自己拒绝,也不要让引擎在计费之后拒。
    const imagePartCount = (i2v ? 1 : 0) + (req.tailImageUrl ? 1 : 0) + refImageUrls.length;
    if (imagePartCount > MAX_VIDEO_IMAGE_PARTS) {
      throw new Error(`generation provider takes at most ${MAX_VIDEO_IMAGE_PARTS} images per clip (this request has ${imagePartCount})`); // pre-spend
    }
    // An end frame with no start frame isn't a scenario the engine has — and silently dropping it
    // would deliver (and bill for) a clip the merchant never asked for. Same guard the fallback
    // adapter keeps. Unreachable from the worker (it only resolves a tail alongside a source), so
    // this is defense in depth.
    if (req.tailImageUrl && !i2v) throw new Error("generation provider needs a start image for an end frame"); // pre-spend
    const content: unknown[] = [];
    if (req.tailImageUrl && i2v) {
      // first+last frames: BOTH parts carry an explicit role — that pair IS what selects the
      // scenario. A roleless pair would read as the single-frame scenario instead.
      // Mismatched shapes: the first frame wins and the end frame is cropped to it.
      content.push({ type: "image_url", image_url: { url: req.imageUrl }, role: "first_frame" });
      content.push({ type: "image_url", image_url: { url: req.tailImageUrl }, role: "last_frame" });
    } else if (i2v) {
      // single source frame — role may be omitted (the engine reads it as the first frame).
      content.push({ type: "image_url", image_url: { url: req.imageUrl } });
    }
    // #785 —— @元素(产品图 / 代言人)的参考照。**数组顺序即引擎收到的顺序即编号**:
    // 这里逐个 push,不排序、不去重、不重排,所以「送了哪几张、第几张是谁」只有一个来源
    // (worker 的 round-robin 选片),不存在第二套编号逻辑。
    for (const url of refImageUrls) {
      content.push({ type: "image_url", image_url: { url }, role: "reference_image" });
    }
    if (req.refVideoUrl) content.push({ type: "video_url", video_url: { url: req.refVideoUrl }, role: "reference_video" });
    // The text part is the merchant's prompt ONLY — every control is a top-level field below.
    content.push({ type: "text", text: req.prompt.trim() });

    // #672: the paid submit. paidPost() owns its charge boundary — a 4xx (rate limit /
    // validation / auth, rejected before the engine took the order) is the only provably-free
    // failure and stays PLAIN; the fetch throwing outright, or a 5xx, cannot prove no task was
    // created, so they land as chargedError for exactly the reason spelled out below the call:
    // a retry would submit a SECOND task against the same merchant request.
    //
    // #1435 — gated here (the image path's exact pattern: `gate.run(() => paidPost(...))`,
    // nothing else inside this method touches the gate).
    const sub = await providerRequestGate().run(() => this.paidPost("video submit", `${ARK_BASE}/contents/generations/tasks`, model, {
      // #646 T5: STRICT top-level parameters, not the legacy `--flag` suffix on the prompt text.
      // The two transports differ in exactly the way that costs money: the legacy suffix is
      // loosely validated — a wrong value is silently replaced by the engine default and the
      // clip is produced and BILLED at a spec the merchant never approved. Top-level fields are
      // strictly validated: a wrong value is an error, before anything is billed.
      // Deliberately NOT sent (this model rejects all three under strict validation):
      // seed, camera_fixed, frames.
      model, content,
      resolution: req.resolution ?? "720p",
      duration: req.durationSeconds,
      // absent shape ⇒ omit the field and let the engine pick (adaptive), matching the
      // pre-#646 behaviour of not appending a ratio flag. Never send an invented value.
      ...(req.aspectRatio ? { ratio: req.aspectRatio } : {}),
      // the merchant's sound choice, finally wired. Default true = the engine default and
      // videoDefaults()'s audio for this model, so an unset toggle changes nothing.
      generate_audio: req.audio ?? true,
      // #782 — ask for the clip's LAST FRAME as a still, so shot N+1 can literally start
      // where shot N ended. FREE: the engine bills the clip (token formula above: output
      // seconds × pixels × fps), and the still is a by-product of a render already paid
      // for — no new price tier, no new charge, nothing added to the merchant's quote.
      // Sent ONLY when the caller asked, so a plain Gen-space clip's request body is
      // byte-identical to what it was before this ticket.
      ...(req.returnLastFrame ? { return_last_frame: true } : {}),
      // F40 (same rule as the image path): paying merchants must not receive watermarked
      // output. Video defaults to false today; declare it so a default drift can't undo that.
      watermark: false,
      // F06 reconciliation window, below. 3600s is the engine's minimum.
      execution_expires_after: 3600,
    }, personRejectionSentence(req.castMemberInReferences)));
    // submit returned 2xx ⇒ the engine ACCEPTED the order. From here on we can no longer prove
    // the task was never created, so an unreadable receipt is "outcome unknown", not "nothing
    // happened" (#657). PLAIN here would requeue and submit a SECOND task against the same
    // merchant request — two tasks, two charges. Charged ⇒ terminal, no retry.
    let taskId: string | undefined;
    try {
      taskId = ((await sub.json()) as { id?: string }).id;
    } catch (e) {
      throw chargedError(`generation provider video submit receipt was unreadable (${e instanceof Error ? e.message : String(e)})`);
    }
    if (!taskId) throw chargedError("generation provider video submit returned no task id");
    // task created ⇒ billed on success. #1435 — polling moved OUT of this method (see
    // `pollVideo` below); the caller (gen.ts) owns the reschedule loop across many short
    // deliveries instead of this one call blocking for up to 15 minutes.
    return { providerTaskId: taskId };
  }

  /**
   * #1435(零排队)— ONE status check, gated exactly like the image path reads a single request
   * (`gate.run(() => fetch(...))`), never looping or sleeping. See `VideoPollResult` (core) for
   * the three outcomes; this method never throws for a TRANSIENT failure (network reset, non-2xx,
   * malformed body) — those come back `pending` so the caller looks again later, exactly like the
   * old loop's "continue polling" branches. It throws only where the OLD loop's `succeeded`
   * branch already did: the clip IS billed by the time `status === "succeeded"`, so every way of
   * failing to get its bytes into our hands past that point (#795's same reasoning) is a
   * `chargedError`, not a retry that would generate a second paid clip.
   */
  async pollVideo(providerTaskId: string, opts: { returnLastFrame: boolean }): Promise<VideoPollResult> {
    let t: { status?: string; content?: { video_url?: string; last_frame_url?: string } };
    try {
      const st = await providerRequestGate().run(() =>
        fetch(`${ARK_BASE}/contents/generations/tasks/${providerTaskId}`, {
          headers: this.headers(),
          signal: AbortSignal.timeout(ARK_CONTROL_TIMEOUT_MS),
        }),
      );
      if (!st.ok) return { status: "pending" }; // transient non-2xx — the worker looks again later
      t = (await st.json()) as { status?: string; content?: { video_url?: string; last_frame_url?: string }; usage?: unknown; revised_prompt?: unknown };
    } catch {
      // network reset / malformed body — the task was already submitted and may still succeed
      // (and bill) on BytePlus, so treating this as terminal would risk a second paid submit on
      // the caller's next retry. The caller's own submission-anchored deadline (not this call)
      // decides when "still pending" has gone on too long (QUEUE-A6).
      return { status: "pending" };
    }
    if (t.status === "succeeded") {
      // The clip exists and IS billed. Every way of failing to get it into our hands past this
      // line is a charged failure — including the ones that never produce a status code:
      // a download whose connection drops (`fetch` rejecting), a body that stops mid-stream
      // (`arrayBuffer()` throwing). PLAIN here would let the caller requeue a SECOND paid clip.
      const url = t.content?.video_url;
      if (!url) throw chargedError("generation provider video response had no result URL");
      let video: GeneratedVideo;
      // #776:回执来自这条**成功任务**自己的响应(计费量与它真正跑的提示词都在这一份里),
      // 读在下载之前 —— 拿不拿得到字节与引擎报了什么无关。readVideoReceipt 永不抛,所以这
      // 一行不会把一条已经做出来、已经计费的片子推进 charged 分支。
      const receipt = readVideoReceipt(t);
      try {
        // #795 — same deadline as the image download, same landing: the clip IS billed, so an
        // abort is a charged failure, never a plain retry that would generate a second one.
        const r = await fetch(url, { signal: AbortSignal.timeout(ARK_DOWNLOAD_TIMEOUT_MS) });
        if (!r.ok) throw chargedError(`generation provider video download failed (${r.status})`);
        video = {
          bytes: new Uint8Array(await r.arrayBuffer()),
          ext: extFromUrl(url) ?? "mp4",
          ...(receipt ? { receipt } : {}),
        };
      } catch (e) {
        if (e instanceof Error && (e as { charged?: boolean }).charged) throw e; // already marked
        throw chargedError(`generation provider video download failed (${e instanceof Error ? e.message : String(e)})`);
      }
      // #782 — the clip's last frame, and why it is the ONLY thing in this method that
      // cannot fail the job. The paid product is the CLIP, and it is already in hand and
      // already billed. The still is a free by-product used to start the next shot; if it
      // is missing or won't download, the correct outcome is "no automatic continuation
      // this time", never a charged failure on a clip we successfully produced. So every
      // failure here is swallowed, deliberately, and the video returns exactly as it did
      // before this ticket.
      //
      // UNVERIFIED RESPONSE KEY (#782, stated rather than hidden): the REQUEST field
      // `return_last_frame` was measured against this model on 2026-08-08 (accepted and
      // effective, alongside resolution/duration/ratio/generate_audio/priority). The
      // RESPONSE key was NOT — `last_frame_url` is read as the symmetric sibling of
      // `video_url`. If the engine spells it differently, this reads undefined and the
      // feature degrades to today's behaviour (shot N+1 simply has no inherited frame and
      // the merchant generates one as before) — it does not break, mis-bill, or lie. The
      // warning below prints the key NAMES the receipt actually carried (names only — a
      // value would be a signed URL), so the first production clip settles the question
      // instead of another round of guessing.
      if (opts.returnLastFrame) {
        const tailUrl = t.content?.last_frame_url;
        if (!tailUrl) {
          console.warn("generation provider returned no last frame for a clip that asked for one:", {
            contentKeys: Object.keys(t.content ?? {}),
          });
        } else {
          // BOUNDED, and by an abort rather than a bare race: aborting the request also
          // errors its body stream, so the budget covers `arrayBuffer()` (a body that stops
          // mid-transfer) and not just a connect that never answers.
          const ctl = new AbortController();
          const stop = setTimeout(() => ctl.abort(), LAST_FRAME_FETCH_TIMEOUT_MS);
          try {
            const r = await fetch(tailUrl, { signal: ctl.signal });
            if (r.ok) video.lastFrame = { bytes: new Uint8Array(await r.arrayBuffer()), ext: extFromUrl(tailUrl) ?? "png" };
            else console.warn(`generation provider last-frame download failed (${r.status}); clip delivered without it`);
          } catch (e) {
            // NAME ONLY — never the message. `tailUrl` is a signed URL carrying a live
            // X-Amz-Signature, and Node hands the input straight back to you inside the
            // failure text: a malformed URL rejects with a TypeError whose message quotes
            // the whole thing, signature and all. Printing it would put a working download
            // credential for merchant media into the worker log. The class name is all this
            // branch can act on anyway — the outcome is identical either way (no automatic
            // continuation this time), and the open question about #782 (what the engine
            // actually calls the key) is answered by the names-only warning above, not here.
            console.warn(`generation provider last-frame download failed (${e instanceof Error ? e.name : typeof e}); clip delivered without it`);
          } finally {
            clearTimeout(stop);
          }
        }
      }
      return { status: "succeeded", video };
    }
    // #661 — the three terminal statuses in which the ENGINE ITSELF reports that no video was
    // produced. Official pricing page (docs.byteplus.com/en/docs/ModelArk/1544106, last updated
    // 2026-08-01): "You are only charged for successfully generated videos. No fee is charged if
    // generation fails due to reasons such as content moderation." So nothing was billed here.
    //   `expired`   = terminated at execution_expires_after before producing anything.
    //   `failed`    = the engine ran and rejected/aborted it (content moderation, bad input…).
    //   `cancelled` = cancelled while still queued (spelled both ways by the API).
    // `{status:"failed"}` (never charged) ⇒ the caller keeps its existing retry policy and
    // resubmits a fresh task. That is safe and intended: officially nothing was billed, so a
    // retry cannot double-charge COGS.
    //
    // BOUNDARY (#657, deliberately untouched): every "outcome unknown" path is a charged failure
    // (the download failure and a succeeded task with no result URL, above) or — for a status
    // that is neither "succeeded" nor one of these three known-free terminals, INCLUDING a status
    // string this adapter has never seen — `pending`: the probe (docs/audits/
    // zero-queue-probe-2026-09-13/README.md §1③) confirms the official docs' status enum is
    // known-incomplete (it omits `expired`, which this file already defended against before that
    // probe ran), so an unrecognized string is never assumed to mean "done" OR "safely retryable
    // now" — it is deferred, and the CALLER's submission-anchored abandon deadline
    // (VIDEO_SUBMISSION_ABANDON_MS) is what eventually turns a truly-stuck "pending" into a
    // charged failure, never a silent assumption made from the string alone.
    if (t.status === "expired" || t.status === "failed" || t.status === "cancelled" || t.status === "canceled") {
      return { status: "failed", reason: t.status };
    }
    return { status: "pending" };
  }
}
