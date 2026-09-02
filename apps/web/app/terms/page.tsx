import Link from "next/link";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/exits";

export const metadata = { title: "Terms · Fikirtive" };

/** 事实基线:每条运营性陈述均可在代码中核对(核对记录见决定清单)。
 *  「决定清单」= https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/486#issuecomment-5106492327
 *  (持久决定清单以该 PR 评论为准,本注释所有清单引用均指它)。
 *  本页除线上原有的适用法一句(第六轮按原文恢复,见下)外,不含管辖、保证免责、责任限制、
 *  赔偿、知识产权归属等新增条款 —— 那些是律师起草范围,清单见决定清单。免登录(proxy.ts 放行)。
 *
 *  2026-07-28 真实性核验轮(记录见决定清单)后的修订:
 *   B1 删掉「可暂停自然发布」—— 只有广告那一半有 setter(meta-write-actions.ts:21-27)与按钮
 *      (OttoConnections.tsx:351-355);`organicPublishPaused` 全仓无写入者。
 *   L1 适用法句搬出正文 → 决定清单(第六轮已按决定清单第 9 条恢复原句,见下)。
 *   L2 「告知顾客的义务在商家」这条定性搬出正文 → 决定清单;
 *      正文只留能力事实(无收发通道:customer-inbox-service.ts:1243、
 *      customer-broadcast-service.ts:794;同意状态只是商家自述:crm-actions.ts:190)。
 *
 *  2026-07-28 第三轮(写入点规则)—— 本页逐句过了同一把尺子:凡描述数据或商家控制的句子,
 *  都要能指到一个真实商家用得到的生产写入点。本页无需改动,写入点如下:
 *   邀请与撤销 tenant-actions.ts:88(upsert invited)、:97(status revoked);
 *   点数预留/结算/退回 packages/db/src/credits.ts:42、:77、:100、:124;
 *   审批过期不执行 otto-actions.ts:1205-1208、:1558-1561;
 *   Stripe 托管结账 billing-actions.ts:65(出境:customer_email :72、所选价目 :67、
 *   client_reference_id=工作区 id :68、metadata{orgId, credits, priceId} :69——
 *   上一版写「仅 email 与价目」,漏了 :68-69 两项,勿回退);
 *   审核通过前拒发 channels/meta-publish-adapter.ts:40-43(canPublish 由 Meta 实授权导出,
 *   meta-actions.ts:29-31);暂停广告写入 meta-write-actions.ts:25 + 按钮 OttoConnections.tsx:347-357;
 *   账号删除按钮只开邮件 app/profile/DeleteAccountCard.tsx(前端基线合并 FRONT-A1:换壳后
 *   旧的整屏 Otto 设置面没有路由渲染,按钮搬到 Personal 的 Profile 页,行为一字未改)。
 *  提醒:本页仍**没有**任何「暂停自然发布」措辞 —— 那一列至今零写入者(B1 已剪,勿回填)。
 *
 *  2026-07-28 第四轮:剪掉 reels/stories「我们会在排期时间提醒你」那一条。
 *   为什么是假的:`PublishMode` 只是类型(channels/types.ts:5);`ScheduledPost` 没有 `postType` 列
 *   (schema.prisma:2107-2143),所以没人能把一条贴文标成 reel/story;`publishMode` 唯一写入是
 *   硬编码 "AUTO"(schedule-service.ts:67),"REMINDER" 从未被写过;IG 贴文四处强制 image-only
 *   (schedule-service.ts:48-50、schedule-actions.ts:210、:228、:358),reel/story 根本排不进来;
 *   `apps/web/lib/channels/` 那个注册表(reminder 语义所在)**零生产调用者**,worker 直接在
 *   publish.ts:429-439 发布,没有 reel/story 分支;全仓无 Notification/Reminder 模型,
 *   唯一外发邮件是登录邮件(better-auth/sender.ts:29)。**没有任何提醒会到达商家。**
 *   改成真实机制并新增一条:发不出去 → lastError + NEEDS_ATTENTION(publish.ts:556、:500、:610、
 *   :640、:742),商家在排期里看到「Needs attention — <原因>」(OttoSchedule.tsx:1350-1352)。
 *   注意:这里只否定 reel/story 与提醒,**不写**「其他一律排不进来」——Facebook 贴文没有 mime 白名单,
 *   带视频的 FB 贴文排得进去(只是发布时会失败),写成全称命题就又造一句假话。
 *  另:「暂停自然发布」与「提醒」是同一个病灶的两面 —— 都是「schema/类型里有,产品里没有」。
 *
 *  2026-07-28 第五轮(跨族复审返工):
 *   P1-1 「所有花费都等待批准、未回答会过期」不符实际 —— GEN_CARD 生成按商家指令直接执行并计费、
 *        无 TTL(cowork-actions.ts:33/133),只有审批卡(ASK)有过期(otto-actions.ts:1205)。
 *        改为两类如实描述。
 *   P1-2 发布失败两态:可重试→needs attention,硬失败→failed(publish.ts:623/635)。
 *   P1-3 支持/删除段收敛为「联系我们提出请求」,不承诺时限与流程。
 *   P1-6 用户责任/第三方条款/单方变更三处措辞收敛为事实性;「过登录页即接受」保留最简式;
 *        四处均进 Founder/法务决定清单。
 *   P1-7 管辖法/责任/赔偿等结构性留白**保持留白**,不补写任何法律条款(律师范围)。
 *   P2-1 标题与 Privacy policy 链接文字 sentence case。
 *
 *  2026-07-28 第六轮(二轮跨族复审 FAIL 0P0/4P1/2P2/1P3 后的三轮返工):
 *   P1-7 恢复线上原句「These beta terms are governed by the laws of Malaysia.」——
 *        判官裁定:删除现行法律条款同样是法律立场变更,工程侧不得默会执行。
 *        逐字取自 d728e94b:apps/web/app/terms/page.tsx,最终处置见决定清单第 9 条。
 *   P1-6a 「过登录页即接受」改为行为陈述:登录页链接两份文件(app/login/page.tsx:104-108),
 *        请在使用前阅读;接受机制的法律效力见决定清单第 5 条,页面不作断言。
 *   P1-6b 「We have no relationship with your customers」纯法律立场句删除;产品行为描述
 *        (无收发通道、模拟发送)前句已含,不受影响。
 *   注释引用可核验化:指向仓库外/不存在文件的引用统一改为上方决定清单 URL。
 *
 *  2026-07-29 第七轮(#518 Connections 单一真相 —— B1/写入点两处行号同步):
 *   OttoConnections.tsx 从「仅广告」单页重构为 Publishing/Messaging 分组的统一 Connections 页
 *   (工单 #513 三、2)。kill-switch 机制本身未变(仍是唯一按钮、meta-write-actions.ts 唯一
 *   setter),只是随页面重组挪了位置:上方 B1 引用的按钮行 :206-210 → :322-326;写入点小节引用的
 *   完整行 :202-212 → :318-328。*/
export default function TermsPage() {
  return (
    <main className="gb min-h-[100dvh] bg-background px-6 py-10 text-foreground">
      <article className="mx-auto max-w-[720px]">
        <Link href="/login" className="text-sm font-semibold text-muted-foreground underline underline-offset-4">
          Back to sign in
        </Link>
        <h1 className="mt-8 text-[34px] font-bold tracking-[-0.02em]">Fikirtive terms</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Effective 28 July 2026 · Last updated 28 July 2026
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Fikirtive is an invite-only marketing workspace operated by BELCORT SDN BHD, a company registered in
          Malaysia. These terms describe how the product actually behaves, in plain language.
        </p>

        <section className="mt-8 space-y-4 text-[15px] leading-7 text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">Getting access</h2>
          {/* 接受机制(如何构成同意)的法律效力见决定清单第 5 条,页面正文不作断言:
              https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/486#issuecomment-5106492327 */}
          <p>
            Access is by invitation. Sign-in is refused for any email address that is not on our invite list, whichever
            sign-in method you use, and an invitation can be revoked. The sign-in page links to these terms and the{" "}
            <Link href="/privacy" className="underline underline-offset-4">Privacy policy</Link> — read them before
            using the service.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Using Fikirtive</h2>
          <p>
            The prompts, uploaded files, brand material, contacts, campaign decisions and external account connections
            in your workspace come from you and stay under your control. Only upload content you own or have permission
            to use.
          </p>
          <p>
            Otto can draft marketing ideas and prepare generation or ad actions. Fikirtive does not review outputs for
            you — check them before publishing or spending on external platforms.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Your customers&apos; details</h2>
          <p>
            When you add or import contact details, you are giving us other people&apos;s information. Fikirtive records
            the consent state you tell it — it cannot verify that consent exists.
          </p>
          <p>
            Fikirtive does not send messages to your customers and does not receive messages from them. There is no live
            sending or receiving path in the product today; the message workbench runs simulated sends only.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Credits and paid actions</h2>
          <p>
            Generation costs money, and it is paid for with credits. Credits are reserved before work starts, and then
            either settled at the actual cost or refunded to your balance when the job finishes or fails — the credit
            ledger records every reservation, settlement and refund, and your balance can be reconstructed from it.
          </p>
          <p>
            Credits are spent only on things you start. Some actions Otto prepares pause behind an approval card before
            they run, and an approval card left unanswered expires after its time limit rather than proceeding. Other
            generation actions run and are charged as soon as you tell the product to run them — for example, choosing
            to generate from a generation card — without a separate approval step.
          </p>
          <p>
            Credit purchases run through a Stripe-hosted checkout page. Third-party services you use through Fikirtive
            — Stripe checkout, Meta ads and others — have their own terms, fees and platform rules.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Publishing to social platforms</h2>
          <p>
            How a scheduled post reaches a platform depends on the post type and on what the platform has approved for
            us:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            {/* #851 — this said "Some post types can be published automatically" as a plain
                statement of what happens today. Publishing is switched off, so nothing is sent
                to any platform at all. The supported post types stay stated (they are what these
                terms cover once publishing is on); what changed is that they are no longer
                described as something happening now. */}
            <li>
              Publishing is switched off at the moment: a scheduled post is saved and kept in your schedule, and
              nothing is sent to Instagram or Facebook. When publishing is switched on, some post types can be
              published automatically — Instagram feed images and carousels, and Facebook feed posts.
            </li>
            <li>
              Instagram reels and stories are not supported today. An Instagram post has to be an image, and the product
              has no reel or story option, so they cannot be scheduled at all. Fikirtive does not send reminders to post.
            </li>
            <li>
              If a scheduled post runs into a problem, the reason is shown on that post inside Fikirtive: a problem
              that might still be resolved is marked as needing attention, and a hard failure that retrying would not
              fix is marked as failed. Nothing is sent to you — opening your schedule is how you find out.
            </li>
            <li>
              Automatic publishing and ad writes stay switched off for your connection until Meta&apos;s app review has
              actually granted the matching permissions. Until then those actions are refused rather than attempted.
            </li>
            <li>
              You can pause ad writes at any time from the Connections screen, without disconnecting.
            </li>
          </ul>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Availability and changes</h2>
          <p>
            The product is still changing: features, prices, provider availability and limits continue to change. If
            something looks wrong, stop using the affected feature and email{" "}
            <a href={supportMailto("Something looks wrong")} className="underline underline-offset-4">{SUPPORT_EMAIL}</a>.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Support and deleting your account</h2>
          <p>
            Support, data requests and account deletion all go to{" "}
            <a href={supportMailto("Support request")} className="underline underline-offset-4">{SUPPORT_EMAIL}</a> — contact us
            there to make a request. There is no automated deletion flow: the button in Settings &rarr; Profile opens
            that email and does not delete anything by itself. See the{" "}
            <Link href="/privacy" className="underline underline-offset-4">Privacy policy</Link> and{" "}
            <Link href="/legal/data-deletion" className="underline underline-offset-4">data deletion</Link>.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Who you are dealing with</h2>
          {/* 这一句的管辖法内容为线上原状(取自 d728e94b:apps/web/app/terms/page.tsx),
              最终处置见决定清单第 9 条:
              https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/486#issuecomment-5106492327
              #791-8(Founder 裁决④ 2026-08-08「对外不称 beta」):只删掉「beta」这个
              形容词 —— 管辖法本身、以及「这些条款受马来西亚法律管辖」这个法律实质
              一个字未动,不构成 2026-07-28 判官所指的「删除现行法律条款」。 */}
          <p>
            Fikirtive is operated by BELCORT SDN BHD, a company registered in Malaysia. These terms are governed
            by the laws of Malaysia. Questions:{" "}
            <a href={supportMailto("Question about the terms")} className="underline underline-offset-4">{SUPPORT_EMAIL}</a>.
          </p>
          <p>
            We update this page as the product changes, and change the effective date at the top when we do.
          </p>
        </section>
      </article>
    </main>
  );
}
