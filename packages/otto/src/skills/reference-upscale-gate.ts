/**
 * FSE-001 —— 付费前的参考图尺寸闸(唯一一份)。
 *
 * 这一份从 `executePropose` 里搬出来,一个字未改;搬的理由是它有**第二个入口**:
 * `executeProposePack` 用同一个 `buildProposeCard`、同一份 ctx 铸同样的付费卡,却整条
 * 绕过了这道闸(判官第 3 轮实证)。闸留在某一个 skill 的函数体里,下一个入口照样漏。
 *
 * 契约:**在任何 GEN_CARD 落库之前**调用。
 * - 回 `{ error }` ⇒ 这一张撑不起这次引用,花钱前把话说出来(零卡、零 GenJob、账本零新增行);
 * - 回 `{ payload }` ⇒ 照铸,payload 上可能多了一格 `referenceUpscaleNote`(规格 §5 :176④)。
 */
import {
  // FSE-001 —— 付费前的参考图尺寸闸:判据、租户 scope 与措辞各只有一处。
  generationReferenceScope,
  lineageCarriesOfficialActor,
  referenceUpscalePlan,
  minimumUsableReferenceSide,
  tooSmallReferenceSentence,
  REFERENCE_IMAGE_EXTS,
} from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { withReferenceUpscaleNote, type CardPayload } from "./propose.helpers.js";

export async function applyReferenceUpscaleGate(
  payload: CardPayload,
  /** 租户身份只来自服务端 ctx(`ctx.orgId`),永远不从模型的入参收。 */
  orgId: string,
): Promise<{ payload: CardPayload } | { error: string }> {
  // FSE-001 —— **付费前的尺寸闸 + 自动放大计划**(staging 探针 2026-09-08 / 09-09 实测)。
  //
  // 视频端在**建任务之前**就查参考图尺寸,闸是**宽与高各 ≥300px**(第三场探针逐字回执:
  // `expected the height to be at least 300px, but received a 300x200px image instead`)。
  // 那道闸在供应商那边不花钱,但它落在我们**预扣之后** —— 商家会先看到一张报了价的卡、
  // 按下 Generate、预扣、失败、退款,读到的只是一句「没成功」,而真正能修好它的动作一个字
  // 都没说。所以查在这里:`buildProposeCard` 已经回来了,但 GEN_CARD 还一行没落库、预扣
  // 还没发生 ⇒ 拒绝 = $0、零 GEN_CARD、零 GenJob、账本零新增行。
  //
  // 上一版只查宽度,那是个真漏洞:一张 400×200 的图过我们的闸、到供应商才被弹,而那时钱
  // 已经预扣。判据现在是短边(`referenceUpscalePlan`,core 里唯一一份,worker 读同一个)。
  //
  // ── 自动放大(Founder 2026-09-09 裁决)──────────────────────────────────────────
  // 短边落在 [100, 300) 时不再拒绝:worker 在提交供应商前按整数倍 lanczos 放大到刚好过门,
  // 产物只用于那一次请求。裁决的边界是「**仅限无人像的商品照**,演员图与任何含人像的图一律
  // 不动」——机器可查的那一半是**演员血统**(`lineageCarriesOfficialActor`):带演员血统的
  // 图做像素再处理会被视频端当真人拒收(规格 §5「像素完整性铁律」,2026-08-30 裁剪实证),
  // 所以那一档仍旧诚实拒绝,不放大。
  //
  // 只查商家挂的那几张商品图:演员的参考照走 Entity 的 `referenceImages`,由播种脚本保证
  // 尺寸(一律 Seedream 原件),根本不经这条挂图的路。
  const videoReferenceIds = payload.kind === "video" ? (payload.referenceGenerationIds ?? []) : [];
  if (videoReferenceIds.length === 0) return { payload };

  const rows = await prisma.generation.findMany({
    where: {
      id: { in: videoReferenceIds },
      ...generationReferenceScope(orgId, REFERENCE_IMAGE_EXTS),
    },
    select: { asset: { select: { width: true, height: true } }, entitySnapshot: true },
  });
  let upscaleCount = 0;
  for (const row of rows) {
    const plan = referenceUpscalePlan(row.asset);
    if (plan.action === "asIs" || plan.action === "unknown") continue; // 与这条修改之前逐字相同
    // 规格 §5 :176⑥ —— 拒绝那一句说**这一张**图有多大、以及**这一张**图要多大。
    //
    // 门槛只有一条分岔:**我们能不能替这一张动像素**。带官方演员血统的图一格不动(像素
    // 完整性铁律),所以对它成立的门槛永远是供应商那道 300;其余的商品照我们会补到 300,
    // 所以对它成立的门槛是 100。分岔挂在血统上,不挂在 `plan.action` 上 —— 挂错了会在
    // 「血统 ∩ 短边<100」这一格说出 100 这个对他不成立的数,他换一张 150px 的同族图回来
    // 还是被拒(那时才说 300)。过松与过严一样是假话,⑥ 要消灭的是两者。
    //
    // `row.asset` 的宽高在这两档里一定读得出来 —— 读不出来的那一档是上面的 `unknown`,
    // 已经先走掉了。
    const canUpscale = !lineageCarriesOfficialActor(row.entitySnapshot);
    const refuse = () => ({
      error: tooSmallReferenceSentence({
        width: row.asset.width as number,
        height: row.asset.height as number,
        minSide: minimumUsableReferenceSide(canUpscale),
      }),
    });
    // 短边 < 100:放大到过门要 4× 以上,而我们只在 2×／3× 两格有实证 —— 诚实拒绝。
    if (plan.action === "refuse") return refuse();
    // 带演员血统 ⇒ 一格不动像素 ⇒ 它撑不起这一次引用,花钱前说出来。
    if (!canUpscale) return refuse();
    upscaleCount++;
  }
  // 披露句走卡面自己那一格(`referenceUpscaleNote`,规格 §5 :176④),不再借名额截图的
  // `downgradeNote`。数字不在这里编:它就是上面这一趟数出来的张数,而 worker 读的是同一个
  // `referenceUpscalePlan` + 同一对元数据,所以「卡上说放大了 N 张」与「worker 真放大了
  // N 张」仍然只有一份口径。
  //
  // 说不出来的那一档(`unknown`)两边一起沉默。规格 §5 :162① 落地之后,本站生成的**图片**
  // 不再落在这一档:`apps/worker/src/jobs/gen.ts` 出图处读文件头量真字节写
  // `Asset.width/height`(与 ingest 的 ffprobe 数字逐张对住),所以本站生成的小图从此在
  // 花钱之前就被认出来。剩下的两档已登记:①上传图 ingest 还没量完就被拿去生成;
  // ②末帧资产(`storeLastFrameBestEffort`)未量——它是 ≥720p 的视频静帧,永远够大。
  // 两档都与今天逐字相同。
  return { payload: withReferenceUpscaleNote(payload, upscaleCount) };
}
