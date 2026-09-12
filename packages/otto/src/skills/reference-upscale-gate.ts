/**
 * FSE-001/FSE-204 —— 付费前的参考图尺寸闸(唯一一份判定)。
 *
 * 这一份从 `executePropose` 里搬出来,一个字未改;搬的理由是它有**第二个入口**:
 * `executeProposePack` 用同一个 `buildProposeCard`、同一份 ctx 铸同样的付费卡,却整条
 * 绕过了这道闸(判官第 3 轮实证)。闸留在某一个 skill 的函数体里,下一个入口照样漏。
 *
 * 契约:**在任何 GEN_CARD 落库之前**调用。
 * - 回 `{ error }` ⇒ 这一张撑不起这次引用,花钱前把话说出来(零卡、零 GenJob、账本零新增行);
 * - 回 `{ payload }` ⇒ 照铸,payload 上可能多了一格 `referenceUpscaleNote`(规格 §5 :176④)。
 *
 * ── FSE-204(staging 第二轮走查,规格 §5 2026-09-11 行;S5 批量裁决 2026-09-12,#1358)───
 *
 * 根因:这道闸从前只挂在「视频卡 × `referenceGenerationIds`」这一条路上 ——「图生图 base」
 * 与「视频起始帧」两个入口(都走 `sourceGenerationId`,两种 kind 共用同一格)、以及图片侧
 * 自己的额外挂图(CRE-STG-P1-003 的 `referenceGenerationIds`)**从未进过闸**:商家批准后
 * 真扣了钱,或者预扣后干等供应商三分钟才退款,而卡上从头到尾没有一个字提过尺寸。是「闸只挂
 * 了一条路」,不是「闸写错了」。
 *
 * 修法(单一源头,修根不修表):把判定拆成下面 `referenceImageSizeVerdict` 一个函数,按
 * `upscaleEligible` 分两档候选调用:
 *   · **可放大档**(视频卡的商品参考图,`referenceGenerationIds`,worker 的
 *     `upscaledProductReferenceDataUrl` 真的会放大它)—— 短边 [100,300) 放行 + 披露,
 *     <100 或带演员血统才拒;
 *   · **硬闸档**(`sourceGenerationId` 的图生图 base / 视频起始帧,以及图片卡自己的额外
 *     挂图)—— worker 对这几个角色从不放大(`gen.ts` 直接 presign 原件),所以短边 < 300
 *     一律拒,不分岔:一张 150×100 的编辑底图今天不会被放大成 300×200,放行只会把它原样
 *     送到供应商、白等一轮建任务失败。
 *
 * 两个调用方共用这一份判定,不各自查库、不各自写第二套 where:
 *   · `applyReferenceUpscaleGate`(下面,铸卡侧,$0 提前拒绝 + 放大披露句 —— 画布确认卡
 *     经 `executePropose`/`executeProposePack` 落在这里);
 *   · `gen-actions.ts` 的 `startGen`(付费前终审 —— 画布确认卡、Library 动作
 *     [`startAssetGen`]、Otto 主动与分镜挂图[`startCoworkGen`] **全部**在建单与预扣之前
 *     走到这同一次调用;`startGen` 是这四条路共同的建单+预扣权威,新增入口只要走
 *     `startGen` 就自动受它保护,不必逐个入口记得接线)。
 */
import {
  // FSE-001/FSE-204 —— 付费前的参考图尺寸闸:判据、租户 scope 与措辞各只有一处。
  generationReferenceScope,
  lineageCarriesOfficialActor,
  referenceUpscalePlan,
  minimumUsableReferenceSide,
  tooSmallReferenceSentence,
  REFERENCE_IMAGE_EXTS,
} from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { withReferenceUpscaleNote, type CardPayload } from "./propose.helpers.js";

function uniqueIds(ids: readonly (string | null | undefined)[]): string[] {
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/**
 * 逐一跑同一套判据,命中就拒绝并说出**这一张**的实际短边;否则数出能放大的张数
 * (硬闸档永远数不出放大 —— 它压根不会走到「放大」那一支)。
 *
 * `upscaleEligible=false` 时,`plan.action` 是 `"upscale"` 或 `"refuse"` 都一律拒绝、
 * 门槛写死 300(`minimumUsableReferenceSide(false)`)—— 这一档 worker 从不放大,放行
 * 一张 [100,300) 的图等于替商家送一张我们知道会被供应商弹回的图。
 */
async function referenceImageSizeVerdict(
  candidateIds: readonly (string | null | undefined)[],
  ownerId: string,
  upscaleEligible: boolean,
): Promise<{ error: string } | { upscaleCount: number }> {
  const ids = uniqueIds(candidateIds);
  if (ids.length === 0) return { upscaleCount: 0 };

  const rows = await prisma.generation.findMany({
    where: {
      id: { in: ids },
      ...generationReferenceScope(ownerId, REFERENCE_IMAGE_EXTS),
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
    // 完整性铁律),所以对它成立的门槛永远是供应商那道 300;硬闸档同理(worker 不会替它
    // 动像素);其余可放大档的商品照我们会补到 300,所以对它成立的门槛是 100。分岔挂在
    // 「能不能放大」上,不挂在 `plan.action` 上 —— 挂错了会在「不能放大 ∩ 短边<100」这一格
    // 说出 100 这个对他不成立的数,他换一张 150px 的同族图回来还是被拒(那时才说 300)。
    // 过松与过严一样是假话,⑥ 要消灭的是两者。
    //
    // `row.asset` 的宽高在这两档里一定读得出来 —— 读不出来的那一档是上面的 `unknown`,
    // 已经先走掉了。
    const canUpscale = upscaleEligible && !lineageCarriesOfficialActor(row.entitySnapshot);
    if (plan.action === "refuse" || !canUpscale) {
      return {
        error: tooSmallReferenceSentence({
          width: row.asset.width as number,
          height: row.asset.height as number,
          minSide: minimumUsableReferenceSide(canUpscale),
        }),
      };
    }
    upscaleCount++;
  }
  return { upscaleCount };
}

/**
 * FSE-204 —— 四个入口(画布确认卡、Library 动作、Otto 主动、分镜挂图)共用的**唯一**
 * 付费前终审。见文件头「修法」——`hardFloorIds` 与 `upscaleEligibleIds` 分别对应两条
 * 分岔,调用方按自己手上的字段分好类,这里不重新猜哪个字段该进哪一档。
 */
export async function assertPrePaymentReferenceSizeGate(args: {
  /** 租户身份只来自服务端 ctx / 服务端会话,永远不从模型或浏览器的入参收。 */
  ownerId: string;
  /** worker 真的会放大的那一批(今天只有视频卡的商品参考图)。 */
  upscaleEligibleIds: readonly (string | null | undefined)[];
  /** worker 从不放大、供应商硬闸原样生效的那一批(图生图 base / 视频起始帧 / 图片卡额外挂图)。 */
  hardFloorIds: readonly (string | null | undefined)[];
}): Promise<{ error: string } | { upscaleCount: number }> {
  const hard = await referenceImageSizeVerdict(args.hardFloorIds, args.ownerId, false);
  if ("error" in hard) return hard;
  const soft = await referenceImageSizeVerdict(args.upscaleEligibleIds, args.ownerId, true);
  if ("error" in soft) return soft;
  return { upscaleCount: soft.upscaleCount };
}

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
  // FSE-204 —— 候选集不再只挑「视频卡 × referenceGenerationIds」这一条路:`sourceGenerationId`
  // 两种 kind 共用(图生图 base / 视频起始帧),图片卡自己的额外挂图也走 `referenceGenerationIds`
  // (CRE-STG-P1-003)。四个入口铸卡时都在算这几个字段,漏查其中一个就是漏一条路(见文件头)。
  //
  // 只查商家挂的那几张图:演员的参考照走 Entity 的 `referenceImages`,由播种脚本保证
  // 尺寸(一律 Seedream 原件),根本不经这条挂图的路。
  const verdict = await assertPrePaymentReferenceSizeGate({
    ownerId: orgId,
    upscaleEligibleIds: payload.kind === "video" ? (payload.referenceGenerationIds ?? []) : [],
    hardFloorIds: [
      payload.sourceGenerationId,
      ...(payload.kind === "image" ? (payload.referenceGenerationIds ?? []) : []),
    ],
  });
  if ("error" in verdict) return verdict;
  // 披露句走卡面自己那一格(`referenceUpscaleNote`,规格 §5 :176④),不再借名额截图的
  // `downgradeNote`。数字不在这里编:它就是上面这一趟数出来的张数,而 worker 读的是同一个
  // `referenceUpscalePlan` + 同一对元数据,所以「卡上说放大了 N 张」与「worker 真放大了
  // N 张」仍然只有一份口径。硬闸档从不计入这个数(它从不会被放大),`withReferenceUpscaleNote`
  // 对 0 张原样放行(不加这一格)。
  //
  // 说不出来的那一档(`unknown`)两边一起沉默。规格 §5 :162① 落地之后,本站生成的**图片**
  // 不再落在这一档:`apps/worker/src/jobs/gen.ts` 出图处读文件头量真字节写
  // `Asset.width/height`(与 ingest 的 ffprobe 数字逐张对住),所以本站生成的小图从此在
  // 花钱之前就被认出来。剩下的两档已登记:①上传图 ingest 还没量完就被引用;
  // ②末帧资产(`storeLastFrameBestEffort`)未量——它是 ≥720p 的视频静帧,永远够大,不在这道闸里查。
  return { payload: withReferenceUpscaleNote(payload, verdict.upscaleCount) };
}
