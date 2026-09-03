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
  Film,
  Search,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";

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
import { Skeleton } from "@/design-system/primitives/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/design-system/primitives/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/design-system/primitives/toggle-group";
import { softDeleteEntity } from "@/lib/actions";
import { getGenerationHistory, type LibraryItem, type LibrarySourceKind } from "@/lib/library-actions";
import {
  LIBRARY_ELEMENT_VIEWS,
  parseLibraryElementView,
  type LibraryElement,
  type LibraryElementKind,
} from "@/lib/library-elements-model";
import {
  LIBRARY_VIEWS,
  groupLibraryItems,
  libraryDurationLabel,
  libraryItemTitle,
  parseLibraryView,
  type LibraryView as LibraryViewName,
} from "@/lib/library-view-model";
import { cn } from "@/lib/utils";

type MediaFilter = "all" | "image" | "video";
type DateFilter = "all" | "today" | "week";
type SortOrder = "newest" | "oldest";

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

type Filters = {
  query: string;
  media: MediaFilter;
  projectId: string;
  date: DateFilter;
  sources: LibrarySourceKind[];
  sort: SortOrder;
};

const DEFAULT_FILTERS: Filters = {
  query: "",
  media: "all",
  projectId: "all",
  date: "all",
  sources: ["generated", "upload"],
  sort: "newest",
};

function filtersAreDefault(filters: Filters): boolean {
  return (
    filters.query.trim() === "" &&
    filters.media === "all" &&
    filters.projectId === "all" &&
    filters.date === "all" &&
    filters.sources.length === 2 &&
    filters.sort === "newest"
  );
}

/** 相对今天的起点 —— 与服务端同一个 UTC 口径。 */
function sinceForDateFilter(date: DateFilter): string | undefined {
  if (date === "all") return undefined;
  const now = new Date();
  if (date === "today") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  }
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
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
}: {
  filters: Filters;
  projects: readonly { id: string; name: string }[];
  onChange: (next: Partial<Filters>) => void;
  onClear: () => void;
}) {
  const sourceFilterCount = 2 - filters.sources.length;
  const activeProject = projects.find((project) => project.id === filters.projectId);

  return (
    <div data-library-toolbar className="flex flex-wrap items-center gap-2 border-b border-border px-6 py-3">
      <InputGroup className="min-h-9 min-w-52 max-w-80 flex-1 bg-background shadow-none">
        <InputGroupAddon>
          <Search aria-hidden />
        </InputGroupAddon>
        <InputGroupInput
          aria-label="Search Library"
          value={filters.query}
          onChange={(event) => onChange({ query: event.target.value })}
          // 设计的占位符还提到 Canvas;服务端的搜索今天只走提示词,所以这里只说提示词 ——
          // 一句做不到的占位符就是一次小小的假承诺。
          placeholder="Search prompts"
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
        {(["all", "image", "video"] as const).map((filter) => (
          <ToggleGroupItem
            key={filter}
            value={filter}
            className={cn(
              "h-8 rounded-[8px] px-3 text-xs capitalize text-muted-foreground shadow-none",
              "data-pressed:bg-card data-pressed:text-foreground data-pressed:shadow-xs",
            )}
          >
            {filter === "all" ? "All" : `${filter}s`}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {projects.length ? (
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<FilterButton>{activeProject ? activeProject.name : "Canvas"}</FilterButton>}
          />
          <DropdownMenuContent align="start">
            <DropdownMenuRadioGroup
              value={filters.projectId}
              onValueChange={(value) => onChange({ projectId: value })}
            >
              <DropdownMenuLabel>Source Canvas</DropdownMenuLabel>
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
    </div>
  );
}

function MediaTile({ item, selected, onOpen }: { item: LibraryItem; selected: boolean; onOpen: () => void }) {
  const title = libraryItemTitle(item);
  const duration = libraryDurationLabel(item);
  return (
    <div className="relative mb-2 break-inside-avoid">
      <Button
        variant="ghost"
        aria-label={`Open ${title}`}
        aria-selected={selected}
        onClick={onOpen}
        className={cn(
          "group relative h-auto w-full overflow-hidden rounded-lg border border-border bg-muted p-0 shadow-none",
          "hover:border-foreground/25 hover:bg-muted focus-visible:ring-offset-2",
          selected && "border-foreground ring-1 ring-ring/20",
        )}
      >
        {item.kind === "video" ? (
          <video
            src={item.url}
            muted
            playsInline
            preload="metadata"
            className="aspect-[4/5] h-auto w-full object-cover"
          />
        ) : (
          // 商家素材走自家 `/files` 路由,尺寸由 Asset 行决定 —— 与 StuffLibrary、
          // DetailPanel 同一种做法:裸 img/video,不过 next/image 的优化管线。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.url}
            alt={title}
            loading="lazy"
            className="aspect-[4/5] h-auto w-full object-cover transition-transform duration-[var(--dur-3)] ease-[var(--ease-out)] group-hover:scale-[1.015] motion-reduce:transition-none"
          />
        )}
        {item.kind === "video" && duration ? (
          <span className="absolute right-2 bottom-2 inline-flex items-center gap-1 rounded-md bg-foreground/80 px-1.5 py-1 text-xs font-medium text-background backdrop-blur-sm">
            <Film className="size-3" aria-hidden />
            {duration}
          </span>
        ) : null}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-foreground/60 to-transparent px-2.5 pt-8 pb-2 text-left text-xs font-medium text-background opacity-0 transition-opacity duration-[var(--dur-2)] group-hover:opacity-100 group-focus-visible:opacity-100">
          {title}
        </span>
      </Button>
    </div>
  );
}

function GridSkeleton() {
  return (
    <div className="[column-count:5] [column-gap:0.5rem]" aria-hidden>
      {Array.from({ length: 10 }, (_, index) => (
        <Skeleton key={index} className="mb-2 aspect-[4/5] w-full rounded-lg" />
      ))}
    </div>
  );
}

function MediaGrid({
  items,
  selectedId,
  onOpen,
}: {
  items: readonly LibraryItem[];
  selectedId?: string;
  onOpen: (item: LibraryItem) => void;
}) {
  const groups = React.useMemo(() => groupLibraryItems(items, new Date()), [items]);
  return (
    <div className="space-y-7">
      {groups.map((group) => (
        <section key={group.key} aria-labelledby={`library-${group.key}`}>
          <div className="mb-3 flex items-center gap-2">
            <h2 id={`library-${group.key}`} className="text-sm font-semibold">{group.label}</h2>
            <span className="text-xs text-muted-foreground">{group.items.length}</span>
          </div>
          <div className="[column-count:5] [column-gap:0.5rem]">
            {group.items.map((item) => (
              <MediaTile
                key={item.id}
                item={item}
                selected={item.id === selectedId}
                onOpen={() => onOpen(item)}
              />
            ))}
          </div>
        </section>
      ))}
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
  const viewLabel = LIBRARY_ELEMENT_VIEWS.find((view) => view.value === elementView)?.label ?? "Elements";

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
            Elements you and Otto save while creating show up here.
          </p>
        </div>
      )}

      <Dialog open={Boolean(selected)} onOpenChange={(open) => { if (!open) setSelected(undefined); }}>
        <DialogContent>
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle>{selected.name}</DialogTitle>
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
              <DialogFooter>
                <Button
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() => { setRemoveError(null); setRemoveTarget(selected); }}
                >
                  <Trash2 aria-hidden />
                  Remove from Library
                </Button>
              </DialogFooter>
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
                ? `This moves "${removeTarget.name}" out of Library. It won't show up in projects, pickers, or search anymore.`
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
};

export function LibraryView({
  initialView,
  initialElementView,
  initialPage,
  projects,
  elements,
  initialAsset,
}: LibraryViewProps) {
  const router = useRouter();
  const [view, setView] = React.useState<LibraryViewName>(initialView);
  const [elementView, setElementView] = React.useState<LibraryElementKind>(initialElementView);
  const [filters, setFilters] = React.useState<Filters>(DEFAULT_FILTERS);
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

  // 迟到的旧请求会覆盖新条件的结果 —— 每次发请求领一个号,回来时号对不上就丢弃
  // (backend-handoff-contract.md §8.3①)。
  const requestRef = React.useRef(0);

  const gridView = view === "history" || view === "uploads";

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
      since: sinceForDateFilter(nextFilters.date),
      order: nextFilters.sort,
      cursor: nextCursor,
      take: PAGE_SIZE,
    }),
    [],
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
   */
  const writeRoute = React.useCallback((next: {
    view?: LibraryViewName;
    element?: LibraryElementKind;
    asset?: { generationId: string; projectId: string } | null;
  }) => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    const params = url.searchParams;
    if (next.view !== undefined) {
      if (next.view === "history") params.delete("view");
      else params.set("view", next.view);
      params.delete("asset");
      params.delete("project");
      if (next.view !== "elements") params.delete("element");
    }
    if (next.element !== undefined) params.set("element", next.element);
    if (next.asset !== undefined) {
      if (next.asset) {
        params.set("asset", next.asset.generationId);
        params.set("project", next.asset.projectId);
      } else {
        params.delete("asset");
        params.delete("project");
      }
    }
    window.history.pushState(window.history.state, "", url);
  }, []);

  /** 后退键要真的往回走一格:页签、Elements 分栏与详情面都跟着地址回到上一步。 */
  React.useEffect(() => {
    function syncFromRoute() {
      const params = new URL(window.location.href).searchParams;
      setView(parseLibraryView(params.get("view") ?? undefined));
      setElementView(parseLibraryElementView(params.get("element") ?? undefined));
      const asset = params.get("asset");
      const project = params.get("project");
      setDetail(asset && project ? { generationId: asset, projectId: project } : undefined);
    }
    window.addEventListener("popstate", syncFromRoute);
    return () => window.removeEventListener("popstate", syncFromRoute);
  }, []);

  function changeView(nextView: LibraryViewName) {
    setView(nextView);
    setDetail(undefined);
    writeRoute({ view: nextView });
  }

  function openItem(item: LibraryItem) {
    const next = { generationId: item.id, projectId: item.projectId };
    setDetail(next);
    writeRoute({ asset: next });
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
                <h1 className="text-2xl font-semibold tracking-[-0.03em]">Library</h1>
                <p className="mt-1 text-xs text-muted-foreground">
                  Find, organize and reuse everything you create.
                </p>
              </div>
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

          {gridView ? (
            <LibraryToolbar
              filters={filters}
              projects={projects}
              onChange={(next) => setFilters((current) => ({ ...current, ...next }))}
              onClear={() => setFilters(DEFAULT_FILTERS)}
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
                    <h2 className="text-sm font-semibold">We couldn&apos;t load your Library</h2>
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
                  <MediaGrid items={items} selectedId={detail?.generationId} onOpen={openItem} />
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
          </div>
        </div>
      </main>

      {detail ? (
        <DetailPanel
          generationId={detail.generationId}
          projectId={detail.projectId}
          onClose={() => {
            closeDetail();
            // 详情面里的收藏/裁剪/重做都写库 —— 关闭时重取,列表不落后于权威。
            router.refresh();
          }}
        />
      ) : null}
    </>
  );
}

export default LibraryView;
