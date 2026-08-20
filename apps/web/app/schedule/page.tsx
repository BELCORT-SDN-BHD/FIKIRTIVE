import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getEntities, getMyAds, getRecentGenerationThumbs } from "@/lib/data";
import { toEntityDTO } from "@/lib/dto";
import { listBrandRecords } from "@/lib/brand-record-actions";
import { buildStuffItems } from "@/lib/stuff-items";
import { ScheduleSurface } from "@/components/schedule/schedule-surface";

/**
 * Schedule 的真路由(规格书 §4.6)—— 唯一权威日历,原样搬家。
 *
 * 排期本身的数据(`ScheduledPost`、已连账号、发布默认值)是 `OttoSchedule` 自己用
 * owner-scoped server action 客户端读的,这一页不重复读第二遍。这里只备它画缩略图与
 * 选媒体要用的那份 Library 清单 —— 和旧壳一模一样的四个来源、同一个 `buildStuffItems`。
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule · Fikirtive" };

export default async function SchedulePage() {
  const owner = await requireOwner();
  if ("error" in owner) redirect("/login");
  const { ownerId } = owner;

  const [entities, history, ads, records] = await Promise.all([
    getEntities(ownerId),
    getRecentGenerationThumbs(ownerId).catch(() => [] as Awaited<ReturnType<typeof getRecentGenerationThumbs>>),
    getMyAds(ownerId).catch(() => [] as Awaited<ReturnType<typeof getMyAds>>),
    listBrandRecords(ownerId),
  ]);

  const stuffItems = buildStuffItems({ entities: entities.map(toEntityDTO), history, ads, records });
  return <ScheduleSurface stuffItems={stuffItems} />;
}
