/**
 * Home —— 商家自己的总览(换壳规格书 `docs/specs/wave2-shell.md` §4.1,W2-6)。
 *
 * 五块,每一块的数字都有真实来源:
 *   ① 开场 —— 问候 + credits 余额 + 开工入口
 *   ② 接着做 —— 最近的画布 + 最近生成的缩略图
 *   ③ 接下来发什么 —— 未来 7 天的排期 + 发布状态的实话
 *   ④ 进行中的战役
 *   ⑤ 把 Otto 装备好(仅未完成时出现)
 *
 * **这一页绝对不出现的东西**(这是纪律,不是偏好 —— #609 已经因为这个把旧的沉浸式首页砍过
 * 一次,`components/canvas/NorthstarHome.tsx` 的文件头逐字记着那件事):
 *   - 任何 Meta 来的数字。`getAnalytics` 今天对**每一个**商家都返回 `notConnected`
 *     (Facebook Login 在 app 层关着),放一个「本月触达」磁贴就是编造。这条有机器围栏:
 *     `lib/__tests__/home-page.test.ts` 把整张 import 图翻一遍,`getAnalytics` 出现就红。
 *   - 任何营收 / 订单 / 客户数。`Contact.totalOrdersMyr` 全仓无写入点,CRM 又整段藏起来。
 *   - 任何「今日决策队列」式的样板数据。
 *
 * 空账号看到的:开场(余额 = 起始 credits)+ 一句 `Nothing here yet — start your first
 * canvas.` + 装备清单。**这就是全部,且它是真的** —— ③④两块没有内容时整块不渲染,而不是
 * 摆一个空壳子说「这里以后会有东西」。
 *
 * 纯展示:一次读取都不做,数据由 `HomeEntry` 按认证身份取好递进来。发布状态那句话是唯一的
 * 例外 —— 它**必须**由这一层直接向核心常量要(`publishSurfaceCopy()`),否则它就成了一个
 * 调用方递什么就写什么的字符串,围栏也就只是在核对自己的复印件。
 */

import Link from "next/link";
import { CalendarClock, Megaphone, Check } from "lucide-react";
import { PUBLISHING_AVAILABLE, publishSurfaceCopy } from "@fikirtive/core/schedule-draft";
import { canvasHref } from "@/components/canvas/canvas-href";
import { StartSomething } from "@/components/start-something/StartSomething";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { HOME_COPY, creditsLine, type HomeData } from "./home-data";

/** 每一块共用的小标题。 */
function BlockHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] leading-[14px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

/** 「这一刻读不出来」的那一行。**不是**空态的写法,也不是一句安慰话:它只说发生了什么。 */
function Unreadable({ children }: { children: React.ReactNode }) {
  return (
    <p role="status" className="mt-3 text-sm text-muted-foreground">
      {children}
    </p>
  );
}

export function HomeView({ data }: { data: HomeData }) {
  const publishCopy = publishSurfaceCopy();
  // 「真的什么都还没做」只有一种成立方式:两边都**读到了**,而且两边都空。任何一边读不出来,
  // 这一页都没有资格说这句话(判官 r1 P3-1)。
  const nothingMade =
    data.canvases.ok && data.thumbs.ok && data.canvases.value.length === 0 && data.thumbs.value.length === 0;

  return (
    <main className="min-h-dvh bg-background px-4 py-7 text-foreground sm:px-6 lg:px-8 lg:py-9">
      <div className="mx-auto flex max-w-5xl flex-col gap-10">
        {/* ① 开场 */}
        <section>
          <h1 className="text-[28px] leading-[34px] font-bold tracking-[-0.02em]">{data.greeting}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {creditsLine(data.credits)}{" "}
            <Link href={data.billingHref} className="font-medium text-foreground underline underline-offset-4">
              {data.billingLabel}
            </Link>
          </p>
          <div className="mt-6 max-w-[720px]">
            <StartSomething />
          </div>
        </section>

        {/* ② 接着做 */}
        <section>
          <BlockHeading>{HOME_COPY.pickUpHeading}</BlockHeading>
          {nothingMade ? (
            <p className="mt-3 text-sm text-muted-foreground">{HOME_COPY.nothingMade}</p>
          ) : (
            <>
              {!data.canvases.ok && <Unreadable>{HOME_COPY.canvasesUnreadable}</Unreadable>}
              {data.canvases.ok && data.canvases.value.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1">
                  {data.canvases.value.map((canvas) => (
                    <li key={canvas.id}>
                      <Link
                        href={canvasHref(canvas.id)}
                        className="flex min-h-11 items-center gap-3 rounded-[12px] px-3 py-2 text-[14px] transition-colors duration-[120ms] hover:bg-accent"
                      >
                        <span className="min-w-0 flex-1 truncate font-medium">{canvas.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                          {canvas.updatedLabel}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
              {!data.thumbs.ok && <Unreadable>{HOME_COPY.thumbsUnreadable}</Unreadable>}
              {data.thumbs.ok && data.thumbs.value.length > 0 && (
                <>
                  <p className="mt-6 text-xs text-muted-foreground">{HOME_COPY.recentlyMade}</p>
                  <ul className="mt-2 flex flex-wrap gap-2">
                    {data.thumbs.value.map((thumb) => (
                      <li key={thumb.id}>
                        <Link
                          href={canvasHref(thumb.projectId)}
                          className="block size-20 overflow-hidden rounded-[12px] border border-border bg-muted transition-opacity duration-[120ms] hover:opacity-85"
                          title={thumb.prompt || undefined}
                        >
                          {thumb.kind === "video" ? (
                            <video
                              src={thumb.src}
                              muted
                              playsInline
                              preload="metadata"
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            /* eslint-disable-next-line @next/next/no-img-element */
                            <img
                              src={thumb.src}
                              alt={thumb.prompt || "Something you made"}
                              className="h-full w-full object-cover"
                            />
                          )}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>

        {/* ③ 接下来发什么 —— 有排期才出现;读不出来时**照说读不出来**,不当成「没排期」 */}
        {!data.upcoming.ok && (
          <section>
            <BlockHeading>{HOME_COPY.scheduleHeading}</BlockHeading>
            <Unreadable>{HOME_COPY.scheduleUnreadable}</Unreadable>
          </section>
        )}
        {data.upcoming.ok && data.upcoming.value.length > 0 && (
          <section>
            <BlockHeading>{HOME_COPY.scheduleHeading}</BlockHeading>
            <ul className="mt-3 flex flex-col gap-2">
              {data.upcoming.value.map((post) => (
                <li
                  key={post.id}
                  className="flex items-start gap-3 rounded-[12px] border border-border bg-card px-4 py-3"
                >
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {post.dayLabel}, {post.timeLabel} · {post.channelLabel}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{post.caption}</p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {post.statusLabel}
                  </Badge>
                </li>
              ))}
            </ul>
            {/* 发布状态的实话 —— 逐字来自核心的四句式,这一页不写第二份措辞。 */}
            <p className="mt-3 text-xs text-muted-foreground">{publishCopy.fact}</p>
          </section>
        )}

        {/* ④ 进行中的战役 —— 有战役才出现;读不出来同③,照说读不出来 */}
        {!data.campaigns.ok && (
          <section>
            <BlockHeading>{HOME_COPY.campaignsHeading}</BlockHeading>
            <Unreadable>{HOME_COPY.campaignsUnreadable}</Unreadable>
          </section>
        )}
        {data.campaigns.ok && data.campaigns.value.length > 0 && (
          <section>
            <BlockHeading>{HOME_COPY.campaignsHeading}</BlockHeading>
            <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {data.campaigns.value.map((campaign) => (
                <Card key={campaign.id} className="min-w-0">
                  <CardHeader>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <CardTitle className="truncate">{campaign.name}</CardTitle>
                        <CardDescription className="mt-1 line-clamp-2">{campaign.goal}</CardDescription>
                      </div>
                      <Badge variant={campaign.badge}>{campaign.statusLabel}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="mt-auto">
                    <Button asChild variant="secondary" className="w-full">
                      <Link href={campaign.href}>
                        <Megaphone />
                        {HOME_COPY.openCampaign}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        {/* ⑤ 把 Otto 装备好 —— 只在没做完的时候出现;判不了做完没有时,说自己判不了,
            而不是默认商家还没做(那会对已经教过品牌的商家重弹一次同样的话) */}
        {!data.equipment.ok && (
          <section>
            <BlockHeading>{HOME_COPY.equipmentHeading}</BlockHeading>
            <Unreadable>{HOME_COPY.equipmentUnreadable}</Unreadable>
          </section>
        )}
        {data.equipment.ok && data.equipment.value && (
          <section>
            <BlockHeading>{HOME_COPY.equipmentHeading}</BlockHeading>
            <ul className="mt-3 flex flex-col gap-2">
              {data.equipment.value.map((step) => (
                <li key={step.key}>
                  <Link
                    href={step.href}
                    className="flex items-start gap-3 rounded-[12px] border border-border bg-card px-4 py-3 transition-colors duration-[120ms] hover:bg-accent"
                  >
                    <span
                      aria-hidden
                      className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${
                        step.done ? "border-transparent bg-success-soft text-success-soft-foreground" : "border-border"
                      }`}
                    >
                      {step.done ? <Check className="size-3" /> : null}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-sm font-medium ${step.done ? "text-muted-foreground line-through" : ""}`}>
                        {step.label}
                      </span>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {step.done ? HOME_COPY.stepDone : step.hint}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {/* 「渠道连没连」的实话。发布关着的时候一个账号都连不上,所以这里不画 Connect 按钮
                ——只说事实,而且是核心那一份事实,不是这一页自己写的一句。通电那天这句消失,
                真实的连接状态由 Connections(W2-4)那一面接手,Home 不会留着一句过期的话。 */}
            {!PUBLISHING_AVAILABLE && (
              <p className="mt-3 text-xs text-muted-foreground">{publishCopy.why}</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

export default HomeView;
