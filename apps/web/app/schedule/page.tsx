import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getEntities, getMyAds, getRecentGenerationThumbs } from "@/lib/data";
import { toEntityDTO } from "@/lib/dto";
import { listBrandRecords } from "@/lib/brand-record-actions";
import { buildStuffItems } from "@/lib/stuff-items";
import { ScheduleSurface } from "@/components/schedule/schedule-surface";
import type { StuffItem } from "@/lib/stuff-items";

/**
 * Schedule 的真路由(规格书 §4.6)—— 唯一权威日历,原样搬家。
 *
 * 排期本身的数据(`ScheduledPost`、已连账号、发布默认值)是 `OttoSchedule` 自己用
 * owner-scoped server action 客户端读的,这一页不重复读第二遍。这里只备它画缩略图与
 * 选媒体要用的那份 Library 清单 —— 和旧壳一模一样的四个来源、同一个 `buildStuffItems`。
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "Schedule · Fikirtive" };

function first(value: string | string[] | undefined): string | undefined { return Array.isArray(value) ? value[0] : value; }
const FIXTURE_STUFF: StuffItem[] = [1, 2, 3, 4].map((value) => ({ id: `fixture-${value}`, source: "gen", label: `Fixture media ${value}`, url: `/fixtures/r22-canvas/art-${value}.jpg`, mediaKind: "image", generationId: `fixture-asset-${value}`, projectId: "fixture-raya", assetId: `fixture-asset-${value}` }));

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> } = { searchParams: Promise.resolve({}) }) {
  const params = await searchParams;
  const fixture = process.env.NODE_ENV !== "production" && first(params.fixture) === "r22";
  const openComposer = first(params.compose) === "new";
  if (fixture) {
    const requestedState = first(params.state);
    const fixtureState = requestedState === "loading" || requestedState === "error" || requestedState === "permission" || requestedState === "empty" || requestedState === "unknown" ? requestedState : "ready";
    const requestedOutcome = first(params.outcome);
    const fixtureOutcome = requestedOutcome === "error" || requestedOutcome === "permission" || requestedOutcome === "unknown" ? requestedOutcome : "success";
    return <ScheduleSurface key={openComposer ? "composer-open" : "composer-closed"} stuffItems={FIXTURE_STUFF} fixture openComposer={openComposer} fixtureState={fixtureState} fixtureOutcome={fixtureOutcome} />;
  }
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
  return <ScheduleSurface key={openComposer ? "composer-open" : "composer-closed"} stuffItems={stuffItems} openComposer={openComposer} />;
}
