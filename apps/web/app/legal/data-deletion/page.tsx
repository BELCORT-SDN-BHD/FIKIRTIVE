import Link from "next/link";

export const metadata = { title: "Data deletion · Fikirtive" };

/** Meta data-deletion 状态页:回调 (app/api/meta/data-deletion/route.ts) 返回的
 *  { url, confirmation_code } 里的 url 指到这里并带上 ?code=<confirmation_code>,
 *  所以码随链接进来 —— 页面只需读 searchParams 并陈述状态,无需输入框、无需按码
 *  查库(Meta 的回调规范只要求「链接 + 确认码」合起来给出人类可读的状态说明)。
 *
 *  真实性约束:码是在删除事务成功之后、随 200 响应一起发出的(route.ts:51-78),
 *  因此「持有码」本身就等于「那次请求已处理完毕」。文案不得超出这一点。
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
 *  免登录靠 proxy.ts:73 matcher 的 `legal` 前缀(本轮未改 matcher,一个字符都没加)。
 *  新增「What you can delete yourself」一节,补上此前整页缺失的自助路径。逐条只写代码里
 *  真有的能力,就地核验:
 *   · 删 campaign —— lib/actions.ts:179 `deleteProject`,事务内 :232-244 依次删 canvasNode /
 *     renderJob / captionJob / scheduledPost / generationBatch / genJob / generation /
 *     shotEntityRef / shot / 本项目的 actionEvent / project 本体;:213-223 删本项目的
 *     researchJob·chatMessage·chatThread;删完 :245 起补写一条 projectId:null 的
 *     ActionEvent(所以「保留一条删除记录」是实的)。UI:components/otto/OttoApp.tsx:423,
 *     确认框 :755-772(逐字抄它的 impacts,含「Global library assets and credit ledger rows
 *     are not deleted here」)。另:删除会被在跑的任务拒绝而非删一半 —— actions.ts:195 /
 *     :220 抛错、:257-265 转成人话回执,页面首段那句「refused until that finishes」即指此;
 *     conversation 侧同理(otto-actions.ts:2005 抛、:2016 回执)。
 *   · 删 conversation —— lib/otto-actions.ts:1982 `deleteCoworkThread`,:2006-2011 删
 *     researchJob·chatMessage·chatThread,而 canvasNode/generation/genJob 是 threadId 置 null
 *     (:2007-2009)—— 所以写「detached rather than deleted」。UI:OttoApp.tsx:519,
 *     确认框 :788-800。
 *   · 删 library asset —— lib/actions.ts:813 `deleteGeneration`,:823 只写 deletedAt(软删)。
 *     全仓 storage.deleteObject 的唯一调用点是 lib/upload-actions.ts:170(上传失败清理),
 *     删素材不走它 —— 所以「stored file 尚未被自动清理」照 privacy/page.tsx:361 的既有口径写。
 *     UI:components/asset/DetailPanel.tsx:358,确认框文案 :400-402。
 *   · 断开 Meta —— lib/meta-actions.ts:104 `disconnectMeta`,:107 删整行 MetaConnection;
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
 *  工具栏撤了(OttoNav.tsx:81-85),现入口是 components/global-navigation.tsx:70 的
 *  「Preferences」→ settings/sections.tsx:242-253 的 Danger zone → Delete account,
 *  按钮仍只开 mailto(OttoAccount.tsx:51),该句不变。*/
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
          Effective 28 July 2026 · Last updated 28 July 2026
        </p>

        <section className="mt-8 space-y-4 text-[15px] leading-7 text-muted-foreground">
          {code ? (
            <>
              <h2 className="text-lg font-semibold text-foreground">Your deletion request</h2>
              <p>
                Confirmation code:{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground">{code}</code>
              </p>
              <p>
                This code is the receipt Fikirtive returned to Meta for a deletion request it received. This page
                explains what such a request does; it does not look the code up or verify it.
              </p>
              <p>
                When Meta sends us a deletion request, we delete the stored Meta connection for that Meta user ID,
                including its access token. Some records are not deleted by this request: scheduled posts keep the Meta
                account and post identifiers in their publish history, publish attempts keep their post and media
                identifiers, and audit records — including the record of the deletion request itself — are kept.
              </p>
              <p>
                To have us check a specific request, or to ask about anything beyond the Meta connection, email{" "}
                <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a> quoting
                the code.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-foreground">How Meta deletion requests work here</h2>
              <p>
                When you remove Fikirtive from your Facebook settings, Meta sends us a signed deletion request. We
                delete the Meta connection stored against your Meta user ID, together with the access token we held for
                it, and return a confirmation code to Meta along with a link back to this page that carries the code.
                The code is the receipt for a request we received.
              </p>
              <p>
                Some records are not deleted by this request: scheduled posts keep the Meta account and post
                identifiers in their publish history, publish attempts keep their post and media identifiers, and audit
                records — including the record of the deletion request itself — are kept.
              </p>
              <p>
                This page has no lookup form and does not verify codes. To have us check a specific request, email{" "}
                <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a> with the
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
            Your records are yours. These deletions are in the product today: you run them yourself and they take
            effect when you confirm them — you do not have to ask us. If a generation or a research run is still
            working inside a campaign or conversation, deleting it is refused until that finishes, and Fikirtive tells
            you so rather than deleting part of it.
          </p>
          <ul className="list-disc space-y-2 pl-5">
            <li>
              <span className="text-foreground">A campaign.</span> Deleting a campaign permanently deletes the campaign
              record, its conversations and their messages, its canvas nodes, its generation and render jobs, its
              scheduled posts and shots, and the campaign-scoped audit records — then keeps one audit record noting
              that the campaign was deleted. Library assets held outside the campaign and credit ledger rows are not
              deleted by it.
            </li>
            <li>
              <span className="text-foreground">A conversation.</span> Deleting a conversation permanently deletes it
              and its messages. Canvas nodes and generated media are detached from it rather than deleted, so they stay
              in your library.
            </li>
            <li>
              <span className="text-foreground">An asset in your library.</span> Deleting an asset removes it from your
              library and canvas views and cannot be undone. The stored file behind it is not yet removed by an
              automatic clean-up job.
            </li>
            <li>
              <span className="text-foreground">A connected Meta account.</span> In Fikirtive, open{" "}
              <span className="text-foreground">Connections</span> and choose{" "}
              <span className="text-foreground">Disconnect</span>. That deletes the stored Meta connection for your
              workspace — the Meta user ID, the encrypted access token, the granted scope and the default page we had
              recorded. It removes the same stored connection a Meta deletion request removes, and differs only in
              reach: Disconnect affects the workspace you are in, while a request from Meta removes that connection
              from every workspace the Meta account was connected to. Either way the same records survive: scheduled
              posts keep the Meta account and post identifiers in their publish history, publish attempts keep their
              post and media identifiers, and audit records are kept. Nothing else in your workspace is deleted.
            </li>
          </ul>
          <p>
            Two things have no self-service delete today. Contact records cannot be deleted from the interface, and
            there is no automated flow for your whole account. Both go through the email route below, and we do not
            delete a contact record on our own initiative.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Deleting your whole account</h2>
          <p>
            To request deletion of your whole account, contact us: email{" "}
            <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a> from the
            address you sign in with, or use{" "}
            <span className="text-foreground">Preferences → Danger zone → Delete account</span> inside Fikirtive, which
            opens the same email. There is no automated deletion flow, and the button does not delete anything by
            itself.
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
