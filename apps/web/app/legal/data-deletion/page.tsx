import Link from "next/link";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/exits";

export const metadata = { title: "Data deletion · Fikirtive" };

/** Meta data-deletion 状态页:回调 (app/api/meta/data-deletion/route.ts) 返回的
 *  { url, confirmation_code } 里的 url 指到这里并带上 ?code=<confirmation_code>,
 *  所以码随链接进来 —— 页面只需读 searchParams 并陈述状态,无需输入框、无需按码
 *  查库(Meta 的回调规范只要求「链接 + 确认码」合起来给出人类可读的状态说明)。
 *
 *  真实性约束(2026-07-31 r4 修正):本注释原写「码总是在删除事务成功之后发出,所以持有码
 *  ≈ 那次请求已处理完毕」—— **不成立**,有两个例外,文案不得再依赖这条:
 *   ① 零匹配时根本没有删除事务,route.ts:65-72 走的是 best-effort 痕迹(失败被 catch 吞掉),
 *     :74-78 照样返回码;
 *   ② 本页对 URL 上的 ?code= 不做任何查库或验签(本文件里就一句
 *     `const { code } = await searchParams` —— 故意不写行号:自引用行号会被本注释自身的
 *     增删推移,r4 初稿写的 :180 当场就漂成了 :215),所以 ?code=made-up 也会渲染同一段文案。
 *  因此正文改为「不认领、不背书」:把回执的主语还给 Meta 的确认流程,页面只承认自己在
 *  显示链接里带来的字符串。
 *  免登录(proxy.ts 放行 /legal)。
 *  「决定清单」= https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/486#issuecomment-5106492327
 *  (持久决定清单以该 PR 评论为准,本注释所有清单引用均指它)。
 *
 *  2026-07-28 真实性核验轮(记录见决定清单)后的唯一修订:B3 —— 备份那句不再把
 *  30 天写成删除上限。「30 天」这个数字**只依据代码常数**,已就地重核:
 *  apps/worker/src/db-backup.ts:39 `RETENTION_DAYS = 30`、:83 按 key 日期算 cutoff、
 *  :148 过期对象即删(2026-07-28 第四轮就地重核:本注释上一版写 :147,那是 `selectExpiredBackups`
 *  那一行;真正的 `deleteObject` 循环在 :148 —— 行号引用正是最容易过期的一类事实)。数据库供应商的时点恢复窗口是另一个窗口,天数由 Founder 在供应商控制台设定
 *  (docs/runbooks/db-backup.md「两个恢复窗口」一节自己写着「需 founder 确认/设置」),
 *  对本会话为 UNKNOWN,因此只说「a period」→ 决定清单。
 *  文档漂移提示(2026-07-28 第三轮核出,不在本批修复范围):该 runbook 的表格把
 *  `RETENTION_DAYS` 标为 `db-backup.ts:35`,实际在 :39 —— 本页文案不依赖那条引用,
 *  以代码为准;runbook 的修正见决定清单。
 *  本轮不加查码表单、不加数据库访问(Meta 只要求人类可读的状态说明)。
 *
 *  2026-07-28 第三轮(写入点规则):本页逐句过尺,无未支撑主张。删除机制
 *  route.ts:38-39 验签、:47-50 按 metaUserId 查、:54 删连接行、:75-77 才随 200 发码;
 *  整账户删除的按钮只打开邮件(components/otto/OttoAccount.tsx:51,标题
 *  "Request account deletion" :40)。
 *
 *  2026-07-28 第五轮(跨族复审返工):
 *   P0-2 删除/保留如实化:route.ts 只删 MetaConnection(连接+加密 token)并写一条
 *        ActionEvent("meta.data_deletion",含确认码);发布历史(ScheduledPost 的
 *        metaTargetId/metaPostId、PublishAttempt 的帖子/素材标识)与操作审计记录
 *        (ActionEvent,含删除请求本身)保留 —— 页面两个分支都平实写明,不辩解、不承诺将来。
 *        保留范围的例外分类待 Founder/法务批准;#489 收口后本页需复查。
 *   P1-8 本页对任意非空 code 都渲染同一段文案(不查库),因此措辞不再自称验证入口或
 *        宣告「complete」状态:如实说明本页介绍删除流程,确认码是收到请求的回执
 *        (路由行为改动归 #489,不在本页范围)。
 *   P1-3 整账户删除段收敛为「联系我们提出请求」,不承诺时限与流程。
 *   P1-4 快照句改滚动清理措辞(db-backup.ts 筛选 :147、删除 :148,清理调用 :173;
 *        上一版误引 :171,那行只是上传)。
 *   P1-6 「because they are yours and are not held on Meta's behalf」归属断言删去,只述行为。
 *   P2-1 Privacy policy 链接文字 sentence case。
 *
 *  2026-07-28 第六轮(三轮返工):注释引用可核验化 —— 指向仓库外/不存在文件的引用
 *  统一改为上方决定清单 URL;本页正文无改动。
 *
 *  2026-07-31 #563(Meta App Publish 的 Data deletion URL 前置):本页就是回填给 Meta 的
 *  那个 URL —— app/api/meta/data-deletion/route.ts:76 返回的 `${origin}/legal/data-deletion`,
 *  免登录靠 proxy.ts:77 matcher 的 `legal` 前缀(本轮未改 matcher,一个字符都没加)。
 *  (r1 写成 :73 —— 那是 #543 合并前的行号,#543 在 matcher 上方加了 4 行注释;r2 就地重核改正。)
 *  新增「What you can delete yourself」一节,补上此前整页缺失的自助路径。逐条只写代码里
 *  真有的能力,就地核验:
 *   · 删 campaign —— lib/actions.ts:179 `deleteProject`,事务内 :232-244 依次删 canvasNode /
 *     renderJob / captionJob / scheduledPost / generationBatch / genJob / generation /
 *     shotEntityRef / shot / 本项目的 actionEvent / project 本体;:213-223 删本项目的
 *     researchJob·chatMessage·chatThread;删完 :245 起补写一条 projectId:null 的
 *     ActionEvent(所以「保留一条删除记录」是实的)。UI:components/otto/OttoApp.tsx:426,
 *     确认框 :760 起(逐字抄它的 impacts,含「Global library assets and credit ledger rows
 *     are not deleted here」)。另:campaign 的删除会被在跑的任务拒绝而非删一半 ——
 *     actions.ts:195(genJob)/ :220(researchJob)抛错、:257-265 转成人话回执,campaign 那条
 *     bullet 里「refused until it finishes」即指此。⚠️ 这条**只对 campaign 成立**,
 *     conversation 不同 —— 详见下方 r2 的 P0-2。
 *   · 删 conversation —— lib/otto-actions.ts:1982 `deleteCoworkThread`,:2006-2011 删
 *     researchJob·chatMessage·chatThread,而 canvasNode/generation/genJob 是 threadId 置 null
 *     (:2007-2009)—— 所以写「detached rather than deleted」。UI:OttoApp.tsx:522,
 *     确认框 :793 起。
 *   · 删 library asset —— lib/actions.ts:813 `deleteGeneration`,:823 只写 deletedAt(软删)。
 *     storage.deleteObject 的调用点是 lib/upload-actions.ts:170(上传失败清理)与
 *     apps/worker/src/jobs/ingest.ts:120(ingest 清理),删素材两条都不走 —— 所以
 *     「stored file 尚未被自动清理」照 privacy/page.tsx:362 的既有口径写。
 *     (r1 把它写成「全仓唯一调用点」,漏了 worker 那处;结论不变,但绝对断言错了,r2 改正。)
 *     UI:Library(components/otto/OttoStuff.tsx mode="library" :246,详情面板 :342)→ 打开素材 →
 *     Delete 按钮 components/asset/DetailPanel.tsx:750 → 确认框 :407-413(:409 title、
 *     :411 confirmLabel、整段无 confirmText)→ handleDelete :365。
 *     ⚠️ r2 P0 修正:删素材**不会**把画布上的卡片清掉。deleteGeneration 只软删 Generation,
 *     完全不碰 CanvasNode;listCanvasNodes 仍返回该节点(canvas-actions.ts:43),但缩略图查询
 *     getGenerationThumbs 过滤 deletedAt(lib/data.ts:20)取不到 url,于是 canvas-actions.ts:75
 *     把状态判为 "missing",ImageNode.tsx:171 渲染 FailedBody,GeneratingBody.tsx:60 显示
 *     "Preview missing"。r1 写「removes it from your library and canvas views」是失实的,已改。
 *   · 断开 Meta —— lib/meta-actions.ts:103 `disconnectMeta`,:107 删整行 MetaConnection;
 *     该表字段见 prisma/schema.prisma:1122-1142(metaUserId / accessTokenEnc / scope /
 *     defaultPageId 等),故列举到字段一级。UI:components/otto/OttoConnections.tsx:462,
 *     入口名 components/otto/OttoNav.tsx:79「Connections」。保留范围与上方 Meta 回调分支同源
 *     (删的是同一张表的同一行),所以两处措辞刻意一致 —— 但**触及范围不同,页面已写明**:
 *     自助 Disconnect 按 ownerId 删(meta-actions.ts:107),只动当前工作区;Meta 回调按
 *     metaUserId 跨 org 查再逐 org 删(route.ts:46-62),一个 Meta 账号连过几个工作区就删几个,
 *     且每个 org 补写一条 "meta.data_deletion" ActionEvent(:54-60),自助路径没有这条。
 *     初稿把两者写成「the same deletion」,本轮就地核验 route.ts 后改掉 —— 记此以免回退。
 *   · 联系人「不能自助删」—— lib/crm-actions.ts 全文无任何 contact 删除/软删 action(:204·:259·
 *     :280·:313 都只是 `deletedAt: null` 读过滤),与 privacy/page.tsx:353-355 的既有口径一致;
 *     「不替商家决定」呼应 CRM 区 components/crm/contacts-page.tsx:180。
 *   · X 渠道故意没写:lib/channels/x.ts 有 disconnect(:27-32),但 :26 的 connectUrl 指向尚未
 *     落地的 /api/x/authorize(OttoConnections.tsx:37 也这么注),连都连不上,不承诺。
 *  同时修掉一处已过期的导航指路:整账户删除入口不再是「Account →」—— #513 A 组把 Account 从
 *  工具栏撤了(OttoNav.tsx:81-85),现入口是 components/global-navigation.tsx:71 的
 *  「Preferences」→ settings/sections.tsx:242-253 的 Danger zone → Delete account,
 *  按钮仍只开 mailto(OttoAccount.tsx:51),该句不变。(r1 写 :70,是注释行;r2 改正为 :71。)
 *
 *  2026-07-31 r2(跨族判官对 PR #570 判 FAIL 后的返工;判定书在 #570 评论区):
 *  失实全部出在「承诺 vs 真实行为」,逐条就地重核后改文案,一行产品代码未动。
 *   · P0-1 素材删除与画布 —— 见上「⚠️ r2 P0 修正」段。
 *   · P0-2 运行中拒删只对 campaign 成立 —— deleteProject 确实拦 genJob(actions.ts:195 抛、
 *     :257 回执)与 researchJob(:220 抛、:263 回执);但 deleteCoworkThread **只**查
 *     researchJob(otto-actions.ts:2001-2005,回执 :2016),genJob 一律 :2009 解绑 threadId
 *     后照删。r1 把两者合成一句「a generation or a research run … is refused」是错的,
 *     已按 campaign / conversation 分开写。
 *   · P0-3 「every workspace」过度承诺 —— metaUserId 可为 null:debug_token 缺 user_id 时
 *     meta-graph.ts:325-326 返回 null,connectMeta 仍照落库(meta-actions.ts:33)并返回 ok,
 *     schema.prisma:1128 允许空值;而回调只做精确匹配 `where: { metaUserId }`(route.ts:48),
 *     故这类连接永远删不到。措辞收敛为「recorded Meta user ID 匹配的连接」。另:零匹配时
 *     route.ts:65-78 仍返回 confirmation code,两个分支都已写明「码≠连接曾存在」。
 *     ⚠️ 底层产品缺口(允许 metaUserId:null 落库)不在本页范围,已另立 issue #573,本轮只改文案。
 *   · P1-1 「differs only in reach」不成立 —— 回调每 org 另写一条 meta.data_deletion
 *     ActionEvent(route.ts:59),自助 Disconnect 不写(meta-actions.ts:103-108);已去掉 only。
 *   · P1-2 「确认后生效」对 Disconnect 不成立 —— 该按钮无确认框、onClick 直接执行
 *     (OttoConnections.tsx:462);已把它与前三项分开陈述。
 *   · P1-3 补入口路径,均在本 worktree 就地核实(⚠️ r1 有一处行号取自主检出而非本 worktree,
 *     两棵树行号不同 —— 本轮所有引用一律以本 worktree 为准):campaign = 侧栏行上
 *     「Campaign controls」⋯ 按钮(OttoNav.tsx:451)→ 菜单项「Delete project」(:482,
 *     注意菜单仍用旧词 project)→ 输入名字确认(OttoApp.tsx:767);conversation = 侧栏行的
 *     bin 图标 → 输入会话名确认(OttoApp.tsx:800);asset 见上。
 *     (⚠️ r2 在此还写了「标签页 ×」入口,是错的 —— 见下方 r3 第一条。)
 *     确认方式也就地核实过:OttoPromptDialog.tsx:48
 *     `canConfirm = !confirmText || typed.trim() === confirmText`、:102「Type X to continue」
 *     —— 所以 campaign / conversation 是**打字确认**,而 generated asset 只是普通确认框
 *     (DetailPanel.tsx:407-413,无 confirmText),Disconnect 与 entity 删除无确认。
 *   · P2 日期改 31 July;「Two things」改为不绝对的表述(credit ledger / publish history /
 *     audit 同样无自助删除)。
 *   · P3 见上两处行号与 deleteObject 调用点更正。
 *
 *  2026-07-31 r3(判官第二份 FAIL:r2 十条中八条确认已修,两条改错方向,另有新失实):
 *   · 【r2 改错·P1】会话删除的「标签页 ×」入口是假的 —— 组件存在但**永不渲染**:
 *     app/otto/page.tsx:24-25 把 skin 硬编码为 "gb"(注释原文:唯一皮肤、无回滚参数),
 *     而 OttoView.tsx:301 的渲染条件是 `skin !== "gb" && <ConvoTabs …>`。已删掉该入口,
 *     只留侧栏 bin(OttoNav.tsx:292 才是图标本体,r2 引的 :289 是按钮 title)。
 *     ⚠️ 教训写在这:**入口必须核当前渲染路径,组件存在 ≠ 商家看得到**。
 *   · 【r2 改错·P2】「Everything else has no self-service delete」比 r1 的「Two things」
 *     更绝对,且被真实自助删除反证:canvas-actions.ts:277 deleteCanvasNode、
 *     memory-actions.ts:83 deleteMemory、actions.ts:481 softDeleteEntity、
 *     actions.ts:599 softDeleteShot、refgen-actions.ts:388 deleteVariant、
 *     brand-record-actions.ts:113 deleteBrandRecord(:130 还能 restore)。
 *     改为**精确枚举**三项,逐项已核无任何删除路径:contact(crm-actions.ts 无任何删除
 *     action,且 Contact 挂 org 不挂 project,不随 campaign 走)、credit ledger
 *     (schema.prisma:756 CreditLedger,生产自助路径无 delete/deleteMany —— r3 写成
 *     「全 apps/web + apps/worker 无」,字面不准:测试清理代码里有这些调用,r4 收窄口径)、
 *     不属于 campaign 的 actionEvent(唯一删除点是 actions.ts:243,按 projectId 限定)。
 *     ⚠️ 初稿这里写了「四项」,把 publishAttempt 也算进去 —— **是错的**:
 *     schema.prisma:2170 `post ScheduledPost @relation(..., onDelete: Cascade)`,
 *     而 deleteProject 删 scheduledPost(actions.ts:235),所以 publish attempt 会随
 *     campaign 级联删除。第三轮内部自查时逮到并改成三项 + 单写一句 publish history 的真实行为。
 *     ⚠️ 同一处连栽两轮全称量词,故本轮对正文做了 every/only/always/never/nothing 全量筛查;
 *     留下的每个全称词都有代码支撑并带限定语(如「every stored connection **whose recorded
 *     Meta user ID matches**」对应 route.ts:47-51 的 findMany+逐条删)。
 *   · 【新·P1】零匹配时那条审计是 best-effort:route.ts:65-72 的 `.catch(() => {})` 吞掉
 *     失败后照样返回码(匹配到连接时则不同 —— 审计写在 :53-60 的同一事务里,是可靠的)。
 *     故正文由「记录一定保留」降为「normally kept」。
 *   · 【新·P1】确认框范围要限定:Library 同时列 generation 与 entity,entity 的 Delete
 *     (StuffLibrary.tsx:252-262)经 OttoStuff.tsx:182 handleDelete 直接调 softDeleteEntity,
 *     **无确认框**。已把原 bullet 限定为 generated asset,并新增一条「saved reference」
 *     如实写明无确认;其 EntityType 四值见 schema.prisma:22-27(CHARACTER/LOCATION/
 *     PRODUCT/BRANDMARK),且 softDeleteEntity 不删 shotEntityRef(只 count),
 *     所以写「shots 仍留着它的链接直到你去改」。
 *   · 【新·P2】Disconnect 并非无条件即时:meta-actions.ts:106 冒充模式直接返回 error,
 *     而 OttoConnections.tsx:462 忽略返回值(错误被 UI 吞掉)。措辞限定为「for your own login」。
 *   · 【新·P2】整账户删除漏了真实存在的确认步骤:OttoAccount.tsx:47 confirmText={account.email}
 *     —— 要打自己的登录邮箱才能继续,已补进正文。
 *   · 【新·P3】指针更正:DetailPanel 的「无 confirmText」要看 :407-413 整段(:409 只是 title、
 *     :411 是 confirmLabel);零匹配仍返回码的证据范围应从 route.ts:65 起(:74-78 只能证明
 *     无条件返回)。ConvoTabs 的引用随上面第一条一并删除。
 *   · 判官另指出 DetailPanel.tsx:407 的确认框文案(仍说 removes from "canvas views")与本页
 *     新文案相反 —— 该矛盾归 #541 话语族处理,**本 PR 不动那个文件**。
 *
 *  2026-07-31 r4(判官第三份 FAIL:七项销项五项过,余下全是措辞级):
 *   · 【P1】?code= 不再被背书为真实回执 —— 本页只读 searchParams 的任意非空值,不查库、
 *     不验签,所以 ?code=made-up 也会渲染同一段。改法是把「回执」的主语还给 Meta 的确认
 *     流程,页面只承认自己在显示链接里带来的字符串;小标题也由「Your deletion request」
 *     (预设请求真实存在)改为「About this confirmation code」。详见上方「真实性约束」段。
 *   · 【P1】Disconnect 对比段的审计承诺补限定「when a connection matches」—— 匹配时写在
 *     route.ts:53-60 的同一事务内,可靠;零匹配走 :65-72 的 best-effort(catch 吞掉)。
 *     两个主段 r3 已改成 normally kept,这一段是漏网。
 *   · 【P1】「Your records are yours」是无范围的法律归属断言,改为与 Terms 对齐的有界表述:
 *     terms/page.tsx:101 只承诺「prompts / uploaded files / brand material / contacts /
 *     campaign decisions / external account connections … come from you and stay under your
 *     control」,正文照此枚举。Founder 的「商家数据商家权利」是产品方向,不等于本页可以写
 *     无界所有权句 —— 归属定界属法务,不在本 PR。
 *     ⚠️ r5 更正:r4 自称「照此枚举」但并未逐词照抄 —— 把 `uploaded files` 写成了 `uploads`,
 *     并整项漏掉 `external account connections`。r5 已把该句逐词对齐 terms/page.tsx:101
 *     的完整清单(六项俱全、用词一致)。教训同「自引用行号」那条:声称「照抄」时要真的
 *     逐词比对,不能凭印象转述。
 *   · 【P2】总览段的 Meta disconnect 补「when you are signed in as yourself」,与明细段
 *     (meta-actions.ts:106 冒充即返回 error)一致。
 *   · 【P2】saved reference 的「until you edit them」收窄 —— 重建引用发生在
 *     saveShotPrompt(actions.ts:534)的事务里::564 先 deleteMany 再 createMany;
 *     改标题/状态不走这条路径,故正文写明「renaming a shot or changing its status leaves
 *     the link in place」。
 *   · 【P3】上面两条注释口径已改:①「码总在删除事务成功后发出」补零匹配例外;
 *     ②「全 apps/web + apps/worker 无 delete/deleteMany」收窄为「生产自助路径无」——
 *     就地复核:creditLedger.deleteMany 只出现在 lib/__tests__/(stripe-webhook-integration、
 *     cross-tenant-write、principal-context)与 packages/db 生成客户端的 docstring 里,
 *     生产代码确无。
 *   · 【记账口径】r2/r3 汇报里写的「40+/65 条引用全部命中」没有可复现的计数口径(注释含
 *     重复引用与「旧错示例」)。此后只说「引用已逐条核对」,或附口径;判官机械扫描的口径是
 *     127 个行号 token / 34 个来源文件。*/
export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return (
    <main className="gb min-h-[100dvh] bg-background px-6 py-10 text-foreground">
      <article className="mx-auto max-w-[720px]">
        <Link href="/privacy" className="text-sm font-semibold text-muted-foreground underline underline-offset-4">
          Privacy policy
        </Link>
        <h1 className="mt-8 text-[34px] font-bold tracking-[-0.02em]">Data deletion</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Effective 28 July 2026 · Last updated 31 July 2026
        </p>

        <section className="mt-8 space-y-4 text-[15px] leading-7 text-muted-foreground">
          {code ? (
            <>
              <h2 className="text-lg font-semibold text-foreground">About this confirmation code</h2>
              <p>
                Code in the link you followed:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground">{code}</code>
              </p>
              <p>
                If you arrived here from Meta&apos;s confirmation flow, Meta shows you a confirmation code for your
                request. This page simply displays whatever code the link carries: it does not look the code up, check
                it against our records, or confirm that it came from us. What it can tell you is what a deletion
                request does, which is set out below.
              </p>
              <p>
                When Meta sends us a deletion request, we delete every stored Meta connection whose recorded Meta user
                ID matches the one in the request, including its access token. If no stored connection carries that ID,
                there is nothing for the request to delete and we still return a code. Some records are not deleted by
                this request: scheduled posts keep the Meta account and post identifiers in their publish history,
                publish attempts keep their post and media identifiers, and audit records are kept. A record of the
                request itself is normally kept too.
              </p>
              <p>
                To have us check a specific request, or to ask about anything beyond the Meta connection, email{" "}
                <a href={supportMailto("Meta deletion request")} className="underline underline-offset-4">{SUPPORT_EMAIL}</a> quoting
                the code.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-foreground">How Meta deletion requests work here</h2>
              <p>
                When you remove Fikirtive from your Facebook settings, Meta sends us a signed deletion request. We
                delete every stored Meta connection whose recorded Meta user ID matches the one in the request,
                together with the access token we held for it, and return a confirmation code to Meta along with a link
                back to this page that carries the code. If no stored connection carries that ID, there is nothing for
                the request to delete and we still return a code — so the code is the receipt for a request we
                received, not proof that a connection existed.
              </p>
              <p>
                Some records are not deleted by this request: scheduled posts keep the Meta account and post
                identifiers in their publish history, publish attempts keep their post and media identifiers, and audit
                records are kept. A record of the request itself is normally kept too.
              </p>
              <p>
                This page has no lookup form and does not verify codes. To have us check a specific request, email{" "}
                <a href={supportMailto("Meta deletion request")} className="underline underline-offset-4">{SUPPORT_EMAIL}</a> with the
                code.
              </p>
              <p>
                Deleting the Meta connection does not delete the rest of your workspace: your uploads, generated media,
                campaigns and contacts stay in Fikirtive. Some of those you can delete yourself — see below — and for
                anything else, use the account deletion route.
              </p>
            </>
          )}

          <h2 className="pt-4 text-lg font-semibold text-foreground">What you can delete yourself</h2>
          <p>
            The prompts, uploaded files, brand material, contacts, campaign decisions and external account connections
            in your workspace come from you and stay under your control. These deletions are in the product today: you
            run them yourself and you do not have to ask us. They do not all ask the same before acting — a campaign
            and a conversation make you type the name, a generated asset asks a plain yes, and a saved reference runs
            straight away; so does a Meta disconnect when you are signed in as yourself. Each entry below says which,
            and what is left behind.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="text-foreground">A campaign.</span> In the sidebar, open the campaign&apos;s controls
              (the <span className="text-foreground">⋯</span> button on its row) and choose{" "}
              <span className="text-foreground">Delete project</span>, then type the campaign name to confirm.
              Deleting a campaign permanently deletes the campaign record, its conversations and their messages, its
              canvas nodes, its generation and render jobs, its scheduled posts and shots, and the campaign-scoped
              audit records — then keeps one audit record noting that the campaign was deleted. Library assets held
              outside the campaign and credit ledger rows are not deleted by it. If a generation or a research run is
              still working in that campaign, the deletion is refused until it finishes, and Fikirtive says so rather
              than deleting part of it.
            </li>
            <li>
              <span className="text-foreground">A conversation.</span> In the sidebar, use the bin icon on the
              conversation&apos;s row, then type the conversation name to confirm. Deleting a conversation permanently
              deletes it and its messages. Canvas nodes and generated media are
              detached from it rather than deleted, so they stay in your library. A research run still in progress
              blocks the deletion until it finishes; a generation still in progress does not — it is detached and
              carries on, and the conversation is deleted anyway.
            </li>
            <li>
              <span className="text-foreground">A generated asset in your library.</span> Open{" "}
              <span className="text-foreground">Library</span>, open the asset, and choose{" "}
              <span className="text-foreground">Delete</span>, then confirm. This removes the asset from your library
              and cannot be undone. It does not clear the asset off a campaign canvas: any canvas card showing it stays
              where it is and reads <span className="text-foreground">Preview missing</span>. The stored file behind it
              is not yet removed by an automatic clean-up job.
            </li>
            <li>
              <span className="text-foreground">A saved reference.</span> Library also lists the products, characters,
              locations and brand marks you have saved. Their{" "}
              <span className="text-foreground">Delete</span> button runs straight away, with no confirmation step. The
              reference is removed from your library; shots that already used it keep their link to it until you next
              save that shot&apos;s prompt and reference chips. Renaming a shot or changing its status leaves the link
              in place.
            </li>
            <li>
              <span className="text-foreground">A connected Meta account.</span> In Fikirtive, open{" "}
              <span className="text-foreground">Connections</span> and choose{" "}
              <span className="text-foreground">Disconnect</span>. For your own login it runs immediately, with no
              confirmation step. It deletes the stored Meta connection for the workspace you are in: the Meta user ID,
              the encrypted access token, the granted scope and the default page we had recorded. A deletion request sent
              by Meta removes the same kind of stored connection, but the two are not identical. That request is
              matched by Meta user ID, so it reaches every workspace whose stored connection carries that ID — and a
              connection saved without one is not matched at all — and, when a connection matches, it also writes an
              audit record of the request, which Disconnect does not. Either way the same records survive: scheduled posts keep the Meta account and
              post identifiers in their publish history, publish attempts keep their post and media identifiers, and
              audit records are kept. Nothing else in your workspace is deleted.
            </li>
          </ul>
          <p>
            Three things have no delete control of their own today: contact records, credit ledger rows, and audit
            records that do not belong to a campaign. Contacts, and anything else you want removed, go through the
            email route below — we do not delete a contact record on our own initiative. The ledger and those audit
            records are the account of what was spent and what was done, so they stay. Publish history behaves
            differently: a scheduled post and its publish attempts go when you delete the campaign they belong to.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Deleting your whole account</h2>
          <p>
            To request deletion of your whole account, contact us: email{" "}
            <a href={supportMailto("Account deletion request")} className="underline underline-offset-4">{SUPPORT_EMAIL}</a> from the
            address you sign in with, or use{" "}
            <span className="text-foreground">Preferences → Danger zone → Delete account</span> inside Fikirtive, where
            you type your sign-in email to confirm and Fikirtive then opens the same email for you. There is no
            automated deletion flow, and the button does not delete anything by itself.
          </p>
          <p>
            Deleted records can persist for a period in database backups and in our database provider&apos;s
            point-in-time recovery window. Our own database snapshots are cleaned up on a rolling basis: a snapshot
            more than about 30 days old is deleted during a later backup run. See the{" "}
            <Link href="/privacy" className="underline underline-offset-4">Privacy policy</Link> for what we store and
            who else processes it.
          </p>
        </section>
      </article>
    </main>
  );
}
