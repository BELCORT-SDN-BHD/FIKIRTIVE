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
  /**
   * 这一张是从哪一张改出来的(单图编辑做出来的那一条才有)。
   *
   * 存 id **和**名字两样:id 是回链要走的路,名字是商家读的那一句「Edited from Raya hero」。
   * 只存 id,详情层就得回头去库里翻名字 —— 而原图可能已经被商家从库里收起来了,那一句
   * 就会当场变成一串编号。
   */
  editedFromId?: string;
  editedFromName?: string;
};

/** 人工策展的合集。商家话术叫「asset pack」,不叫 collection/folder。 */
export type LibraryPack = { id: string; name: string };

export type LibraryArchive = { assets: LibraryAsset[]; packs: LibraryPack[] };

/**
 * Quick create(仓库里的快产车间)做出来的东西归哪个项目。
 *
 * 它是**一个真的项目**,不是一个特例标记:卡上的来源行、左导航 PROJECTS 那一节、
 * 详情层的「Open in canvas」、通知里的「Continue in Canvas」—— 四处读的都是同一个
 * projectId,所以四处的行为天生一致,不用各写一条 if。
 */
export const QUICK_CREATE_PROJECT_ID = "fixture-quick-create";
export const QUICK_CREATE_PROJECT_NAME = "Quick create";

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

/** 仓库里真的有的那四张样张。种子、Quick create 的成品,都只从这一份里取。 */
export const FIXTURE_ART_SOURCES = [1, 2, 3, 4].map((index) => `/fixtures/r22-canvas/art-${index}.jpg`);

const ART = (index: number) => FIXTURE_ART_SOURCES[index - 1]!;

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

export type LibrarySection = "all" | "starred" | "made" | "uploads" | `pack:${string}` | `project:${string}`;
export type LibraryTypeFilter = "all" | "image" | "video";
export type LibrarySort = "newest" | "oldest";
export type LibraryLayout = "grid" | "list";

export function packIdOf(section: LibrarySection): string | null {
  return section.startsWith("pack:") ? section.slice(5) : null;
}

export function projectIdOf(section: LibrarySection): string | null {
  return section.startsWith("project:") ? section.slice(8) : null;
}

function matchesSection(asset: LibraryAsset, section: LibrarySection): boolean {
  if (section === "all") return true;
  if (section === "starred") return asset.starred;
  if (section === "made") return asset.source === "made";
  if (section === "uploads") return asset.source === "uploaded";
  if (section.startsWith("project:")) return asset.projectId === section.slice(8);
  return asset.packIds.includes(section.slice(5));
}

/**
 * 左导航中段那一节 —— **自动**从东西本身长出来的项目列表,零手动整理。
 *
 * 为什么不做成一张手写的项目表:那张表一定会和真实存在的东西漂移(项目改名、项目里
 * 一件东西都不剩、画布刚在一个新项目里做出第一批)。按资产自己带的来源现算,这三件事
 * 一件都不用管。顺序按「这个项目里最新的那一件」排:刚做过东西的项目自然浮到上面。
 */
export function libraryProjects(assets: LibraryAsset[]): Array<{ id: string; name: string; count: number }> {
  const rows = new Map<string, { id: string; name: string; count: number; latest: string }>();
  for (const asset of assets) {
    if (asset.hidden || !asset.projectId) continue;
    const found = rows.get(asset.projectId);
    if (found) {
      found.count += 1;
      if (asset.createdAt > found.latest) found.latest = asset.createdAt;
    } else {
      rows.set(asset.projectId, { id: asset.projectId, name: asset.projectName ?? asset.projectId, count: 1, latest: asset.createdAt });
    }
  }
  return [...rows.values()]
    .sort((a, b) => b.latest.localeCompare(a.latest))
    .map(({ id, name, count }) => ({ id, name, count }));
}

/* ── 往存档里写东西(画布与 Quick create 共用这三条) ───────────────────────── */

/**
 * 把新做出来的东西放进存档。**幂等靠 `id`**:同一批渲染两次、同一次生成被回放一次,
 * 商家的库里都不该多出一张一样的图。
 *
 * 新的排在最前面,与上传那条路一致 —— 刚做出来的东西该在第一屏。
 */
export function addLibraryAssets(archive: LibraryArchive, assets: LibraryAsset[]): LibraryArchive {
  const known = new Set(archive.assets.map((asset) => asset.id));
  const fresh = assets.filter((asset) => !known.has(asset.id));
  if (!fresh.length) return archive;
  return { ...archive, assets: [...fresh, ...archive.assets] };
}

/** 把几件东西挂进一个素材包。已经在包里的原样不动 —— 多按一下不该在包里多出一张。 */
export function attachToPack(archive: LibraryArchive, assetIds: string[], packId: string): LibraryArchive {
  const wanted = new Set(assetIds);
  return {
    ...archive,
    assets: archive.assets.map((asset) =>
      wanted.has(asset.id) && !asset.packIds.includes(packId) ? { ...asset, packIds: [...asset.packIds, packId] } : asset,
    ),
  };
}

/** 新包的 id。重名会撞成同一个 id,所以撞上了就往后编号 —— 两个包不能是同一个包。 */
export function newPackId(name: string, packs: LibraryPack[]): string {
  const base = `pack-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
  if (base === "pack-") return `pack-${packs.length + 1}`;
  if (!packs.some((pack) => pack.id === base)) return base;
  let suffix = 2;
  while (packs.some((pack) => pack.id === `${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/**
 * 一张画布成品在 Library 里长什么样。
 *
 * `id` 带上项目 —— 两块板上的「Image 1」不是同一张图,不带项目就会被幂等那一条误判成
 * 同一件东西,后来的那张从此进不了库。
 */
export function canvasLibraryAsset(input: {
  projectId: string;
  projectName: string;
  artId: string;
  name: string;
  src: string;
  prompt?: string;
  createdAt?: string;
}): LibraryAsset {
  return {
    id: `canvas:${input.projectId}:${input.artId}`,
    poster: input.src,
    kind: "image",
    name: input.name,
    createdAt: input.createdAt ?? new Date().toISOString(),
    starred: false,
    source: "made",
    prompt: input.prompt,
    projectId: input.projectId,
    projectName: input.projectName,
    packIds: [],
  };
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

/* ── Quick create:太含糊的时候先问一句 ─────────────────────────────────────── */

export type QuickCreateQuestion = {
  header: string;
  question: string;
  help: string;
  options: Array<{ label: string; description: string }>;
};

/**
 * 「一句话太含糊」长什么样。
 *
 * 这一条不是为了拦人,是为了不拿商家的钱去赌:同一句「make me something nice」有三四个
 * 都说得通的方向,直接开跑就是四张全不对,还是收了钱的四张。所以先问一句 —— 而且**问的
 * 时候一分钱都不动**:等待不扣 cr,报价原样冻在那儿。
 *
 * 判词只有两条,都机械可判:
 *   ① 实词少于四个 —— 「a poster」「make something」这种,缺的是内容不是措辞;
 *   ② 命中含糊词族 —— 「something / anything / nice / better / cool / surprise me …」,
 *      句子再长也没有说出要做什么东西。
 * 两条都不中就直接开跑:商家已经说清楚了,再问一句就是拖时间。
 */
const QUICK_CREATE_VAGUE = /\b(something|anything|whatever|stuff|nice|nicer|better|best|cool|pretty|beautiful|amazing|awesome|surprise me|you decide|up to you)\b/i;

/**
 * 含糊词族的**唯一出处**。建项目那个对话框(`components/projects/project-start.ts`)问的
 * 是别的事,用的却必须是同一份词族 —— 两处各写一份正则,同一句「make something nice」
 * 迟早在一面被拦下、在另一面直接开跑,而且两边谁都不会报错。
 */
export function isVagueCreationRequest(text: string): boolean {
  return QUICK_CREATE_VAGUE.test(text);
}

export function quickCreateQuestion(prompt: string): QuickCreateQuestion | null {
  const words = prompt.trim().split(/\s+/).filter((word) => /[a-z0-9]/i.test(word));
  if (words.length >= 4 && !isVagueCreationRequest(prompt)) return null;
  return {
    header: "Before Otto starts",
    question: "What should this be for?",
    help: "Pick one so the first try is close. Answering costs nothing, and the price below stays exactly where it is.",
    options: [
      { label: "A product shot", description: "One product, clean background, ready for a feed post" },
      { label: "A lifestyle scene", description: "The product in use, with a room or table around it" },
      { label: "A promotion graphic", description: "Room left over the picture for a price or an offer" },
    ],
  };
}

/** Quick create 做出来的一件东西。名字是商家读的,所以用他那句话起,不用一串编号。 */
export function quickCreateAsset(input: {
  runId: string;
  index: number;
  prompt: string;
  kind: LibraryAssetKind;
  duration?: string;
  createdAt?: string;
}): LibraryAsset {
  return {
    id: `quick:${input.runId}:${input.index}`,
    poster: FIXTURE_ART_SOURCES[input.index % FIXTURE_ART_SOURCES.length]!,
    kind: input.kind,
    duration: input.kind === "video" ? input.duration : undefined,
    name: quickCreateName(input.prompt, input.index),
    createdAt: input.createdAt ?? new Date().toISOString(),
    starred: false,
    source: "made",
    prompt: input.prompt,
    projectId: QUICK_CREATE_PROJECT_ID,
    projectName: QUICK_CREATE_PROJECT_NAME,
    packIds: [],
  };
}

/* ── 单图编辑:从一张改出下一张 ─────────────────────────────────────────────── */

/**
 * 商家读得到的六个风格预设。形状照 Magnific 的 Restyling:一个色块示意 + 一个短名 ——
 * 短名本身就是商家会说的那句话("Warmer light"),所以它同时也是落进新名字里的那半句。
 *
 * 色块是 CSS 画的(`r22-image-edit.css` 里按 `data-preset` 上色),不是图片:这里不新增
 * 一个二进制资产,也不拿一张真照片去暗示「按下去会变成这样」。
 */
export const IMAGE_EDIT_PRESETS: ReadonlyArray<{ id: string; label: string; hint: string }> = [
  { id: "warmer-light", label: "Warmer light", hint: "Golden, late afternoon" },
  { id: "brighter", label: "Brighter", hint: "Lift the whole picture" },
  { id: "studio-backdrop", label: "Studio backdrop", hint: "Plain sweep behind it" },
  { id: "batik-pattern", label: "Batik pattern", hint: "Teal batik cloth under it" },
  { id: "festive-glow", label: "Festive glow", hint: "Warm lights around it" },
  { id: "black-and-white", label: "Black and white", hint: "No colour at all" },
];

/** 改动那句话的短名 → id 的一截。同一张图上同一句改动只会得到同一个 id,幂等靠它。 */
function editSlug(change: string): string {
  return change.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "edit";
}

/**
 * 改出来的那一条长什么样。
 *
 * 三件事是刻意的:
 *   ① **原图一动不动** —— 这是新的一条,不是覆盖。商家改坏了,原来那张还在。
 *   ② **id 里带着原图与那句改动**(`edit:<原图 id>:<改动>`),所以同一张图上按两次同一个
 *      预设,库里只会有一条 —— 幂等是 `addLibraryAssets` 按 id 判的,不需要第二套去重。
 *   ③ **名字是原名加那半句**(「Raya hero, teal batik — Warmer light」),商家在网格里
 *      一眼看得出这是哪一张的哪一版,不用点开。
 *
 * 缩略图仍然是原图那一张:这一面是样机,真的改图还没接上。屏幕上那句诚实话由编辑层自己
 * 说出来,这里不拿另一张不相干的样张冒充「改完的样子」。
 */
export function editedLibraryAsset(input: { source: LibraryAsset; change: string; createdAt?: string }): LibraryAsset {
  const change = input.change.trim();
  return {
    id: `edit:${input.source.id}:${editSlug(change)}`,
    poster: input.source.poster,
    kind: "image",
    name: `${input.source.name} — ${change}`,
    createdAt: input.createdAt ?? new Date().toISOString(),
    starred: false,
    source: "made",
    prompt: change,
    projectId: input.source.projectId,
    projectName: input.source.projectName,
    packIds: [],
    editedFromId: input.source.id,
    editedFromName: input.source.name,
  };
}

/** 一张图已经改出过哪几版。旧的在前 —— 版本条从「Original」往后读,时间也该往后走。 */
export function editedVersionsOf(assets: LibraryAsset[], sourceId: string): LibraryAsset[] {
  return assets
    .filter((asset) => asset.editedFromId === sourceId && !asset.hidden)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** 「Teal batik candle on a tray」→「Teal batik candle 1」。太长的截断,不给商家读一整段。 */
export function quickCreateName(prompt: string, index: number): string {
  const words = prompt.trim().split(/\s+/).filter(Boolean).slice(0, 4).join(" ");
  const short = words.length > 40 ? `${words.slice(0, 40).trim()}…` : words;
  return `${short || "Quick create"} ${index + 1}`;
}
