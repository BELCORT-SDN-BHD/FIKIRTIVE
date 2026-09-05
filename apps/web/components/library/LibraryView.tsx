"use client";

/**
 * `/library` —— 商家的素材库,按**已批准的 Library 设计**画
 * (`design-system/patterns/library/`:README 是业务权威,`LibraryReference.tsx` 是视觉与
 *  交互权威,`backend-handoff-contract.md` 是接线权威)。规格:`docs/specs/frontend-baseline.md`
 * §7.1 段②「对齐轮」。
 *
 * 这一轮只接**现在就存在**的读取路径:生成历史、上传、Elements(含演员库)。设计里有、
 * 后端今天没有对象的控件(Favorites 与 Collections 两个页签、选择模式与它的批量动作、
 * Upload files、Chat 筛选、按名字排序)**一个都不画** —— 前端规则第①条:没有真实能力的
 * 按钮不出现,PR 描述里逐条登记为「设计有、生产暂不显示」。
 *
 * 四态全部由服务器真相驱动(规格 §1 九问3):
 *   · 每一次页签、搜索、筛选、排序改变都**重新向服务器要第一页**,不在浏览器里过滤已加载
 *     的那几条 —— 筛选必须作用于完整结果集(backend-handoff-contract.md §8.3①);
 *   · 迟到的旧请求按序号丢弃,不许把上一组条件的结果画成这一组的成功结果;
 *   · 「加载更多」只按同一组条件取下一页,并按 stable id 去重(§8.3②);
 *   · 读失败就说读失败并给重试,不画成空库。
 *
 * 素材点开走**现有**的资产详情面(`components/asset/DetailPanel`),本票一行没碰它:
 * 收藏、下载、重做、动画那一整套花钱与不花钱的动作都还在它自己的权威里。
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import * as React from "react";
import {
  ArrowDownUp,
  CalendarDays,
  ChevronDown,
  FolderPlus,
  Heart,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";

import { OFFICIAL_CATALOG_BADGE } from "@fikirtive/core/entity-policy";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import DetailPanel from "@/components/asset/DetailPanel";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/design-system/primitives/alert-dialog";
import { Badge } from "@/design-system/primitives/badge";
import { Button, buttonVariants } from "@/design-system/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/design-system/primitives/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/design-system/primitives/dropdown-menu";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/design-system/primitives/input-group";
import { Tabs, TabsList, TabsTrigger } from "@/design-system/primitives/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/design-system/primitives/toggle-group";
import { CollectionDialogs } from "@/components/library/CollectionDialogs";
import { CollectionsView } from "@/components/library/CollectionsView";
import { GridSkeleton, MediaGrid } from "@/components/library/MediaGrid";
import { restoreGeneration, softDeleteEntity } from "@/lib/actions";
import { getGenerationHistory, type LibraryItem, type LibrarySourceKind } from "@/lib/library-actions";
import {
  LIBRARY_ELEMENT_VIEWS,
  parseLibraryElementView,
  type LibraryElement,
  type LibraryElementKind,
} from "@/lib/library-elements-model";
import {
  listLibraryFavorites,
  setLibraryFavorite,
} from "@/lib/library-favorites";
import type { LibraryFavoriteItem, LibrarySubjectRef } from "@/lib/library-types";
import {
  LIBRARY_VIEWS,
  libraryCardBaseTitle,
  libraryDetailIdFromPath,
  librarySinceForDateFilter,
  parseLibraryView,
  type LibraryTimeZone,
  type LibraryView as LibraryViewName,
} from "@/lib/library-view-model";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";
import { cn } from "@/lib/utils";

type MediaFilter = "all" | "image" | "video";

type DateFilter = "all" | "today" | "week";
type SortOrder = "newest" | "oldest";

/**
 * 大写写在文案里,不是写在 `text-transform` 上(#739 围栏
 * `__tests__/form-control-names-and-casing.test.ts`,它连注释里的那个类名都不放过)。
 * 已批准的夹具把小写值交给 CSS 去改大小写;那在生产里会让读屏与自动化读到 "videos",
 * 而屏幕上写着 "Videos" —— 同一句话两个版本。屏幕上的字与夹具逐字一致,
 * 只是这一份是真的写下来的。
 */
const MEDIA_FILTERS = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" },
] as const satisfies readonly { value: MediaFilter; label: string }[];

const DATE_LABELS: Record<DateFilter, string> = {
  all: "Any time",
  today: "Today",
  week: "Last 7 days",
};
/** 设计的排序菜单有四项;按名字排的两项在生产里没有对应的列,所以只剩这两项。 */
const SORT_LABELS: Record<SortOrder, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
};

const PAGE_SIZE = 40;

/**
 * 日界用哪个时区(见 `lib/library-view-model.ts` 的 `LibraryTimeZone`)。
 *
 * 一个永远不变的 store:服务端渲染那一帧拿 `"UTC"`(服务端不知道浏览器在哪),hydration
 * 之后拿浏览者自己的时区。`useSyncExternalStore` 是 React 处理「服务端与客户端第一帧本来
 * 就不同」的正规写法(与 `components/theme-toggle.tsx` 同一个套路):需要对上的那一帧两端
 * 都拿 `"UTC"`,之后立刻换成真时区重画一次,不会 hydration mismatch。
 */
const NEVER_CHANGES = () => () => {};
const SERVER_TIME_ZONE = (): LibraryTimeZone => "UTC";
/**
 * 浏览者自己的时区。每次现问,不缓存:同一个浏览器每次都答同一个字符串,`useSyncExternalStore`
 * 要的快照稳定性照样成立(它按 Object.is 比),而模块级缓存会把**第一次**问到的时区焊死 ——
 * 那正是围栏钉不住的那种写法。
 */
const VIEWER_TIME_ZONE = (): LibraryTimeZone => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * 看的是库里的东西,还是回收站里的(清单 B3 / P1-007)。
 *
 * 删除历来就是软删(`lib/actions.deleteGeneration` 写 `deletedAt`),只是商家侧从来没有一扇
 * 门看得见那些行,于是详情面把一次可撤销的动作说成 "This cannot be undone."。这个开关就是
 * 那扇门:同一张网格、同一组筛选、同一套分页,只是 `deletedAt` 那一列反过来读。
 */
type ShowFilter = "library" | "trash";

type Filters = {
  query: string;
  media: MediaFilter;
  projectId: string;
  date: DateFilter;
  sources: LibrarySourceKind[];
  sort: SortOrder;
  show: ShowFilter;
};

const DEFAULT_FILTERS: Filters = {
  query: "",
  media: "all",
  projectId: "all",
  date: "all",
  sources: ["generated", "upload"],
  sort: "newest",
  show: "library",
};

function filtersAreDefault(filters: Filters): boolean {
  return (
    filters.query.trim() === "" &&
    filters.media === "all" &&
    filters.projectId === "all" &&
    filters.date === "all" &&
    filters.sources.length === 2 &&
    filters.sort === "newest" &&
    filters.show === "library"
  );
}

function FilterButton({ children, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <Button {...props} variant="outline" size="sm" className="gap-1.5 bg-card font-medium shadow-none">
      {children}
      <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden />
    </Button>
  );
}

function LibraryToolbar({
  filters,
  projects,
  onChange,
  onClear,
  showFilters,
  canSelect,
  selectionMode,
  onSelectionModeChange,
}: {
  filters: Filters;
  projects: readonly { id: string; name: string }[];
  onChange: (next: Partial<Filters>) => void;
  onClear: () => void;
  /** 收藏页没有搜索 / 筛选 / 排序的服务端契约,那几颗控件在那一格不渲染。 */
  showFilters: boolean;
  /** 回收站里没有可做的批量动作,所以只有 Select 那一颗不画 —— 工具条本身留着。 */
  canSelect: boolean;
  selectionMode: boolean;
  onSelectionModeChange: (selectionMode: boolean) => void;
}) {
  const sourceFilterCount = 2 - filters.sources.length;
  const activeProject = projects.find((project) => project.id === filters.projectId);

  return (
    <div data-library-toolbar className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
      {showFilters ? (
        <>
      <InputGroup className="min-h-9 min-w-52 max-w-80 flex-1 bg-background shadow-none">
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          aria-label={`Search ${PRODUCT_VOCABULARY.library}`}
          value={filters.query}
          onChange={(event) => onChange({ query: event.target.value })}
          // 占位符只承诺服务端真的会打的那几列。今天是两列:引擎产物的提示词,与商家上传时
          // 自己那个文件名(`getGenerationHistory` 的 OR)。设计的占位符还提到 Canvas ——
          // 那一列今天搜不了,照抄就是一次做不到的承诺(Founder 2026-09-05 裁:如实写两列)。
          placeholder="Search prompts or file names"
          className="h-9 text-sm"
        />
      </InputGroup>

      <ToggleGroup
        type="single"
        value={filters.media}
        onValueChange={(value) => { if (value) onChange({ media: value as MediaFilter }); }}
        variant="default"
        size="sm"
        className="rounded-lg bg-muted p-0.5"
      >
        {MEDIA_FILTERS.map((filter) => (
          <ToggleGroupItem
            key={filter.value}
            value={filter.value}
            className={cn(
              "h-8 rounded-[8px] px-3 text-xs text-muted-foreground shadow-none",
              "data-pressed:bg-card data-pressed:text-foreground data-pressed:shadow-xs",
            )}
          >
            {filter.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {projects.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<FilterButton>{activeProject ? activeProject.name : PRODUCT_VOCABULARY.canvas}</FilterButton>}
          />
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={filters.projectId}
              onValueChange={(value) => onChange({ projectId: value })}
            >
              <DropdownMenuLabel>{`Source ${PRODUCT_VOCABULARY.canvas}`}</DropdownMenuLabel>
              <DropdownMenuRadioItem value="all">All canvases</DropdownMenuRadioItem>
              {projects.map((project) => (
                <DropdownMenuRadioItem key={project.id} value={project.id}>
                  {project.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<FilterButton><CalendarDays aria-hidden />{DATE_LABELS[filters.date]}</FilterButton>}
        />
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={filters.date}
            onValueChange={(value) => onChange({ date: value as DateFilter })}
          >
            <DropdownMenuLabel>Date created</DropdownMenuLabel>
            <DropdownMenuRadioItem value="all">Any time</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="today">Today</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="week">Last 7 days</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <FilterButton>
              <SlidersHorizontal aria-hidden />
              More filters{sourceFilterCount ? ` · ${sourceFilterCount}` : ""}
            </FilterButton>
          }
        />
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Source</DropdownMenuLabel>
            <DropdownMenuCheckboxItem
              checked={filters.sources.includes("generated")}
              onCheckedChange={(checked) => onChange({
                sources: checked
                  ? [...new Set([...filters.sources, "generated" as const])]
                  : filters.sources.filter((source) => source !== "generated"),
              })}
            >Generated</DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={filters.sources.includes("upload")}
              onCheckedChange={(checked) => onChange({
                sources: checked
                  ? [...new Set([...filters.sources, "upload" as const])]
                  : filters.sources.filter((source) => source !== "upload"),
              })}
            >Uploads</DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          {/* 回收站(清单 B3 / P1-007)。已批准的 Library 只有五个一级 views,所以这里
              **不加第六个页签** —— 回收站是同一张生成历史网格的一个筛选,与 Source 并列。 */}
          <DropdownMenuRadioGroup
            value={filters.show}
            onValueChange={(value) => onChange({ show: value as ShowFilter })}
          >
            <DropdownMenuLabel>Show</DropdownMenuLabel>
            <DropdownMenuRadioItem value="library">In library</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="trash">Trash</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onClear}>Clear filters</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger
          render={<FilterButton><ArrowDownUp aria-hidden />{SORT_LABELS[filters.sort]}</FilterButton>}
        />
        <DropdownMenuContent align="end">
          <DropdownMenuRadioGroup
            value={filters.sort}
            onValueChange={(value) => onChange({ sort: value as SortOrder })}
          >
            <DropdownMenuLabel>Sort</DropdownMenuLabel>
            {(Object.entries(SORT_LABELS) as [SortOrder, string][]).map(([value, label]) => (
              <DropdownMenuRadioItem key={value} value={value}>{label}</DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
        </>
      ) : null}

      {/* 设计把 Select 放在工具条最右(`LibraryReference.tsx` 的 `ml-auto`)。
          它在 seg2a 那一票里因为「批量动作没有后端」而不画;收藏与合集落地之后它回来了。
          回收站里它又不画:那一格的两颗批量键(Add to collection / Favorite)写入前都要过
          存活校验(`library-subjects.filterVisibleSubjects` 的 `deletedAt: null`),对着一批
          已删素材按下去只会整批被拒 —— 必然失败的键不该出现。**只有这一颗不画**,
          搜索、筛选与「回到 In library」那一路都留在原地(见 `canSelect`)。 */}
      {canSelect ? (
        <Button
          variant={selectionMode ? "secondary" : "ghost"}
          size="sm"
          className="ml-auto"
          onClick={() => onSelectionModeChange(!selectionMode)}
        >
          {selectionMode ? "Done" : "Select"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Elements —— `Entity` 那一支(含演员库)。
 *
 * 设计的元素卡片在弹层里给 `Favorite` 与 `Use in Canvas` 两颗键;两者今天都没有 typed
 * 契约(entity 级 favorite 不存在,`createCanvasNode` 只认 Generation),所以两颗都不画。
 * 弹层里**留下的**那一颗是 `Remove from Library` —— 它不是设计新加的花样,而是商家今天就
 * 有的、删自己数据的那条路(`lib/actions.ts:softDeleteEntity`,软删)。换壳不该把它弄丢,
 * 所以按前端规则第②条:生产必需而设计没有明说的东西,用设计的样式(AlertDialog)呈现,
 * 文案与旧壳(`stuff/StuffLibrary.tsx`)一字不改。
 *
 * **Official avatars 是只读的**(Founder 2026-08-30;已批准 pattern README §5 的
 * "Read-only：Official avatar actions 与 Founder-owned Element actions 明确不同")。
 * 判据不是「哪一栏」,是域层能力表 `element.capabilities.deleteEntity`
 * (`packages/core/src/entity-policy.ts`,和 `EntityDTO` 同一个函数)。按第③层的做法:
 * 官方那一格**根本不画**这颗键,而不是画一颗禁用的假控件;同时按第②点挂一枚
 * 「Official avatar · Read only」标签 —— 只读要看得见,不能靠「按钮怎么少了」去猜。
 * server action 那一层仍然自己回库现读 `catalogKey` 再拒一次,这里少画一颗键不是围栏。
 */
function ElementsView({
  elements,
  elementView,
  onElementViewChange,
  onRemoved,
}: {
  elements: readonly LibraryElement[];
  elementView: LibraryElementKind;
  onElementViewChange: (view: LibraryElementKind) => void;
  onRemoved: (elementId: string) => void;
}) {
  const [selected, setSelected] = React.useState<LibraryElement>();
  const [removeTarget, setRemoveTarget] = React.useState<LibraryElement>();
  const [removing, setRemoving] = React.useState(false);
  const [removeError, setRemoveError] = React.useState<string | null>(null);
  const visible = elements.filter((element) => element.kind === elementView);
  const viewLabel = LIBRARY_ELEMENT_VIEWS.find((view) => view.value === elementView)?.label ?? PRODUCT_VOCABULARY.elements;

  async function confirmRemove() {
    if (!removeTarget || removing) return;
    setRemoving(true);
    setRemoveError(null);
    const result = await softDeleteEntity(removeTarget.id);
    setRemoving(false);
    if (result && "error" in result) {
      // 失败就说失败 —— 不用一句成功 toast 冒充一次没发生的写入。
      setRemoveError(result.error);
      return;
    }
    onRemoved(removeTarget.id);
    setRemoveTarget(undefined);
    setSelected(undefined);
  }

  return (
    <div>
      <Tabs value={elementView} onValueChange={(value) => {
        setSelected(undefined);
        onElementViewChange(value as LibraryElementKind);
      }}>
        <TabsList className="rounded-none border-b border-border bg-transparent p-0">
          {LIBRARY_ELEMENT_VIEWS.map((view) => (
            <TabsTrigger
              key={view.value}
              value={view.value}
              className="rounded-none border-b-2 border-transparent px-3 py-2 shadow-none data-active:border-foreground data-active:bg-transparent data-active:shadow-none"
            >
              {view.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {visible.length ? (
        <div className="mt-5 grid grid-cols-4 gap-4">
          {visible.map((element) => (
            <Button
              key={element.id}
              variant="ghost"
              aria-label={`Open ${element.name}`}
              onClick={() => setSelected(element)}
              className="h-auto min-w-0 flex-col items-stretch justify-start overflow-hidden rounded-[var(--radius-card)] border border-border bg-card p-0 text-left shadow-none hover:bg-card"
            >
              <span className="relative block aspect-[4/3] w-full overflow-hidden bg-muted">
                {element.coverUrl ? (
                  // 同 MediaTile:商家自家 /files 素材。
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={element.coverUrl} alt="" className="size-full object-cover" loading="lazy" />
                ) : null}
              </span>
              <span className="block p-3">
                <span className="block truncate text-sm font-semibold">{element.name}</span>
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  {element.mediaCount} linked {element.mediaCount === 1 ? "image" : "images"}
                </span>
              </span>
            </Button>
          ))}
        </div>
      ) : (
        <div className="flex min-h-72 flex-col items-center justify-center text-center">
          <h3 className="text-sm font-semibold">No {viewLabel.toLowerCase()} yet</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {`${PRODUCT_VOCABULARY.elements} you and Otto save while creating show up here.`}
          </p>
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(undefined); }}>
        <DialogContent>
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  {selected.name}
                  {/* 与 `stuff/ElementVariantsDialog.tsx` 同一枚标签、同一句话 —— 商家在
                      两个面上看到的是同一个事实。 */}
                  {selected.origin === "OFFICIAL_CATALOG" ? (
                    <Badge variant="outline" className="font-medium text-muted-foreground">
                      {OFFICIAL_CATALOG_BADGE}
                    </Badge>
                  ) : null}
                </DialogTitle>
                <DialogDescription>
                  {viewLabel} · {selected.mediaCount} linked {selected.mediaCount === 1 ? "image" : "images"}
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-muted">
                {selected.coverUrl ? (
                  // 同上。
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.coverUrl} alt={selected.name} className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="grid aspect-[4/3] w-full place-items-center text-xs text-muted-foreground">
                    No image saved for this element yet.
                  </div>
                )}
              </div>
              {selected.capabilities.deleteEntity ? (
                <DialogFooter>
                  <Button
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => { setRemoveError(null); setRemoveTarget(selected); }}
                  >
                    <Trash2 aria-hidden />
                    {`Remove from ${PRODUCT_VOCABULARY.library}`}
                  </Button>
                </DialogFooter>
              ) : null}
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(removeTarget)} onOpenChange={(open) => { if (!open) setRemoveTarget(undefined); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from library?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget
                ? `This moves "${removeTarget.name}" out of ${PRODUCT_VOCABULARY.library}. It won't show up on a ${PRODUCT_VOCABULARY.canvas}, in pickers, or in search anymore.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {removeError ? (
            <p className="text-xs text-destructive">{removeError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={removing}
              onClick={(event) => { event.preventDefault(); void confirmRemove(); }}
            >
              {removing ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export type LibraryViewProps = {
  initialView: LibraryViewName;
  initialElementView: LibraryElementKind;
  initialPage: { items: LibraryItem[]; nextCursor: string | null } | { error: string };
  projects: { id: string; name: string }[];
  elements: LibraryElement[];
  /** 深链进来的那一格(`?asset=` + `?project=`);详情面自己按 id 再验一次归属。 */
  initialAsset?: { generationId: string; projectId: string };
  /** 深链进来的那个合集(`?collection=`);同样只是定位参数,服务端自己再验一次。 */
  initialCollectionId?: string;
  /** 深链进来的那一堆(`?show=trash`)。首屏那一页服务端只取活着的行,回收站那一份由客户端
   *  用同一组条件再要一次 —— 地址说的是回收站,屏幕就得是回收站。 */
  initialShow?: ShowFilter;
};

export function LibraryView({
  initialView,
  initialElementView,
  initialPage,
  projects,
  elements,
  initialAsset,
  initialCollectionId,
  initialShow,
}: LibraryViewProps) {
  const router = useRouter();
  const [view, setView] = React.useState<LibraryViewName>(initialView);
  const [elementView, setElementView] = React.useState<LibraryElementKind>(initialElementView);
  const [filters, setFilters] = React.useState<Filters>(
    initialShow === "trash" ? { ...DEFAULT_FILTERS, show: "trash" } : DEFAULT_FILTERS,
  );
  const [items, setItems] = React.useState<LibraryItem[]>(
    "error" in initialPage ? [] : initialPage.items,
  );
  const [cursor, setCursor] = React.useState<string | null>(
    "error" in initialPage ? null : initialPage.nextCursor,
  );
  const [error, setError] = React.useState<string | null>(
    "error" in initialPage ? initialPage.error : null,
  );
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null);
  const [detail, setDetail] = React.useState(initialAsset);
  const [elementList, setElementList] = React.useState<LibraryElement[]>(elements);

  // ── 段②:收藏、合集与选择模式 ────────────────────────────────────────────────
  // 收藏是**自己的读模型**(Founder 2026-09-03 裁决十:一次查询、按收藏时间排),
  // 不是把生成历史再筛一遍 —— 所以它有自己的一份列表与游标,与上面那一组互不干扰。
  // `null` = 还没取过第一页(骨架屏),`[]` = 取过了、真的一件都没有(空态)。
  const [favorites, setFavorites] = React.useState<LibraryFavoriteItem[] | null>(null);
  const [favoritesCursor, setFavoritesCursor] = React.useState<string | null>(null);
  const [favoritesLoading, setFavoritesLoading] = React.useState(false);
  const [favoritesError, setFavoritesError] = React.useState<string | null>(null);
  const [favoritesToken, setFavoritesToken] = React.useState(0);
  const [selectionMode, setSelectionMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [collectionDialog, setCollectionDialog] = React.useState<
    { subjects: LibrarySubjectRef[]; startOnCreate: boolean } | null
  >(null);
  const [collectionsToken, setCollectionsToken] = React.useState(0);
  const [activeCollectionId, setActiveCollectionId] = React.useState<string | undefined>(
    initialCollectionId,
  );
  const [organizeError, setOrganizeError] = React.useState<string | null>(null);
  const [organizing, setOrganizing] = React.useState(false);

  // ── 回收站(清单 B3 / P1-007)────────────────────────────────────────────────
  // 回收站里点一格不是「看详情」而是「拿回来」:详情面读的是活着的行
  // (`asset-actions.getGeneration` 带 `deletedAt: null`),对着一件已删素材开它只会得到
  // 一句「不可用」。所以这一格改问一句话,答完就地重取。
  const [restoreTarget, setRestoreTarget] = React.useState<{ id: string; title: string } | null>(null);
  const [restoreBusy, setRestoreBusy] = React.useState(false);
  const [restoreError, setRestoreError] = React.useState<string | null>(null);

  // 日界只解析一次,分组与 `Date created` 筛选共用它 —— 两处各拿一个时区,就会出现
  // 「分组说 Today、筛选说今天没有」这种自相矛盾的屏幕。
  const timeZone = React.useSyncExternalStore(NEVER_CHANGES, VIEWER_TIME_ZONE, SERVER_TIME_ZONE);

  // 迟到的旧请求会覆盖新条件的结果 —— 每次发请求领一个号,回来时号对不上就丢弃
  // (backend-handoff-contract.md §8.3①)。
  const requestRef = React.useRef(0);

  const gridView = view === "history" || view === "uploads";
  const favoritesView = view === "favorites";
  /** 工具条在哪几格出现(设计:history / uploads / favorites)。**回收站也在内** ——
   *  它是这张网格的一个筛选,不是一扇单向门:搜索、筛选与「Show → In library」那一路
   *  必须一直在屏幕上,否则商家进了回收站就只剩整页刷新一条出路。 */
  const toolbarView = gridView || favoritesView;
  /** 能不能进选择模式,是另一件事:回收站里的两颗批量动作(收藏、加进合集)写入前都要过
   *  存活校验(`library-subjects.filterVisibleSubjects` 的 `deletedAt: null`),对着一批
   *  已删素材按下去只会整批被拒 —— 一颗必然失败的键不该出现。 */
  const canSelect = toolbarView && filters.show !== "trash";

  const queryFor = React.useCallback(
    (nextView: LibraryViewName, nextFilters: Filters, nextCursor: string | null) => ({
      search: nextFilters.query.trim() || undefined,
      // Uploads 页签本身就是一次来源约束;它与 More filters 的来源勾选是交集,
      // 与已批准设计的 filtering.ts 同一个语义。
      sources: nextView === "uploads"
        ? nextFilters.sources.filter((source) => source === "upload")
        : nextFilters.sources,
      mediaKind: nextFilters.media === "all" ? undefined : nextFilters.media,
      projectId: nextFilters.projectId === "all" ? undefined : nextFilters.projectId,
      // 日界与网格分组同一份规则、同一个时区(`lib/library-view-model.ts`)。
      // 首屏那一页 `date` 是 "all",走不到 `timeZone`,所以 hydration 前后签名一致。
      since: librarySinceForDateFilter(nextFilters.date, new Date(), timeZone),
      order: nextFilters.sort,
      // 回收站那一格 —— 一个开关,同一个读模型(`getGenerationHistory`),不是第二份查询。
      trashed: nextFilters.show === "trash" ? true : undefined,
      cursor: nextCursor,
      take: PAGE_SIZE,
    }),
    [timeZone],
  );

  const reload = React.useCallback(async (nextView: LibraryViewName, nextFilters: Filters) => {
    const ticket = ++requestRef.current;
    setLoading(true);
    // 换了条件,上一页的「加载更多」连同它的失败一起作废 —— 不然那颗键会永远卡在
    // 「Loading…」上,或者顶着上一组条件的错误。
    setLoadingMore(false);
    setLoadMoreError(null);
    const result = await getGenerationHistory(queryFor(nextView, nextFilters, null));
    if (ticket !== requestRef.current) return;
    setLoading(false);
    if ("error" in result) {
      setError(result.error);
      setItems([]);
      setCursor(null);
      return;
    }
    setError(null);
    setItems(result.items);
    setCursor(result.nextCursor);
  }, [queryFor]);

  /**
   * 已经在屏幕上的那一组条件长什么样。首屏那一页由服务端取好了,所以初值就是它 ——
   * 条件没变就一次网络都不发(挂载时不重取、StrictMode 的第二次 effect 也不重取),
   * 条件一变就整组重来(不是在浏览器里过滤已加载的那几条)。
   */
  const loadedQueryRef = React.useRef(JSON.stringify(queryFor(initialView, DEFAULT_FILTERS, null)));

  React.useEffect(() => {
    if (!gridView) return;
    const signature = JSON.stringify(queryFor(view, filters, null));
    if (signature === loadedQueryRef.current) return;
    loadedQueryRef.current = signature;
    // 打字时每一个键都发一次请求,既费服务器也让结果跳个不停 —— 让它安静 300ms 再问。
    const timer = setTimeout(() => { void reload(view, filters); }, 300);
    return () => clearTimeout(timer);
  }, [gridView, view, filters, initialView, queryFor, reload]);

  async function loadMore() {
    if (!cursor) return;
    const ticket = requestRef.current;
    setLoadingMore(true);
    setLoadMoreError(null);
    const result = await getGenerationHistory(queryFor(view, filters, cursor));
    if (ticket !== requestRef.current) return;
    setLoadingMore(false);
    if ("error" in result) {
      // 下一页取不到,不该把已经在屏幕上的那些也抹掉 —— 只在那颗键旁边说这一次没成。
      setLoadMoreError(result.error);
      return;
    }
    // 同一组条件的下一页按 stable id 去重后**追加**(§8.3②)。
    setItems((current) => {
      const seen = new Set(current.map((item) => item.id));
      return [...current, ...result.items.filter((item) => !seen.has(item.id))];
    });
    setCursor(result.nextCursor);
  }

  /**
   * 页签、详情与 Elements 分栏都留在地址里 —— 刷新、深链与**后退**都回到同一格。
   *
   * 用的是浏览器自己的 `history.pushState`(与已批准的 `LibraryReference` 同一种做法),
   * 不走 `router.push/replace`:这一页是 `force-dynamic` 的,每开一次详情面就让服务端把
   * 整页重跑一遍,既慢又会把已经加载的那几页滚回去。地址变了,页面不用重来。
   *
   * **详情住在路径里,不在查询串里**(清单 B3 / P1-007):打开一件素材 = `/library/<id>`,
   * 关掉 = 回到 `/library`。真路径才是能贴给别人、刷新回得来、后退退得掉的那种地址,
   * 服务端也有一个真的 route 文件接住它(`app/library/[id]/page.tsx`)。老链接的
   * `?asset=`/`?project=` 仍然认(服务端解析),只是我们自己不再产出那种地址。
   */
  const writeRoute = React.useCallback((next: {
    view?: LibraryViewName;
    element?: LibraryElementKind;
    asset?: { generationId: string; projectId: string } | null;
    collection?: string | null;
    show?: ShowFilter;
  }) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const params = url.searchParams;
    if (next.view !== undefined) {
      if (next.view === "history") params.delete("view");
      else params.set("view", next.view);
      url.pathname = SHELL_ROUTES.library;
      // 老链接的两个参数:换页签时照样清掉,否则它们会跟着地址一路带下去。
      params.delete("asset");
      params.delete("project");
      // 回收站是**这一格**的筛选,不是跟着人走的模式:换页签就回到 In library
      // (地址与屏幕一起复位,不然 Trash 会悄悄渗进 Uploads 那一格)。
      params.delete("show");
      if (next.view !== "elements") params.delete("element");
      if (next.view !== "collections") params.delete("collection");
    }
    if (next.show !== undefined) {
      if (next.show === "trash") params.set("show", "trash");
      else params.delete("show");
    }
    if (next.element !== undefined) params.set("element", next.element);
    if (next.collection !== undefined) {
      if (next.collection) params.set("collection", next.collection);
      else params.delete("collection");
    }
    if (next.asset !== undefined) {
      url.pathname = next.asset
        ? `${SHELL_ROUTES.library}/${encodeURIComponent(next.asset.generationId)}`
        : SHELL_ROUTES.library;
      // 老形状一律不再写出去(读的时候还认,见 `syncFromRoute` 与服务端那两个 page)。
      params.delete("asset");
      params.delete("project");
    }
    window.history.pushState(window.history.state, "", url);
  }, []);

  /** 后退键要真的往回走一格:页签、Elements 分栏与详情面都跟着地址回到上一步。 */
  React.useEffect(() => {
    function syncFromRoute() {
      const url = new URL(window.location.href);
      const params = url.searchParams;
      setView(parseLibraryView(params.get("view") ?? undefined));
      setElementView(parseLibraryElementView(params.get("element") ?? undefined));
      // 详情的权威是**路径段**(`/library/<id>`);`?asset=` 只为老链接保留。
      const fromPath = libraryDetailIdFromPath(url.pathname);
      const assetId = fromPath ?? params.get("asset");
      setDetail(assetId
        // `projectId` 只是付费动作在 DTO 落地前的兜底值:后退回来时能从已加载的那几行里
        // 认出来就用它,认不出来留空 —— 详情面自己 `getGeneration()` 会填上真的那一个。
        ? { generationId: assetId, projectId: params.get("project") ?? "" }
        : undefined);
      setActiveCollectionId(params.get("collection") ?? undefined);
      // 回收站也在地址里(`?show=trash`),所以后退键能从回收站退回 In library。
      const nextShow: ShowFilter = params.get("show") === "trash" ? "trash" : "library";
      setFilters((current) => (current.show === nextShow ? current : { ...current, show: nextShow }));
      if (nextShow === "trash") {
        setSelectionMode(false);
        setSelectedIds(new Set());
        setOrganizeError(null);
      }
    }
    window.addEventListener("popstate", syncFromRoute);
    return () => window.removeEventListener("popstate", syncFromRoute);
  }, []);

  function changeView(nextView: LibraryViewName) {
    setView(nextView);
    setDetail(undefined);
    // 换一格就退出选择模式:选中的那几件属于上一格的查询范围,带过去只会让计数
    // 与实际操作对象对不上(backend-handoff-contract.md §8.3①)。
    setSelectionMode(false);
    setSelectedIds(new Set());
    setOrganizeError(null);
    setActiveCollectionId(undefined);
    // 回收站跟着页签一起复位 —— 它是「这一格现在看哪一堆」,不是一个跟着人走的模式。
    setFilters((current) => (current.show === "library" ? current : { ...current, show: "library" }));
    writeRoute({ view: nextView });
  }

  /**
   * 筛选改动的单一出口。多数键只改 state,只有 `show`(回收站)另外两件事:
   *   ① 进地址 —— 屏幕上看的是哪一堆,地址就得说得出来(刷新、后退、贴给别人都靠它);
   *   ② 进回收站就退出选择模式 —— 那一格没有可做的批量动作(见 `canSelect`)。
   */
  function applyFilters(next: Partial<Filters>) {
    setFilters((current) => ({ ...current, ...next }));
    if (next.show === undefined) return;
    writeRoute({ show: next.show });
    if (next.show === "trash") {
      setSelectionMode(false);
      setSelectedIds(new Set());
      setOrganizeError(null);
    }
  }

  function openItem(item: { id: string; projectId: string }) {
    const next = { generationId: item.id, projectId: item.projectId };
    setDetail(next);
    writeRoute({ asset: next });
  }

  /** 回收站里按下一格 —— 先问一句,答完才写库(恢复本身是可再删的,所以不再问第二次)。 */
  async function confirmRestore() {
    if (!restoreTarget) return;
    setRestoreBusy(true);
    setRestoreError(null);
    const result = await restoreGeneration(restoreTarget.id);
    setRestoreBusy(false);
    if ("error" in result) {
      // 服务端拒绝了这一次恢复 ⇒ 框留在原地、把它那句话摆出来、还能再按一次。
      setRestoreError(result.error);
      return;
    }
    setRestoreTarget(null);
    // 它已经不在回收站里了 —— 同一组条件重取一次,不在浏览器里把它偷偷抹掉。
    void reload(view, filters);
    router.refresh();
  }

  function openCollection(collectionId: string | null) {
    setActiveCollectionId(collectionId ?? undefined);
    writeRoute({ collection: collectionId });
  }

  /**
   * 收藏页自己的一页 —— 与生成历史那一组各走各的游标。
   *
   * 第一句就是 `await`:这个函数下面那个 effect 会直接调它,而 effect 体里同步 setState
   * 是 react-hooks/set-state-in-effect。「还没取到第一页」这件事不靠 loading 旗子表达,
   * 靠 `favorites === null`(初值),所以这里不需要在发请求前先 setState。
   */
  const loadFavorites = React.useCallback(async (cursorValue: string | null) => {
    const result = await listLibraryFavorites({ cursor: cursorValue, take: PAGE_SIZE });
    setFavoritesLoading(false);
    if ("error" in result) {
      setFavoritesError(result.error);
      if (!cursorValue) setFavorites([]);
      return;
    }
    setFavoritesError(null);
    setFavorites((current) => {
      if (!cursorValue) return result.items;
      const seen = new Set((current ?? []).map((item) => item.subjectId));
      return [...(current ?? []), ...result.items.filter((item) => !seen.has(item.subjectId))];
    });
    setFavoritesCursor(result.nextCursor);
  }, []);

  React.useEffect(() => {
    if (!favoritesView) return;
    // 包一层 async IIFE 再 await:effect 体里直接 `void loadFavorites(null)`,
    // react-hooks/set-state-in-effect 会顺着调用图看进那个 useCallback 的函数体,
    // 把它里面的 setState 记在 effect 头上(即便它们全在 await 之后)。
    // 与 `CollectionsView` 的取数是同一个写法。
    void (async () => {
      await loadFavorites(null);
    })();
  }, [favoritesView, favoritesToken, loadFavorites]);

  /** Escape 退出选择模式(已批准设计 §5「Selection」)。 */
  React.useEffect(() => {
    if (!selectionMode) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectionMode(false);
        setSelectedIds(new Set());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectionMode]);

  function updateSelection(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** 选中的那几件 —— 类型化 ID,不是裸字符串(`lib/library-types.ts`)。 */
  function selectedSubjects(): LibrarySubjectRef[] {
    return [...selectedIds].map((subjectId) => ({ subjectType: "generation" as const, subjectId }));
  }

  /** 批量收藏。逐件写、逐件等服务端回话 —— 有一件没成就说清楚,不弹一句笼统的成功。 */
  async function favoriteSelected() {
    if (organizing || !selectedIds.size) return;
    setOrganizing(true);
    setOrganizeError(null);
    const subjects = selectedSubjects();
    const results = await Promise.all(
      subjects.map((subject) => setLibraryFavorite(subject.subjectType, subject.subjectId, true)),
    );
    setOrganizing(false);
    const failed = results.filter((result) => "error" in result).length;
    if (failed) {
      // 有一件没成就**把选择条留在屏幕上** —— 那行小字唯一的落点就在选择条里
      // (下面 `{selectionMode && selectedIds.size ? …}` 那一块)。同一次渲染里
      // 既写这条消息又退出选择模式,等于写完就把它连同容器一起卸掉:商家什么也看不到,
      // 却以为 N 件全收进去了。所以只有全成功才退出。
      setOrganizeError(
        `${subjects.length - failed} of ${subjects.length} saved to Favorites. ${failed} couldn’t be saved.`,
      );
    } else {
      setSelectionMode(false);
      setSelectedIds(new Set());
    }
    setFavoritesToken((value) => value + 1);
    // 网格里那一列 favorite 也变了,重取同一组条件的第一页。
    if (gridView) void reload(view, filters);
  }

  function closeDetail() {
    setDetail(undefined);
    writeRoute({ asset: null });
  }

  const filtersActive = !filtersAreDefault(filters);

  return (
    <>
      <main className="flex h-[calc(100dvh-2.75rem)] min-w-0 bg-background">
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="shrink-0 px-6 pt-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h1 className="text-2xl font-semibold tracking-[-0.03em]">{PRODUCT_VOCABULARY.library}</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Find, organize and reuse everything you create.
                </p>
              </div>
              {view === "collections" && !activeCollectionId ? (
                <Button
                  size="sm"
                  onClick={() => setCollectionDialog({ subjects: [], startOnCreate: true })}
                >New collection</Button>
              ) : null}
            </div>

            <Tabs value={view} onValueChange={(value) => changeView(value as LibraryViewName)} className="mt-5 gap-0">
              <TabsList className="rounded-none bg-transparent p-0">
                {LIBRARY_VIEWS.map((item) => (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    className="rounded-none border-b-2 border-transparent px-3 py-2.5 shadow-none data-active:border-foreground data-active:bg-transparent data-active:shadow-none"
                  >
                    {item.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </header>

          {toolbarView ? (
            <LibraryToolbar
              filters={filters}
              projects={projects}
              /* 收藏页是自己的读模型(裁决十:一次查询、按收藏时间排),它没有搜索与筛选
                 的服务端契约 —— 按前端规则第①条,那几颗控件在这一格不渲染,只留 Select。 */
              showFilters={gridView}
              canSelect={canSelect}
              selectionMode={selectionMode}
              onSelectionModeChange={(next) => {
                setSelectionMode(next);
                if (!next) setSelectedIds(new Set());
                setOrganizeError(null);
              }}
              onChange={applyFilters}
              onClear={() => applyFilters(DEFAULT_FILTERS)}
            />
          ) : <div className="border-b border-border" />}

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
            {view === "elements" ? (
              <ElementsView
                elements={elementList}
                elementView={elementView}
                onElementViewChange={(next) => {
                  setElementView(next);
                  writeRoute({ element: next });
                }}
                onRemoved={(elementId) =>
                  setElementList((current) => current.filter((element) => element.id !== elementId))
                }
              />
            ) : null}

            {gridView ? (
              <>
                {error ? (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <h2 className="text-sm font-semibold">We couldn&apos;t load your {PRODUCT_VOCABULARY.library}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{error}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4"
                      onClick={() => void reload(view, filters)}
                    >Try again</Button>
                  </div>
                ) : loading ? (
                  <GridSkeleton />
                ) : items.length ? (
                  <MediaGrid
                    items={items}
                    selectedId={detail?.generationId}
                    // 回收站里点一格是「拿回来」,不是「看详情」—— 详情面读的是活着的行。
                    onOpen={(item) => {
                      if (filters.show === "trash") {
                        setRestoreError(null);
                        setRestoreTarget({ id: item.id, title: libraryCardBaseTitle(item) });
                        return;
                      }
                      openItem(item);
                    }}
                    timeZone={timeZone}
                    // 回收站里勾选框一律不出现 —— 即便选择模式是从别处带进来的
                    // (`canSelect` 是那一格的硬闸,不只是 Select 那颗键的可见性)。
                    selectionMode={canSelect && selectionMode}
                    selectedIds={selectedIds}
                    onSelect={(item, checked) => updateSelection(item.id, checked)}
                  />
                ) : filters.show === "trash" ? (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <Trash2 className="size-6 text-muted-foreground" aria-hidden />
                    <h2 className="mt-4 text-sm font-semibold">Trash is empty</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Anything you move to trash waits here until you restore it.
                    </p>
                  </div>
                ) : filtersActive ? (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <Search className="size-6 text-muted-foreground" aria-hidden />
                    <h2 className="mt-4 text-sm font-semibold">Nothing matches these filters</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {filters.query.trim()
                        ? `No result for “${filters.query.trim()}”. Try another search or clear a filter.`
                        : "Try another search or clear a filter."}
                    </p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4"
                      onClick={() => setFilters(DEFAULT_FILTERS)}
                    >Clear filters</Button>
                  </div>
                ) : view === "uploads" ? (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <h2 className="text-sm font-semibold">No uploads yet</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Files you add while creating with Otto show up here.
                    </p>
                  </div>
                ) : (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <h2 className="text-sm font-semibold">Nothing here yet</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Everything you make lands here on its own. Start something and it will show up.
                    </p>
                    <Link href={SHELL_ROUTES.create} className={cn(buttonVariants({ size: "sm" }), "mt-4")}>
                      Create something
                    </Link>
                  </div>
                )}

                {cursor && !loading && !error ? (
                  <div className="flex flex-col items-center gap-2 pt-6">
                    <Button variant="secondary" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                      {loadingMore ? "Loading…" : "Load older"}
                    </Button>
                    {loadMoreError ? (
                      <p className="text-xs text-destructive">
                        Couldn&apos;t load older items. {loadMoreError}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}

            {favoritesView ? (
              <>
                {favoritesError ? (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <h2 className="text-sm font-semibold">We couldn&apos;t load your favorites</h2>
                    <p className="mt-1 text-xs text-muted-foreground">{favoritesError}</p>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="mt-4"
                      onClick={() => setFavoritesToken((value) => value + 1)}
                    >Try again</Button>
                  </div>
                ) : favorites === null ? (
                  <GridSkeleton />
                ) : favorites.length ? (
                  <MediaGrid
                    items={favorites}
                    selectedId={detail?.generationId}
                    onOpen={openItem}
                    timeZone={timeZone}
                    selectionMode={selectionMode}
                    selectedIds={selectedIds}
                    onSelect={(item, checked) => updateSelection(item.id, checked)}
                  />
                ) : (
                  <div className="flex min-h-72 flex-col items-center justify-center text-center">
                    <Heart className="size-6 text-muted-foreground" aria-hidden />
                    <h2 className="mt-4 text-sm font-semibold">No favorites yet</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Open anything you make and save it. Favorites keep a link — the original stays
                      where it is.
                    </p>
                  </div>
                )}

                {favoritesCursor && !favoritesError ? (
                  <div className="flex justify-center pt-6">
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={favoritesLoading}
                      onClick={() => {
                        // 旗子只在这条(事件触发的)路上点亮 —— 第一页由 effect 触发,
                        // 它的「还在取」是 `favorites === null`。
                        setFavoritesLoading(true);
                        void loadFavorites(favoritesCursor);
                      }}
                    >{favoritesLoading ? "Loading…" : "Load older"}</Button>
                  </div>
                ) : null}
              </>
            ) : null}

            {view === "collections" ? (
              <CollectionsView
                activeCollectionId={activeCollectionId}
                onOpenCollection={openCollection}
                onOpenItem={(item) => openItem({ id: item.generationId, projectId: item.projectId })}
                refreshToken={collectionsToken}
              />
            ) : null}

            {/* 选择条:设计里它悬在网格底部(`LibraryReference.tsx` 的 `SelectionBar`)。
                设计的第三颗键 Download 今天没有批量下载的真实路径,按前端规则第①条不画。 */}
            {canSelect && selectionMode && selectedIds.size ? (
              <div className="sticky bottom-4 z-20 mx-auto flex w-fit flex-col items-center gap-1">
                <div className="flex items-center gap-2 rounded-[var(--radius-card)] border border-border bg-popover p-2 shadow-[var(--shadow-lg)]">
                  <span className="px-2 text-sm font-semibold">{selectedIds.size} selected</span>
                  <Button
                    size="sm"
                    disabled={organizing}
                    onClick={() =>
                      setCollectionDialog({ subjects: selectedSubjects(), startOnCreate: false })
                    }
                  >
                    <FolderPlus aria-hidden />
                    Add to collection
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={organizing}
                    onClick={() => void favoriteSelected()}
                  >
                    <Heart aria-hidden />
                    {organizing ? "Saving…" : "Favorite"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Exit selection"
                    onClick={() => { setSelectionMode(false); setSelectedIds(new Set()); }}
                  >
                    <X aria-hidden />
                  </Button>
                </div>
                {organizeError ? (
                  <p className="text-xs text-destructive">{organizeError}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </main>

      {detail ? (
        <DetailPanel
          generationId={detail.generationId}
          projectId={detail.projectId}
          onClose={() => {
            closeDetail();
            // 详情面里的删除、收藏、裁剪、重做、动画都写库。关掉它之后网格必须重新问一次
            // 服务器 —— 否则商家刚删掉的那张还留在格子里,点进去才发现没了(一次看得见的
            // 假状态)。`router.refresh()` 只会刷新服务端那一份首屏 props,它管不到这个
            // 客户端列表,所以两件都做:壳(余额等)走 refresh,列表走同一组条件的重取。
            router.refresh();
            if (gridView) void reload(view, filters);
            // 详情面里的 Save 走的就是收藏那一张表(lib/asset-actions.setFavorite 已经
            // 收口到 lib/library-favorites.setLibraryFavorite),所以收藏页也要重取。
            setFavoritesToken((value) => value + 1);
            setCollectionsToken((value) => value + 1);
          }}
        />
      ) : null}

      <AlertDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => { if (!open) { setRestoreTarget(null); setRestoreError(null); } }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this asset?</AlertDialogTitle>
            <AlertDialogDescription>
              {restoreTarget
                ? `"${restoreTarget.title}" goes back to your library. It does not reattach itself to a shot — put it back on a canvas yourself.`
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {/* 服务端拒绝了这一次恢复 ⇒ 那句话就摆在按下 Restore 的地方,框不关、可重试。 */}
          {restoreError ? (
            <p className="text-xs text-destructive">{restoreError}</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoreBusy}
              onClick={(event) => { event.preventDefault(); void confirmRestore(); }}
            >
              {restoreBusy ? "Restoring…" : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {collectionDialog ? (
        <CollectionDialogs
          open
          subjects={collectionDialog.subjects}
          startOnCreate={collectionDialog.startOnCreate}
          onOpenChange={(open) => { if (!open) setCollectionDialog(null); }}
          onChanged={() => {
            setCollectionsToken((value) => value + 1);
            setSelectionMode(false);
            setSelectedIds(new Set());
          }}
        />
      ) : null}
    </>
  );
}

export default LibraryView;
