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
 *
 *  2026-07-28 真实性核验轮(legal/TRUTH-CHECK.md)后的唯一修订:B3 —— 备份那句不再把
 *  30 天写成删除上限。「30 天」这个数字**只依据代码常数**,已就地重核:
 *  apps/worker/src/db-backup.ts:39 `RETENTION_DAYS = 30`、:83 按 key 日期算 cutoff、
 *  :148 过期对象即删(2026-07-28 第四轮就地重核:本注释上一版写 :147,那是 `selectExpiredBackups`
 *  那一行;真正的 `deleteObject` 循环在 :148 —— 行号引用正是最容易过期的一类事实)。数据库供应商的时点恢复窗口是另一个窗口,天数由 Founder 在供应商控制台设定
 *  (docs/runbooks/db-backup.md「两个恢复窗口」一节自己写着「需 founder 确认/设置」),
 *  对本会话为 UNKNOWN,因此只说「a period」→ FOUNDER-DECISIONS A11。
 *  文档漂移提示(2026-07-28 第三轮核出,不在本批修复范围):该 runbook 的表格把
 *  `RETENTION_DAYS` 标为 `db-backup.ts:35`,实际在 :39 —— 本页文案不依赖那条引用,
 *  以代码为准;runbook 的修正见 FOUNDER-DECISIONS C8。
 *  本轮不加查码表单、不加数据库访问(Meta 只要求人类可读的状态说明)。
 *
 *  2026-07-28 第三轮(写入点规则):本页逐句过尺,无未支撑主张。删除机制
 *  route.ts:38-39 验签、:47-50 按 metaUserId 查、:54 删连接行、:75-77 才随 200 发码;
 *  整账户删除的按钮只打开邮件(components/otto/OttoAccount.tsx:51,标题
 *  "Request account deletion" :40)。*/
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
          Privacy Policy
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
                <span className="font-semibold text-foreground">
                  Status: if you reached this page from Meta&apos;s link, the request that code belongs to is complete.
                </span>{" "}
                Fikirtive issues a code like this one only after it has finished processing the deletion request Meta
                sent us — so receiving the code is the confirmation. When Meta told us you removed Fikirtive, we looked
                for the Meta connection stored against your Meta user ID and deleted it, together with the access token
                we held for it. If we held no such connection, there was nothing to delete. Either way the request is
                closed: nothing is queued or pending.
              </p>
              <p>
                This page does not verify the code you are looking at — it shows what the code means. If you typed or
                pasted a code by hand, or you think something was missed, email{" "}
                <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a> quoting the
                code and we will check what happened for you.
              </p>
            </>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-foreground">How Meta deletion requests work here</h2>
              <p>
                When you remove Fikirtive from your Facebook settings, Meta sends us a signed deletion request. We look
                for the Meta connection stored against your Meta user ID and delete it, together with the access token
                we held for it. We then return a confirmation code to Meta, along with a link back to this page that
                carries the code.
              </p>
              <p>
                Because the code is issued only after that work is done, opening Meta&apos;s link is what shows you the
                status. This page has no lookup form: if you hold a code but not the link, email{" "}
                <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a> with the
                code and we will check what happened for you.
              </p>
              <p>
                Deleting the Meta connection does not delete the rest of your workspace. Your uploads, generated media,
                campaigns and contacts stay in Fikirtive, because they are yours and are not held on Meta&apos;s behalf.
                To remove those, use the account deletion route below.
              </p>
            </>
          )}

          <h2 className="pt-4 text-lg font-semibold text-foreground">Deleting your whole account</h2>
          <p>
            Account deletion is handled by a person, not by an automated flow. Email{" "}
            <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a> from the
            address you sign in with, or use <span className="text-foreground">Account → request account deletion</span>{" "}
            inside Fikirtive, which opens the same email. Your workspace stays usable until we confirm the deletion.
          </p>
          <p>
            Deleted records can persist for a period in database backups and in our database provider&apos;s
            point-in-time recovery window. Our own nightly snapshots are deleted 30 days after they are taken. See the{" "}
            <Link href="/privacy" className="underline underline-offset-4">Privacy Policy</Link> for what we store and
            who else processes it.
          </p>
        </section>
      </article>
    </main>
  );
}
