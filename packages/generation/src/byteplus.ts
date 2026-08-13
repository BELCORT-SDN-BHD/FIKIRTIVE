import type { GenerationProvider, GenerationRequest, GeneratedImage, VideoRequest, GeneratedVideo, GenerationReceipt } from "@fikirtive/core";
import {
  imageOutputSize,
  MAX_VIDEO_IMAGE_PARTS,
  REFERENCE_IMAGE_PERSON_REJECTED,
  referenceImagePersonRejected,
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
export const IMAGE_MODEL_MAP: Record<string, string> = { seedream: "seedream-5-0-260128" };
/** #769(Founder 已裁 2026-08-08):战役视频引擎从 2.0 Fast 换 2.0 mini。
 *  版本化 id 取自 ModelArk 模型档案(只读核实):`arkcli models get dreamina-seedance-2-0-mini`
 *  → `id` / `primary_version` = `dreamina-seedance-2-0-mini-260615`;
 *  `arkcli models versions dreamina-seedance-2-0-mini` 只回这一个版本 260615。 */
export const VIDEO_MODEL_MAP: Record<string, string> = { "seedance-2-mini": "dreamina-seedance-2-0-mini-260615" };

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
 * TWO SIZES, because two different things are being waited for:
 *   · CONTROL (submit, poll) — a request the engine answers from its own queue state. 60s is
 *     already ~20× the measured p99; past it the connection is not slow, it is gone.
 *   · TRANSFER (image/video download) — bytes over the wire from object storage. A 15-minute
 *     720p clip is tens of megabytes, so this one has to tolerate a genuinely slow pipe; 5 min
 *     is generous for that and still far inside the worker's own 20-minute message expiry.
 *
 * WHAT A TIMEOUT COSTS. Aborting is a network failure, so it lands on the SAME classification
 * the charge boundary already applies to "no response at all": outcome unknown ⇒ treated as
 * billed (a plain retry would POST a second time and pay twice). Timing out therefore never
 * loosens the money rule — it only stops the seat being held.
 */
export const ARK_CONTROL_TIMEOUT_MS = 60_000;
export const ARK_DOWNLOAD_TIMEOUT_MS = 5 * 60_000;

/**
 * How long this client keeps polling one video task before it gives up (F06 — the full
 * reasoning lives at the poll loop below; do not change this number without reading it).
 *
 * Exported because it is the FIRST clock in the worker's chain: provider timeout <
 * stale cutoff < queue expiry < reaper cutoff. apps/worker/src/jobs/clock-invariants.test.ts
 * asserts that ordering against this exact constant, so the chain can no longer be broken by
 * editing one end of it (#796).
 */
export const VIDEO_POLL_TIMEOUT_MS = 15 * 60_000;

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
  private async paidPost(what: "image request" | "video submit", url: string, model: string, body: unknown): Promise<Response> {
    const res = await fetch(url, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(body),
      // #795 — a submit that never answers holds the only generation seat open. An abort
      // surfaces here as a rejected fetch, which is already the "outcome unknown ⇒ billed"
      // branch below: the deadline changes how long we wait, never who pays.
      signal: AbortSignal.timeout(ARK_CONTROL_TIMEOUT_MS),
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
      if (what === "video submit" && referenceImagePersonRejected(detail)) {
        throw permanentInputError(REFERENCE_IMAGE_PERSON_REJECTED);
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
    // The WxH form is bound by the engine to total pixels ∈ [3,686,400, 16,777,216] and
    // ratio ∈ [1/16, 16]; every entry in the shared GEN_IMAGE_SIZES table satisfies both
    // (asserted per-entry in packages/core/src/gen.test.ts). An absent/unknown shape falls
    // back to the default square — never send a value the engine would reject. Price is
    // unaffected: this engine bills per image, not per size.
    const { width, height } = imageOutputSize(req.aspectRatio);
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
   * #796 判官 r1 P1-1 — a video task holds ONE account slot for its WHOLE life (submit through
   * the last poll), not just for the submit. The account's video ceiling is about tasks the
   * engine is running, and a task stays running until it succeeds or is terminated. Choosing
   * the conservative reading costs us a little unused headroom; the other reading costs 429s,
   * which the merchant reads as a failed generation.
   *
   * The gate is taken HERE and never again inside — `#videoTask` must not re-enter it (a
   * second acquire on the same call chain is how a semaphore deadlocks itself).
   */
  async generateVideo(req: VideoRequest): Promise<GeneratedVideo> {
    return providerRequestGate().run(() => this.#videoTask(req));
  }

  async #videoTask(req: VideoRequest): Promise<GeneratedVideo> {
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
    const sub = await this.paidPost("video submit", `${ARK_BASE}/contents/generations/tasks`, model, {
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
      // F40 (same rule as the image path): paying merchants must not receive watermarked
      // output. Video defaults to false today; declare it so a default drift can't undo that.
      watermark: false,
      // F06 reconciliation window, below. 3600s is the engine's minimum.
      execution_expires_after: 3600,
    });
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
    // task created ⇒ billed on success. Poll inside the provider (the worker just awaits).
    const startedAt = Date.now();
    // F06 — the reconciliation window, and why it is the size it is.
    //
    // Two clocks run on one task. OURS: this client gives up after 15 min, because the worker's
    // own message expires at GEN_QUEUE_POLICY.expireInSeconds (20 min) and we need the remaining
    // minutes to download and persist. THE ENGINE'S: it keeps working on an abandoned task and
    // bills it when it completes. Whatever falls between the two clocks is the ambiguous window:
    // we told the merchant "failed" (and refunded) while the engine still charged us.
    //
    // 15 min is well past realistic latency, so abandoning is already rare — and when it does
    // happen, giving up EARLIER would be worse (a still-running task refunded mid-flight is a
    // guaranteed margin leak, not a possible one). So the client side stays 15 min and keeps its
    // charged semantics: an abandoned task is treated as billed.
    //
    // What #646 T5 fixes is the OTHER end. The engine's own limit defaulted to 48h, so the window
    // was [15 min, 48h]. `execution_expires_after: 3600` (the minimum it accepts) shrinks it to
    // [15 min, 1h]: past one hour the engine terminates the task itself as `expired` — no output,
    // nothing billed — so an abandoned task can no longer quietly complete a day later.
    const TIMEOUT_MS = VIDEO_POLL_TIMEOUT_MS;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((r) => setTimeout(r, 5_000));
      let t: { status?: string; content?: { video_url?: string } };
      try {
        // #795 — a poll that hangs stops the 15-minute clock below from ever being consulted:
        // the loop is parked inside `await fetch`, so neither the timeout check nor the worker's
        // own message expiry can reach it. With a deadline the abort lands in the catch, which
        // treats it as a transient poll failure and polls again — until TIMEOUT_MS decides.
        const st = await fetch(`${ARK_BASE}/contents/generations/tasks/${taskId}`, {
          headers: this.headers(),
          signal: AbortSignal.timeout(ARK_CONTROL_TIMEOUT_MS),
        });
        if (!st.ok) {
          // Non-2xx: if timed out, surface as chargedError (task may still complete on BytePlus = COGS already committed)
          if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError(`generation provider video poll returned ${st.status} after timeout`);
          continue; // transient non-2xx — retry
        }
        t = (await st.json()) as { status?: string; content?: { video_url?: string }; usage?: unknown; revised_prompt?: unknown };
      } catch (e) {
        // A chargedError thrown above must propagate (terminal); any other exception (network reset,
        // malformed body) is a transient poll failure — the task was already submitted and may still
        // succeed (and bill) on BytePlus, so re-submitting would double the COGS. Continue polling.
        if (e instanceof Error && (e as { charged?: boolean }).charged) throw e;
        if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError("generation provider video polling failed after timeout");
        continue; // transient — poll again
      }
      if (t.status === "succeeded") {
        // The clip exists and IS billed. Every way of failing to get it into our hands past this
        // line is a charged failure — including the ones that never produce a status code:
        // a download whose connection drops (`fetch` rejecting), a body that stops mid-stream
        // (`arrayBuffer()` throwing). PLAIN here would requeue and generate a SECOND paid clip.
        const url = t.content?.video_url;
        if (!url) throw chargedError("generation provider video response had no result URL");
        // #776:回执来自这条**成功任务**自己的响应(计费量与它真正跑的提示词都在这一份里),
        // 读在下载之前 —— 拿不拿得到字节与引擎报了什么无关。readVideoReceipt 永不抛,所以这
        // 一行不会把一条已经做出来、已经计费的片子推进 charged 分支。
        const receipt = readVideoReceipt(t);
        try {
          // #795 — same deadline as the image download, same landing: the clip IS billed, so an
          // abort is a charged failure, never a plain retry that would generate a second one.
          const r = await fetch(url, { signal: AbortSignal.timeout(ARK_DOWNLOAD_TIMEOUT_MS) });
          if (!r.ok) throw chargedError(`generation provider video download failed (${r.status})`);
          return {
            bytes: new Uint8Array(await r.arrayBuffer()),
            ext: extFromUrl(url) ?? "mp4",
            ...(receipt ? { receipt } : {}),
          };
        } catch (e) {
          if (e instanceof Error && (e as { charged?: boolean }).charged) throw e; // already marked
          throw chargedError(`generation provider video download failed (${e instanceof Error ? e.message : String(e)})`);
        }
      }
      // #661 — the three terminal statuses in which the ENGINE ITSELF reports that no video was
      // produced. Official pricing page (docs.byteplus.com/en/docs/ModelArk/1544106, last updated
      // 2026-08-01): "You are only charged for successfully generated videos. No fee is charged if
      // generation fails due to reasons such as content moderation." So nothing was billed here.
      //   `expired`   = terminated at execution_expires_after before producing anything.
      //   `failed`    = the engine ran and rejected/aborted it (content moderation, bad input…).
      //   `cancelled` = cancelled while still queued (spelled both ways by the API).
      // PLAIN (no `charged` marker) ⇒ the worker keeps its existing retry policy and requeues.
      // That is safe and intended: officially nothing was billed, so a retry cannot double-charge
      // COGS. A moderation failure will very likely fail again — what that burns is retry
      // attempts, not money — and the final terminal FAIL refunds the merchant while recording
      // NO spend, which is the whole point of this ticket (no phantom COGS in the spend audit).
      //
      // BOUNDARY (#657, deliberately untouched): every "outcome unknown" path stays chargedError —
      // the three abandon-timeouts, the download failure, a succeeded task with no result URL.
      // Not knowing whether the engine produced a clip is not the same as the engine telling us it
      // didn't; only an explicit no-output terminal status may go PLAIN.
      if (t.status === "expired") throw new Error("generation provider video task expired");
      if (t.status === "failed" || t.status === "cancelled" || t.status === "canceled")
        throw new Error(`generation provider video task ${t.status}`);
      if (Date.now() - startedAt > TIMEOUT_MS) throw chargedError("generation provider video timed out");
    }
  }
}
