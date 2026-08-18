import "server-only";

/**
 * Home 的受控入口 —— 五块数据的**唯一**读取点(换壳规格书 §4.1,W2-6)。
 *
 * 这一票的硬纪律:**一个新数据函数都不写**。下面每一个读取都是今天就在跑的既有函数,
 * 规格书 §4.1 那张表逐行列着它们,`lib/__tests__/home-page.test.ts` 拿那张表逐个来核 ——
 * 这个文件多 import 一个数据源,或少读一个,围栏都会红。
 *
 *   ① 开场      ottoGreetingNameFromProfile / getMyAccount
 *   ② 接着做    getProjects / getRecentGenerationThumbs
 *   ③ 接下来发  listScheduledPosts(+ 核心的 PUBLISH_PREVIEW_COPY,由 HomeView 直接读)
 *   ④ 战役      listCampaigns
 *   ⑤ 装备好    listMemory / listBrandRecords / ottoOnboardingFacts(在 home-data 里)
 *
 * 租户口径:身份只从 `requireOwner()` 来。`getProjects` / `getRecentGenerationThumbs` 收
 * ownerId 参数,传的是它解析出来的那一个;其余几个是 `"use server"` 动作,自己按 session
 * 解析并**忽略**调用方传的 id(见 `listMemory` 的注释),所以两条路都不经过客户端。
 *
 * 每一个读取都自己 `.catch` —— 一次 Prisma 故障会 REJECT 而不是返回 `{error}`,而
 * `Promise.all` 里一个未捕获的 rejection 会把整页带走(#542 的原案)。Home 的一块读不出来
 * 时,该块照实空着,其余四块照常 —— 但**永远不拿一个编出来的数字顶上**。
 */

import { redirect } from "next/navigation";
import { navLinkByKey } from "@fikirtive/core/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getProjects, getRecentGenerationThumbs } from "@/lib/data";
import { getMyAccount } from "@/lib/account-actions";
import { getMyProfileNames } from "@/lib/profile-names";
import { ottoGreetingNameFromProfile } from "@/lib/otto-greeting";
import { listScheduledPosts } from "@/lib/schedule-actions";
import { listCampaigns } from "@/lib/campaign-view-data";
import { listMemory } from "@/lib/memory-actions";
import { listBrandRecords } from "@/lib/brand-record-actions";
import { creditsLabel } from "@/lib/credit-format";
import { MY_DATE_FORMAT } from "@/lib/my-date-format";
import { HomeView } from "./HomeView";
import {
  HOME_CANVAS_LIMIT,
  HOME_THUMB_LIMIT,
  equipmentSteps,
  homeGreeting,
  openCampaigns,
  upcomingPosts,
  upcomingWindow,
  type HomeData,
} from "./home-data";

/** Same "en-MY" date the merchant sees everywhere else, formatted once, server-side
 *  (#949 A5 / #952 item 12 — the timezone pin lives in `MY_DATE_FORMAT`, never re-declared). */
function formatUpdated(date: Date): string {
  if (Number.isNaN(date.getTime())) return "";
  return MY_DATE_FORMAT.format(date);
}

export async function HomeEntry() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;

  const now = new Date();
  const window = upcomingWindow(now);

  const [greetingName, accountResult, projects, thumbs, scheduled, campaignResult, memory, records] =
    await Promise.all([
      // 名字的整个步骤(含它自己的 catch)由这个 helper 收着 —— 见 lib/otto-greeting.ts。
      ottoGreetingNameFromProfile(getMyProfileNames),
      getMyAccount().catch(() => ({ error: "load-failed" }) as const),
      getProjects(ownerId).catch(() => [] as Awaited<ReturnType<typeof getProjects>>),
      getRecentGenerationThumbs(ownerId, HOME_THUMB_LIMIT).catch(
        () => [] as Awaited<ReturnType<typeof getRecentGenerationThumbs>>,
      ),
      listScheduledPosts(window).catch(() => [] as Awaited<ReturnType<typeof listScheduledPosts>>),
      listCampaigns().catch(() => ({ error: "load-failed" }) as const),
      listMemory(ownerId).catch(() => [] as Awaited<ReturnType<typeof listMemory>>),
      listBrandRecords(ownerId).catch(() => [] as Awaited<ReturnType<typeof listBrandRecords>>),
    ]);

  const account = "error" in accountResult ? null : accountResult;
  const billing = navLinkByKey("billing");
  const brand = navLinkByKey("brand");

  const data: HomeData = {
    greeting: homeGreeting(greetingName, now),
    // 余额读不出来时是 null,不是 0 —— 0 是一个关于钱的**主张**,而我们这一刻什么都不知道。
    creditsLabel: account ? creditsLabel(account.balance) : null,
    billingHref: billing.href,
    billingLabel: billing.label,
    canvases: projects.slice(0, HOME_CANVAS_LIMIT).map((project) => ({
      id: project.id,
      name: project.name,
      updatedLabel: formatUpdated(project.updatedAt),
    })),
    thumbs: thumbs.map((thumb) => ({
      id: thumb.id,
      projectId: thumb.projectId,
      src: thumb.src,
      kind: thumb.kind,
      prompt: thumb.prompt,
    })),
    upcoming: upcomingPosts(scheduled),
    campaigns: "error" in campaignResult ? [] : openCampaigns(campaignResult.campaigns),
    equipment: equipmentSteps({
      brandMemoryCount: memory.length,
      productCount: records.filter((record) => record.kind === "product").length,
      brandHref: brand.href,
    }),
  };

  return <HomeView data={data} />;
}
