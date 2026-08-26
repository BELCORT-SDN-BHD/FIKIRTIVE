/**
 * library-fixture.ts —— Library 这一面的**数据与规则**,一个 React 节点都没有。
 *
 * 为什么单独一个文件:这一面从「一页网格」长成了工作台(左二级导航、按日分组、多选批量、
 * 素材包、上传、单图详情)。把事实与画法写在一起,画法每改一次都要重读一遍数据,而
 * `otto-pronoun-consistency` 的变体扫描也会因为条件分支暴涨直接撞上 64 的上限
 * (`R22CanvasSurface` 等四面正是这样被迫上豁免板的)。
 *
 * 这里每一条都是 fixture:零后端、零 provider、零积分。屏幕上出现的每一个数字都指得出
 * 出处 —— 没有一处硬写的「12 items」。
 */

import { canvasHref } from "@/components/canvas/canvas-href";

export type LibraryAssetKind = "image" | "video";

/** 这一件东西是做出来的,还是商家自己传上来的。上传物没有 prompt,详情层如实说。 */
export type LibraryAssetSource = "made" | "uploaded";

export type LibraryAsset = {
  id: string;
  /** 网格里画的那一帧。视频在这里也是一张封面帧 —— 仓库里没有视频 fixture 文件,
   *  与其塞一个播不出来的 src,不如老实画我们真的有的那一帧。 */
  poster: string;
  kind: LibraryAssetKind;
  /** 商家读到的名字。生成物用它的 prompt 起的短名,上传物用文件名。 */
  name: string;
  createdAt: string;
  starred: boolean;
  source: LibraryAssetSource;
  /** 视频才有,写在封面帧角上。 */
  duration?: string;
  /** 生成物才有。上传物这一栏在详情层写「Uploaded by you」。 */
  prompt?: string;
  /** 来源项目 —— 详情层那条「Made in Raya launch」回链就指它。 */
  projectId?: string;
  projectName?: string;
  packIds: string[];
  /** 从 Library 收起来了。不是删除:东西还在它被做出来的那张画布上。 */
  hidden?: boolean;
};

/** 人工策展的合集。商家话术叫「asset pack」,不叫 collection/folder。 */
export type LibraryPack = { id: string; name: string };

export type LibraryArchive = { assets: LibraryAsset[]; packs: LibraryPack[] };

/**
 * 存档键。
 *
 * v1 存的是一个 `{ items, filter, query }` 的老网格状态,与这一版的 `{ assets, packs }`
 * 不是同一个形状。照 approvals(`fikirtive.r22.approvals.state.v2`,commit f0b7dc9b)的成例
 * **升版而不迁移**:旧档读不到就当没有,直接重新播种 —— 一份浏览器会话里的样张不值得为它
 * 写一条会长期活着的迁移代码。
 */
export const LIBRARY_FIXTURE_KEY = "fikirtive.r22.library.state.v2";

/**
 * 单个上传文件的上限。
 *
 * sessionStorage 一个源大约只有 5MB,而 data URL 比原文件还要大三分之一。超了就当场说不行,
 * 不假装成功再在下一次刷新时静静消失 —— 那才是商家最恨的那种谎。
 */
export const UPLOAD_BUDGET_BYTES = 1_500_000;

/** 上限的人话说法,只有这一处,提示与测试共用。 */
export const UPLOAD_BUDGET_LABEL = "1.5 MB";

const ART = (index: number) => `/fixtures/r22-canvas/art-${index}.jpg`;

/** 三天、三个项目、十三件东西 —— 按日分组要看得出「组」,所以不是一天全塞完。 */
export const LIBRARY_SEED_ASSETS: LibraryAsset[] = [
  { id: "lib-1", poster: ART(1), kind: "image", name: "Raya table setting", createdAt: "2026-08-24T09:20:00.000Z", starred: false, source: "made", prompt: "A Raya table with a teal batik runner, morning light from the left", projectId: "fixture-raya", projectName: "Raya launch", packIds: ["pack-raya"] },
  { id: "lib-2", poster: ART(2), kind: "image", name: "Raya hero, teal batik", createdAt: "2026-08-24T09:05:00.000Z", starred: true, source: "made", prompt: "Teal batik candle on a rattan tray, soft shadow, square crop", projectId: "fixture-raya", projectName: "Raya launch", packIds: ["pack-raya"] },
  { id: "lib-3", poster: ART(3), kind: "video", duration: "6s", name: "Raya opening clip", createdAt: "2026-08-24T08:40:00.000Z", starred: false, source: "made", prompt: "Slow push in on the Raya table, six seconds, no text", projectId: "fixture-raya", projectName: "Raya launch", packIds: [] },
  { id: "lib-4", poster: ART(4), kind: "image", name: "Raya gift box", createdAt: "2026-08-24T08:10:00.000Z", starred: false, source: "made", prompt: "Wrapped gift box beside two candles, warm side light", projectId: "fixture-raya", projectName: "Raya launch", packIds: ["pack-raya"] },
  { id: "lib-5", poster: ART(1), kind: "image", name: "Shopfront photo", createdAt: "2026-08-24T07:30:00.000Z", starred: false, source: "uploaded", packIds: [] },
  { id: "lib-6", poster: ART(2), kind: "image", name: "Pandan candle, close up", createdAt: "2026-08-23T11:15:00.000Z", starred: false, source: "made", prompt: "Close up of the pandan candle, wick trimmed, plain background", projectId: "fixture-candle", projectName: "Candle care", packIds: ["pack-candle"] },
  { id: "lib-7", poster: ART(3), kind: "image", name: "Wick trim tip", createdAt: "2026-08-23T10:50:00.000Z", starred: true, source: "made", prompt: "A hand trimming a candle wick to 5mm, overhead", projectId: "fixture-candle", projectName: "Candle care", packIds: ["pack-candle"] },
  { id: "lib-8", poster: ART(4), kind: "image", name: "Candle care set", createdAt: "2026-08-23T10:05:00.000Z", starred: false, source: "made", prompt: "The three care tools laid out on linen", projectId: "fixture-candle", projectName: "Candle care", packIds: ["pack-candle"] },
  { id: "lib-9", poster: ART(1), kind: "video", duration: "9s", name: "Candle pour clip", createdAt: "2026-08-23T09:25:00.000Z", starred: false, source: "made", prompt: "Pouring soy wax into a glass jar, nine seconds", projectId: "fixture-candle", projectName: "Candle care", packIds: [] },
  { id: "lib-10", poster: ART(2), kind: "image", name: "Market stall, morning", createdAt: "2026-08-21T02:40:00.000Z", starred: false, source: "made", prompt: "The Bangsar market stall at 10 in the morning", projectId: "fixture-market", projectName: "Weekend market", packIds: [] },
  { id: "lib-11", poster: ART(3), kind: "image", name: "Market table", createdAt: "2026-08-21T02:20:00.000Z", starred: false, source: "made", prompt: "Candles arranged on the market table, top down", projectId: "fixture-market", projectName: "Weekend market", packIds: [] },
  { id: "lib-12", poster: ART(4), kind: "image", name: "Market crowd", createdAt: "2026-08-21T02:00:00.000Z", starred: true, source: "made", prompt: "People at the stall, faces away from camera", projectId: "fixture-market", projectName: "Weekend market", packIds: [] },
  { id: "lib-13", poster: ART(1), kind: "image", name: "Market sign", createdAt: "2026-08-21T01:35:00.000Z", starred: false, source: "uploaded", packIds: [] },
];

export const LIBRARY_SEED_PACKS: LibraryPack[] = [
  { id: "pack-raya", name: "Raya assets" },
  { id: "pack-candle", name: "Candle care assets" },
];

export function seedLibraryArchive(): LibraryArchive {
  return { assets: LIBRARY_SEED_ASSETS.map((asset) => ({ ...asset, packIds: [...asset.packIds] })), packs: LIBRARY_SEED_PACKS.map((pack) => ({ ...pack })) };
}

function validArchive(value: unknown): value is LibraryArchive {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LibraryArchive>;
  if (!Array.isArray(candidate.assets) || !Array.isArray(candidate.packs)) return false;
  return candidate.assets.every((asset) => typeof asset?.id === "string" && typeof asset?.poster === "string" && Array.isArray(asset?.packIds));
}

/** 读存档。读不到、读坏了、读到旧版形状 —— 一律回种子,不回放半份旧档。 */
export function readLibraryArchive(key: string): LibraryArchive {
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return seedLibraryArchive();
    const parsed = JSON.parse(raw) as unknown;
    return validArchive(parsed) ? parsed : seedLibraryArchive();
  } catch {
    return seedLibraryArchive();
  }
}

/** 写存档。写不进去要说得出来 —— 上传那条路上就靠这个返回值决定说不说实话。 */
export function writeLibraryArchive(key: string, archive: LibraryArchive): boolean {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(archive));
    return true;
  } catch {
    return false;
  }
}

/* ── 视图规则 ─────────────────────────────────────────────────────────────────── */

export type LibrarySection = "all" | "starred" | "uploads" | `pack:${string}`;
export type LibraryTypeFilter = "all" | "image" | "video";
export type LibrarySort = "newest" | "oldest";
export type LibraryLayout = "grid" | "list";

export function packIdOf(section: LibrarySection): string | null {
  return section.startsWith("pack:") ? section.slice(5) : null;
}

function matchesSection(asset: LibraryAsset, section: LibrarySection): boolean {
  if (section === "all") return true;
  if (section === "starred") return asset.starred;
  if (section === "uploads") return asset.source === "uploaded";
  return asset.packIds.includes(section.slice(5));
}

export function visibleLibraryAssets(
  assets: LibraryAsset[],
  { section, type, query, sort }: { section: LibrarySection; type: LibraryTypeFilter; query: string; sort: LibrarySort },
): LibraryAsset[] {
  const term = query.trim().toLowerCase();
  const rows = assets.filter((asset) => {
    if (asset.hidden) return false;
    if (!matchesSection(asset, section)) return false;
    if (type !== "all" && asset.kind !== type) return false;
    if (!term) return true;
    return `${asset.name} ${asset.prompt ?? ""} ${asset.projectName ?? ""}`.toLowerCase().includes(term);
  });
  return rows.sort((a, b) => (sort === "newest" ? b.createdAt.localeCompare(a.createdAt) : a.createdAt.localeCompare(b.createdAt)));
}

export type LibraryDayGroup = { key: string; label: string; assets: LibraryAsset[] };

/** 组头写「24 Aug」—— 与卡上的日期同一个说法,不是两套。 */
export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function groupLibraryByDay(assets: LibraryAsset[]): LibraryDayGroup[] {
  const groups: LibraryDayGroup[] = [];
  for (const asset of assets) {
    const key = asset.createdAt.slice(0, 10);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.assets.push(asset);
    else groups.push({ key, label: dayLabel(asset.createdAt), assets: [asset] });
  }
  return groups;
}

/** 一张画布的地址。fixture 与生产走同一个函数,免得两处各写一份。 */
export function libraryCanvasHref(projectId: string, fixture: boolean): string {
  return fixture ? `/create/canvas?project=${encodeURIComponent(projectId)}&fixture=r22` : canvasHref(projectId);
}

/** 上传物的名字:去掉扩展名,不给商家看 `.png`。 */
export function uploadDisplayName(fileName: string): string {
  const trimmed = fileName.replace(/\.[a-z0-9]+$/i, "").trim();
  return trimmed || "Uploaded picture";
}
