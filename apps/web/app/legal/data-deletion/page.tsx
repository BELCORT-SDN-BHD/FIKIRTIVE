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
 *  统一改为上方决定清单 URL;本页正文无改动。*/
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
                campaigns and contacts stay in Fikirtive. To remove those, use the account deletion route below.
              </p>
            </>
          )}

          <h2 className="pt-4 text-lg font-semibold text-foreground">Deleting your whole account</h2>
          <p>
            To request deletion of your whole account, contact us: email{" "}
            <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a> from the
            address you sign in with, or use <span className="text-foreground">Account → request account deletion</span>{" "}
            inside Fikirtive, which opens the same email. There is no automated deletion flow, and the button does not
            delete anything by itself.
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
