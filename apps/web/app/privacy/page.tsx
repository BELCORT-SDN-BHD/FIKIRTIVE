import Link from "next/link";
import { SUPPORT_EMAIL, supportMailto } from "@/lib/exits";

export const metadata = { title: "Privacy · Fikirtive" };

/** 事实基线:每条陈述均可在代码中核对(核对与数据清单记录见决定清单)。
 *  「决定清单」= https://github.com/BELCORT-SDN-BHD/FIKIRTIVE/pull/486#issuecomment-5106492327
 *  (持久决定清单以该 PR 评论为准,本注释所有清单引用均指它)。
 *  不得在此页写入代码兑现不了的承诺。
 *  provider 保密:生成类供应商按 #359 Founder Resolution 只写类别,不点名
 *  (机器防线在 apps/web/lib/provider-secrecy.ts)。免登录(proxy.ts 放行)。
 *
 *  2026-07-28 真实性核验轮(记录见决定清单)后的修订,逐条对应:
 *   B1 删掉「可暂停自然发布」—— `organicPublishPaused` 全仓只有读、无写(唯一 setter 是广告那一半
 *      meta-write-actions.ts:21-27,唯一按钮 OttoConnections.tsx:351-355)。
 *   B2 审计记录改成单向 —— 商家侧 ActionEvent 读取锁死 "generation.outcome"(data.ts:431-441、:445-456),
 *      宽口径审计只在 founder 邮箱门禁后的 /admin(admin/layout.tsx:19)。
 *   B3 备份期限不写成删除上限 —— 只有我们自己的夜间快照是 30 天(db-backup.ts:39、:83、:148);
 *      数据库供应商的时点恢复窗口天数是 Founder 控制台事实(见决定清单),未知不得代写。
 *   B4 补齐登录数据 —— 密码是主路径(LoginForm.tsx:21-23、:48、:156-181;server.ts:44-47;
 *      schema.prisma:1078)、头像落库(schema.prisma:541,写入 server.ts:100、:110)。
 *   L2/L3 法律定性(顾客通知义务在谁头上、哪部法律适用于我们)已搬出正文 → 决定清单。
 *
 *  2026-07-28 第三轮(写入点规则)。判定标准从「这一列存在吗」升级为
 *  **「生产代码里有没有一个真实商家用得到的写入点(create/update/upsert/setter),file:line?」**
 *  只读、只有 schema 列、只有测试里写 = 不写进页面。按此剪掉/改写六处:
 *   1. 顾客社交身份(B5)—— `ContactIdentity` 全仓写入者只在测试文件;生产侧明确拒收
 *      (crm-actions.ts:171-173 "Identity editing is not available."、:154 identityWrite:false),
 *      并有永久夹具禁止写入(__tests__/crm-identity.test.ts:80-83)。整条删除。
 *   2. 顾客消费总额 —— `totalOrdersMyr` 零写入点,且 crm-actions.ts:236 明写 "That field is read-only.";
 *      界面显示 "No receipt total connected"(components/crm/contact-profile-page.tsx:196)。整条删除。
 *   3. 品牌套件 / 品牌规则 —— `BrandKit`、`BrandRule` 各只有一个读取点
 *      (memory-actions.ts:114、:118),零写入点:商家今天建不了。两处提及都删,
 *      改成真能写的东西:记忆(memory-actions.ts:48)与品牌记录(brand-record-actions.ts:97)。
 *   4. 「你设为默认的 Page」—— `defaultPageId` 唯一写入是建行时的 null(meta-actions.ts:37),
 *      没有 setter。改成真会落库的那一个:排期贴文的目标账号
 *      (schedule-actions.ts:108、:233 → schedule-service.ts:63)。
 *   5. 密码与 Google 凭证 —— `ba_account`(schema.prisma:1066-1082)全仓零仓库写入者,
 *      写它的是登录库本身;散列算法我们没有配置也没有钉住(C7)。改成按实际情况归因给登录库,
 *      不断言具体算法。
 *   6. 会话 IP / User-Agent —— 列在 schema.prisma:1058-1059,仓库零写入者,同样由登录库写。同样归因。
 *  另:Meta 的 Pages/广告账号是用时现取(channels/meta-publish-adapter.ts:62 me/accounts),不落库。
 *
 *  2026-07-28 第四轮(同一把尺子第四次:凡「我们会为你做 X」都要指到写入点或代码路径)。
 *   1. 剪掉「或提醒你去发」——`PublishMode` 只是类型(channels/types.ts:5);`ScheduledPost` 没有
 *      `postType` 列(schema.prisma:2107-2143),`publishMode` 唯一写入是硬编码 "AUTO"
 *      (schedule-service.ts:67);全仓没有 Notification/Reminder 模型,唯一的外发邮件是登录邮件
 *      (better-auth/sender.ts:29 → 邮件发送适配器)。**没有任何东西会到达商家。**
 *      改成真实机制:发不出去时写 lastError 并置 NEEDS_ATTENTION(publish.ts:556,同族 :500 :610
 *      :640 :742),商家在排期里看到「Needs attention — <原因>」(OttoSchedule.tsx:1350-1352,
 *      数据经 schedule-actions.ts:74-75 选出)。明确写「不会给你发提醒或邮件」。
 *   2. 「唯一保留的账号识别码」限定到 Page/IG/广告账号(P1-b)—— 本条同一 bullet 前半句已说存
 *      Meta user ID,不限定就自相矛盾。唯一落库的目标账号是排期贴文的 metaTargetId
 *      (schema.prisma:2120,写入 schedule-service.ts:63);广告账号全仓无落库列,只有现取
 *      (meta-actions.ts:57、meta-objects.ts:34、meta-insights.ts:23 的 me/adaccounts)。
 *   3. founder 「阅读对话内容」剪掉(第三轮核出的另一处 UNBACKED)——跨工作区读消息正文的
 *      `getConversation`(conversation-admin.ts:118)**零生产调用者**:admin-v2.ts:22 只 import
 *      `listConversations`,另一处引用在测试;旧深链已改成 redirect
 *      (app/admin/conversations/[threadId]/page.tsx:5)。生产面是 metadata only
 *      (admin-v2.ts:621-632,`status: "metadata only"`;弹窗自述 AdminDashboardV2.tsx:1218)。
 *   4. founder 可见范围补全(P1-a)——原先两条读起来像穷举,实际还能看到钱与用量:
 *      tenant-admin.ts:106-137(owner email、balance/reserved、最近 25 条点数账本、
 *      genJob/refGenJob 花费合计、project/generation 计数、最近 25 条审计事件类型),
 *      页面 app/admin/tenants/[orgId]/page.tsx:13,渲染 components/admin/TenantDetail.tsx:204-208
 *      (余额/预留/USD 花费/项目数/生成数)、:260-271(点数账本)、:273-281(审计,自述 metadata only)。
 *      平台级只到元数据:生成条目 admin-v2.ts:648-661(工作区/项目/图或视频/时间),
 *      付费任务 :444-466 + :781(**`internalModel` 在出站前被剥掉**,只剩 "Image"/"Video" 通用标签,
 *      渲染 AdminDashboardV2.tsx:1163-1177),审计 :396-401 → :665-671。
 *      ⚠️ 第四轮自查纠正:核验报告把这里写成「which model ran」,那是**读了 select、没读渲染** ——
 *      `modelRef` 选出来了却在映射时丢弃(供应商保密),页面因此**不能**说能看到模型名。
 *      门禁仍是 founder 邮箱名单(admin/layout.tsx:19)。
 *   5. Stripe 结账出境内容补全(P2-b)——除 email(billing-actions.ts:72)与所选价目(:67),
 *      还有 client_reference_id=工作区 id(:68)与 metadata{orgId, credits, priceId}(:69)。
 *   6. 联系人日期改准(P2-c)——`lastSeenAt` 唯一写入在建档时(crm-actions.ts:146,与
 *      `firstTouchAt` :145 同值),全仓无更新点,所以不能写成会随互动变化的「last-seen」。
 *  另核:X/其他渠道**不在页面范围内是对的** —— `ChannelConnection` 全仓写入者只在测试文件,
 *  商家今天连不了 X(publish.ts:351 authorizeX 读的那张表没有生产写入点)。
 *
 *  2026-07-28 第五轮(跨族复审返工 3P0/8P1/2P2):
 *   P0-1 供应商名单→服务类别(Stripe/Google/Meta 为用户直接交互平台,保留,待 Founder 确认)。
 *   P0-2 Meta 侧数据来源那条如实补上发布历史保留(ScheduledPost.metaTargetId/metaPostId、
 *        PublishAttempt 的帖子/素材标识;route.ts 只删 MetaConnection 并写 ActionEvent)。
 *   P0-3 新增 BM 版 privacy/bm/page.tsx,两页顶部互挂语言切换;译文待 Founder/法务确认。
 *   P1-2 发布失败两态如实:可重试→NEEDS_ATTENTION,硬失败→FAILED(publish.ts:623/635)。
 *   P1-3 访问/更正/删除收敛为「联系我们提出请求」,不承诺时限与流程(SOP 待建,见决定清单)。
 *   P1-4 快照按滚动方式清理:超约 30 天在后续备份运行时删除(db-backup.ts 筛选 :147、
 *        删除 :148,清理调用 :173;上一版误引 :171,那行只是上传)。
 *   P1-5 登录会话/IP/浏览器信息/审计记录列为服务运行必然产生;客户数据清单补一句结构概括。
 *   P1-6 「no relationship」类法律定性改事实措辞:商家控制其客户数据,客户请求向商家提出。
 *   P2-1 标题 sentence case。P2-2 联系/安全/跨境细节不发明,进 Founder/法务决定清单。
 *
 *  2026-07-28 第六轮(二轮跨族复审 FAIL 后的三轮返工):
 *   P1-6 「You control … we process it on your instructions」控制者/处理者式法律定性改为
 *        纯操作事实:联系人数据由该 workspace 的商家放入并管理,客户请求向商家提出,
 *        Fikirtive 对这些数据做什么以本页描述为准;BM 版同段同步。
 *   注释引用可核验化:指向仓库外/不存在文件的引用统一改为上方决定清单 URL;
 *   邮件供应商文件路径改为类别化描述(供应商保密,消灭字节级供应商名命中)。
 *
 *  2026-07-29 第七轮(#518 Connections 单一真相 —— B1 行号同步):
 *   OttoConnections.tsx 从「仅广告」单页重构为 Publishing/Messaging 分组的统一 Connections 页
 *   (工单 #513 三、2)。kill-switch 机制本身未变(仍是唯一按钮、meta-write-actions.ts 唯一
 *   setter),只是随页面重组挪了位置:上方 B1 引用的按钮行 :206-210 → :322-326。*/
export default function PrivacyPage() {
  return (
    <main className="gb min-h-[100dvh] bg-background px-6 py-10 text-foreground">
      <article className="mx-auto max-w-[720px]">
        <Link href="/login" className="text-sm font-semibold text-muted-foreground underline underline-offset-4">
          Back to sign in
        </Link>
        <p className="mt-3 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">English</span>
          {" | "}
          <Link href="/privacy/bm" className="underline underline-offset-4">Bahasa Malaysia</Link>
        </p>
        <h1 className="mt-8 text-[34px] font-bold tracking-[-0.02em]">Fikirtive privacy policy</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Effective 28 July 2026 · Last updated 28 July 2026
        </p>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Fikirtive is operated by BELCORT SDN BHD, a company registered in Malaysia. This notice describes the product
          as it works today, while access is by invitation only. It explains what information we hold, why we hold it, who else
          processes it, and how to have it removed.
        </p>

        <section className="mt-8 space-y-4 text-[15px] leading-7 text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">Two different people are described here</h2>
          <p>
            Almost every confusion about a tool like this comes from mixing up two groups, so we keep them separate
            throughout:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="font-semibold text-foreground">You, the merchant.</span> You sign in, you upload your
              material, you decide what gets published or paid for.
            </li>
            <li>
              <span className="font-semibold text-foreground">Your own customers.</span> We hold information about them
              only because you put it into Fikirtive. We do not collect it from them, we do not obtain it from anywhere
              else, and Fikirtive does not contact them.
            </li>
          </ul>
          <p>
            The customer information in your workspace is information you put there and manage. If one of your
            customers has a question or request about their information, they should raise it with you. What Fikirtive
            does with that information is what this page describes. Fikirtive has no sending or receiving channel to
            your customers, so it cannot notify them for you. See{" "}
            <Link href="/terms" className="underline underline-offset-4">Terms</Link>.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Information about you (the merchant)</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-foreground">Account and sign-in.</span> Your email address, your name, and your
              profile picture if your sign-in provider supplies one. Your sign-in credentials are held separately, by
              the authentication library the product uses: for email-and-password sign-in, your password in hashed
              form; for Google sign-in, the account identifiers and tokens Google returns to us.
            </li>
            <li>
              <span className="text-foreground">Session records.</span> A record of each sign-in session. The
              authentication library stores the IP address and browser user-agent it sees on the request alongside it.
            </li>
            <li>
              <span className="text-foreground">The work you create.</span> Uploaded files and images, the prompts you
              write, notes you ask Otto to remember, the brand records you save — your audience descriptions, and your
              offers and products including any price you type — generated images and video, campaign and schedule
              data.
            </li>
            <li>
              <span className="text-foreground">Otto conversations.</span> The full text of your chats with Otto,
              including anything you paste into them.
            </li>
            <li>
              <span className="text-foreground">Transcripts.</span> If a file is transcribed, the transcript text.
            </li>
            <li>
              <span className="text-foreground">Credits and purchases.</span> Your credit balance and the credit ledger
              (every reservation, settlement and refund), plus the checkout events Stripe reports back to us. Credit
              purchases happen on a Stripe-hosted checkout page: your card details are entered on Stripe&apos;s page and
              never pass through Fikirtive. We send Stripe your email address, the pack you chose, and your
              workspace&apos;s internal identifier together with the credit count for that pack, so the credits land in
              the right workspace when the payment completes.
            </li>
            <li>
              <span className="text-foreground">Connected accounts.</span> If you connect Meta, we store the access
              token (encrypted), your Meta user ID, and the permissions Meta granted. When you schedule a post, the
              Facebook Page or Instagram account you pick for that post is stored with the post.
            </li>
            <li>
              <span className="text-foreground">Audit records.</span> Dated records of significant actions in your
              workspace, so that we can see what happened when you ask us to look into something.
            </li>
          </ul>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Information about your customers</h2>
          <p>What a contact record can hold today:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Name, lifecycle stage, where the contact came from, and the date you added the contact — kept as both a
              first-seen and a last-seen date, both set when the record is created.
            </li>
            <li>
              Marketing-consent state (opted in, opted out, or unknown), where that consent came from and when it was
              recorded, and a do-not-disturb flag.
            </li>
          </ul>
          <p>
            Your workspace can also hold the structures you build around those records — contact segments, broadcast
            audience selections, and automation workflow configurations.
          </p>
          <p>
            <span className="font-semibold text-foreground">What we deliberately do not store.</span> When you import
            contacts from a CSV, the phone, WhatsApp and email columns are used only to warn you about likely
            duplicates, and are then discarded rather than saved. The import result says so on screen. A contact record
            has no phone number, WhatsApp number or email address, and nothing in the product writes one. We also hold
            no social handles or platform identifiers for your customers: there is no way to add one, and attempting to
            attach one is refused.
          </p>
          <p>
            <span className="font-semibold text-foreground">What Fikirtive does not do.</span> Fikirtive does not send
            messages to your customers and does not receive messages from them. There is no live sending or receiving
            path in the product today; the message workbench runs simulated sends only.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Where the information comes from</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>You — everything you type, upload, import or connect.</li>
            <li>Google, if you choose to sign in with a Google account.</li>
            <li>
              Meta, if you connect a Meta account: your Meta user ID and the granted permissions. Your Pages, Instagram
              accounts and ad accounts are read from Meta while you are on the screen that needs them. What we keep is
              the Page or Instagram account you pick for a scheduled post, and — once publishing has been attempted —
              the post and media identifiers that publishing produced, as part of that post&apos;s history.
            </li>
            <li>Stripe, when a credit purchase completes.</li>
            <li>Our own systems — session records and audit records created as you use the product.</li>
          </ul>

          <h2 className="pt-4 text-lg font-semibold text-foreground">What we use it for</h2>
          {/* #851 — "publish what you schedule" read as something the product does today; publishing
              is switched off, so nothing is sent anywhere. The purpose itself stays listed (that is
              what this section is for — the uses your data may be put to), qualified by when it
              applies. No obligation stated elsewhere in this policy changes. */}
          <p>
            To sign you in, scope your data to your own workspace, meter and settle credits, run Otto, produce and store
            generated media, keep the schedule you write, publish what you schedule once publishing is switched on, show
            you your own generation history and results, and keep the service running and debug it.
          </p>
          <p>
            If a scheduled post runs into a problem, we store the reason on that post. A problem that might still be
            resolved is marked as needing attention; a hard failure that retrying would not fix is marked as failed.
            Either way, you see what happened when you next open the schedule. Fikirtive does not send you a reminder,
            an email or any other message about a scheduled post.
          </p>
          <p>
            We do not use your workspace content to give another Fikirtive customer access to your files, contacts or
            campaigns.
          </p>
          <p>
            The Fikirtive app does not include third-party advertising or analytics tracking scripts. We use a cookie to
            keep you signed in.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Who else processes it</h2>
          <p>
            Fikirtive runs on hosted infrastructure and uses service providers. Each receives only what its role needs.
            We describe infrastructure providers by service category; the platforms you interact with directly —
            Stripe, Google and Meta — are named:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>A cloud hosting provider and a managed database provider, which run the application and hold its data.</li>
            <li>A file storage and content delivery provider, which holds uploaded and generated files.</li>
            <li>Payments — Stripe.</li>
            <li>An email delivery service, which sends transactional email such as sign-in codes.</li>
            <li>An error monitoring service, which may receive details of a failed request.</li>
            <li>Sign-in with Google — Google.</li>
            <li>Web search providers, when Otto researches something. Your query text is sent.</li>
            <li>Connected ad and social accounts — Meta.</li>
            <li>
              Third-party AI infrastructure providers, which process content in order to produce Otto&apos;s replies and
              your generated media. We name these by category rather than individually, because which providers we use
              is commercially confidential.
            </li>
          </ul>
          <p>
            <span className="font-semibold text-foreground">What reaches the AI providers is worth spelling out.</span>{" "}
            Each time Otto replies, the provider receives the conversation so far and your brand context — the notes Otto
            remembers, and your brand records: the audience descriptions you wrote, and the offers and products you
            recorded, including the prices you entered. Images you drag into a conversation are sent with it. If Otto
            works with your contact list, the contact details Otto is working with are sent too. For image and video
            generation, the provider receives your prompt and a link that lets it download the specific source image or
            video from our storage; that link stops working after one hour.
          </p>
          <p>
            These are international services, so your information may be processed outside Malaysia.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Who at Belcort can see your workspace</h2>
          <p>
            We would rather state this plainly than leave it vague. Access to the internal admin area is restricted to a
            fixed list of founder email addresses. From there:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              A founder can list the most recent Otto conversations across all workspaces, in order to support and debug
              the product. What that list shows is which workspace and project a conversation belongs to, how many
              messages it holds, and when it was last active. Reading the message text itself is not built: the internal
              screen deliberately does not load prompts, transcripts, media or raw payloads.
            </li>
            <li>
              A founder can open a single workspace and see the owner&apos;s email address, the credit balance and what
              is currently reserved, recent credit-ledger entries, what generation has cost in total, how many projects
              and generated items exist, and the types and dates of recent audit records. Across all workspaces, the same
              area lists recent activity as metadata only — for a generation, the workspace, the project, whether it was
              an image or a video, and when; for a paid job, what it cost and when; and recent audit records by type and
              time. It does not show the prompt, the generated file, or the message text.
            </li>
            <li>
              A founder can sign in as a workspace owner to reproduce a problem. Doing so requires typing a written
              reason, is recorded in an audit record, and blocks all spending while it is active.
            </li>
          </ul>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Your choices and controls</h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Disconnect Meta from the Connections screen. This is blocked while a founder is signed in as you.
            </li>
            <li>
              A pause switch on the same screen lets you stop ad writes without disconnecting. It is also blocked while
              a founder is signed in as you.
            </li>
            <li>Record consent or an opt-out against a contact, and set do-not-disturb on any contact.</li>
            <li>
              Your email address is required — without it there is no account and you cannot sign in. Some records are
              produced simply by using the service: sign-in sessions, the IP address and browser details recorded with
              them, and audit records of significant actions. What you add beyond that is up to you: if you do not
              upload files, import contacts or connect an account, those features simply do nothing.
            </li>
          </ul>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Access, correction and deletion</h2>
          <p>
            To request a copy of your data, a correction, or deletion, contact us at{" "}
            <a href={supportMailto("Data request")} className="underline underline-offset-4">{SUPPORT_EMAIL}</a> from the
            address you sign in with. There is no automated self-service flow for these requests today.
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <span className="text-foreground">Meta connection.</span> Automated. Removing Fikirtive in your Facebook
              settings deletes the stored connection and its access token — see{" "}
              <Link href="/legal/data-deletion" className="underline underline-offset-4">data deletion</Link> for what
              is and is not removed.
            </li>
            <li>
              <span className="text-foreground">Your whole account and workspace.</span> Contact us to make the
              request. The button in Account opens that email; it does not delete anything by itself.
            </li>
            <li>
              <span className="text-foreground">Individual contacts.</span> Contact records cannot be deleted from the
              interface today. Contact us to request their removal.
            </li>
          </ul>
          <p>
            We keep your information while your workspace is open. Two limits are worth knowing. Deleted records can
            persist for a period in database backups and in our database provider&apos;s point-in-time recovery window;
            our own database snapshots are cleaned up on a rolling basis, so a snapshot more than about 30 days old is
            deleted during a later backup run. And stored files are not yet removed by an automatic clean-up job.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Who you are dealing with</h2>
          <p>
            Fikirtive is operated by BELCORT SDN BHD, a company registered in Malaysia. Questions, requests and
            complaints about personal data:{" "}
            <a href={supportMailto("Privacy question")} className="underline underline-offset-4">{SUPPORT_EMAIL}</a>.
          </p>
          <p>
            We update this page as the product changes, and change the effective date at the top when we do.
          </p>
        </section>
      </article>
    </main>
  );
}
