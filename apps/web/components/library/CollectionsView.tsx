"use client";

/**
 * Collections —— 设计里 Library 的第四格(`design-system/patterns/library/README.md` §3.4;
 * 规格 `docs/specs/frontend-baseline.md` §7.3②;验收 FRONT-A6)。
 *
 * 一层结构、只存链接:合集卡上的封面与数量都来自服务端真实的 membership 行,
 * 打开一个合集是同一套 Library 网格。**移除一项、删除整个合集,都不删素材本身** ——
 * 那两件事的结果在这一页上都能当场看见:移除之后这一格少一块,而那件素材仍然在
 * Generation history 里。
 *
 * 设计里没有、但生产必须有的两件(前端规则第②条:用设计的样式呈现):
 *   · 合集自己的「Rename / Delete」—— 验收 FRONT-A6 明写商家要删得掉;
 *     放在合集详情标题旁的一个菜单里,删除走与 Elements 同一套 AlertDialog 确认。
 *   · 每一格的「Remove from collection」—— 同样是验收行里的一步;
 *     用与旧壳一致的 `Actions for <名字>` 菜单,而不是一颗裸露的红键。
 * 两件都不发明新组件、不写字面量颜色与间距。
 */

import * as React from "react";
import { ArrowLeft, FolderPlus, MoreHorizontal, Trash2 } from "lucide-react";

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
import { Button } from "@/design-system/primitives/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/design-system/primitives/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/design-system/primitives/dialog";
import { Input } from "@/design-system/primitives/input";
import { Skeleton } from "@/design-system/primitives/skeleton";
import { MediaTile } from "@/components/library/MediaGrid";
import {
  deleteCollection,
  getCollection,
  listCollections,
  removeFromCollection,
  renameCollection,
} from "@/lib/library-collections";
import {
  collectionItemCountLabel,
  collectionUpdatedLabel,
} from "@/lib/library-collections-model";
import { libraryItemTitle } from "@/lib/library-view-model";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";
import type {
  LibraryCollectionDetail,
  LibraryCollectionSummary,
} from "@/lib/library-types";

const COLLECTION_PAGE_SIZE = 40;

export type CollectionsViewProps = {
  /** 深链进来的那个合集(`?collection=`);id 只是定位参数,服务端自己再验一次归属。 */
  activeCollectionId?: string;
  onOpenCollection: (collectionId: string | null) => void;
  /** 点开一块素材 —— 详情面板由 Library 那一层统一开,这里只报告点了谁。 */
  onOpenItem: (item: { generationId: string; projectId: string }) => void;
  /** 外面刚改过合集(例如从选择条加进来),要重取列表时把这个数字加一。 */
  refreshToken: number;
};

export function CollectionsView({
  activeCollectionId,
  onOpenCollection,
  onOpenItem,
  refreshToken,
}: CollectionsViewProps) {
  const [collections, setCollections] = React.useState<LibraryCollectionSummary[] | null>(null);
  const [detail, setDetail] = React.useState<LibraryCollectionDetail | null>(null);
  const [detailCursor, setDetailCursor] = React.useState<string | null>(null);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [renaming, setRenaming] = React.useState(false);
  const [renameValue, setRenameValue] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [localRefresh, setLocalRefresh] = React.useState(0);

  // 迟到的旧请求不许覆盖新的一次(与 LibraryView 同一手法)。
  const requestRef = React.useRef(0);

  React.useEffect(() => {
    const ticket = ++requestRef.current;
    // 上一次的错误在**这一次拿到答案之后**才清 —— effect 体里同步 setState 是
    // react-hooks/set-state-in-effect,而且提前清掉会让重试时错误闪一下才回来。
    void (async () => {
      if (activeCollectionId) {
        const result = await getCollection(activeCollectionId, { take: COLLECTION_PAGE_SIZE });
        if (ticket !== requestRef.current) return;
        if ("error" in result) {
          // 目标被删掉或不属于这个租户:说不可用,而不是画成一个空合集。
          setDetail(null);
          setError(result.error);
          return;
        }
        setError(null);
        setDetail(result.collection);
        setDetailCursor(result.nextCursor);
        return;
      }
      const result = await listCollections();
      if (ticket !== requestRef.current) return;
      setDetail(null);
      if ("error" in result) {
        setCollections([]);
        setError(result.error);
        return;
      }
      setError(null);
      setCollections(result.collections);
    })();
  }, [activeCollectionId, refreshToken, localRefresh]);

  async function loadMore() {
    if (!detail || !detailCursor || loadingMore) return;
    setLoadingMore(true);
    const ticket = requestRef.current;
    const result = await getCollection(detail.id, {
      cursor: detailCursor,
      take: COLLECTION_PAGE_SIZE,
    });
    if (ticket !== requestRef.current) return;
    setLoadingMore(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setDetail((current) => {
      if (!current) return current;
      const seen = new Set(current.items.map((item) => item.subjectId));
      return {
        ...current,
        items: [...current.items, ...result.collection.items.filter((item) => !seen.has(item.subjectId))],
      };
    });
    setDetailCursor(result.nextCursor);
  }

  async function remove(subjectType: string, subjectId: string) {
    if (!detail || busy) return;
    setBusy(true);
    setError(null);
    const result = await removeFromCollection(detail.id, subjectType, subjectId);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    // 数字与列表都以服务端为准 —— 不在浏览器里做加减法冒充结果。
    setLocalRefresh((value) => value + 1);
  }

  async function confirmRename() {
    if (!detail || busy) return;
    const clean = renameValue.trim();
    if (!clean) return;
    setBusy(true);
    setError(null);
    const result = await renameCollection(detail.id, clean);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setRenaming(false);
    setLocalRefresh((value) => value + 1);
  }

  async function confirmDelete() {
    if (!detail || busy) return;
    setBusy(true);
    setError(null);
    const result = await deleteCollection(detail.id);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setDeleting(false);
    onOpenCollection(null);
  }

  if (activeCollectionId) {
    return (
      <div>
        <div className="mb-5 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to collections"
            onClick={() => onOpenCollection(null)}
          >
            <ArrowLeft aria-hidden />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold">{detail?.name ?? "Collection"}</h2>
            <p className="text-xs text-muted-foreground">
              {detail
                ? `${collectionItemCountLabel(detail.itemCount)} · ${collectionUpdatedLabel(detail.updatedAt, new Date())}`
                : error
                  ? "This collection isn’t available."
                  : "Loading…"}
            </p>
          </div>
          {detail ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${detail.name}`}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => {
                    setRenameValue(detail.name);
                    setError(null);
                    setRenaming(true);
                  }}
                >
                  Rename collection
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => { setError(null); setDeleting(true); }}
                >
                  <Trash2 aria-hidden />
                  Delete collection
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {error ? <p className="mb-4 text-xs text-destructive">{error}</p> : null}

        {!detail && !error ? (
          <div className="grid grid-cols-5 gap-2" aria-hidden>
            {Array.from({ length: 5 }, (_, index) => (
              <Skeleton key={index} className="aspect-[4/5] w-full rounded-lg" />
            ))}
          </div>
        ) : null}

        {detail && detail.items.length ? (
          <>
            <div className="grid grid-cols-5 gap-2">
              {detail.items.map((item) => (
                <div key={item.subjectId} className="relative">
                  <MediaTile
                    item={item}
                    selected={false}
                    onOpen={() => onOpenItem({ generationId: item.id, projectId: item.projectId })}
                  />
                  <div className="absolute top-2 right-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="secondary"
                            size="icon-xs"
                            aria-label={`Actions for ${libraryItemTitle(item)}`}
                          >
                            <MoreHorizontal aria-hidden />
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={busy}
                          onClick={() => void remove(item.subjectType, item.subjectId)}
                        >
                          Remove from collection
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
            {detailCursor ? (
              <div className="flex justify-center pt-6">
                <Button variant="secondary" size="sm" disabled={loadingMore} onClick={() => void loadMore()}>
                  {loadingMore ? "Loading…" : "Load older"}
                </Button>
              </div>
            ) : null}
          </>
        ) : null}

        {detail && !detail.items.length ? (
          <div className="flex min-h-72 flex-col items-center justify-center text-center">
            <FolderPlus className="size-6 text-muted-foreground" aria-hidden />
            <h3 className="mt-4 text-sm font-semibold">This collection is empty</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Add media from Generation history or Uploads.
            </p>
          </div>
        ) : null}

        <Dialog open={renaming} onOpenChange={setRenaming}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename collection</DialogTitle>
              <DialogDescription>
                Renaming changes the label only. The media inside stays where it is.
              </DialogDescription>
            </DialogHeader>
            <Input
              aria-label="Collection name"
              autoFocus
              value={renameValue}
              disabled={busy}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void confirmRename(); }}
            />
            <DialogFooter>
              <Button variant="secondary" disabled={busy} onClick={() => setRenaming(false)}>Cancel</Button>
              <Button disabled={!renameValue.trim() || busy} onClick={() => void confirmRename()}>
                {busy ? "Saving…" : "Save name"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <AlertDialog open={deleting} onOpenChange={setDeleting}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this collection?</AlertDialogTitle>
              <AlertDialogDescription>
                {detail
                  ? `“${detail.name}” goes away. The ${collectionItemCountLabel(detail.itemCount)} inside stay in your ${PRODUCT_VOCABULARY.library} — a collection only holds links.`
                  : null}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={(event) => { event.preventDefault(); void confirmDelete(); }}
              >
                {busy ? "Deleting…" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center text-center">
        <h2 className="text-sm font-semibold">We couldn&apos;t load your collections</h2>
        <p className="mt-1 text-xs text-muted-foreground">{error}</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-4"
          onClick={() => setLocalRefresh((value) => value + 1)}
        >Try again</Button>
      </div>
    );
  }

  if (collections === null) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden>
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-28 w-full rounded-[var(--radius-card)]" />
        ))}
      </div>
    );
  }

  if (!collections.length) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center text-center">
        <FolderPlus className="size-6 text-muted-foreground" aria-hidden />
        <h2 className="mt-4 text-sm font-semibold">No collections yet</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Group anything you make. A collection keeps links, so nothing is duplicated.
        </p>
      </div>
    );
  }

  return (
    // 三列是**够宽时**的样子。死写 `grid-cols-3` 会在 1100×800(很常见的笔记本)
    // 把卡片压到 ~256px:封面 `w-32` 占死 128px,余下装不下合集名与那行计数,
    // 商家看到的是一排认不出来的缩略图。列数随视口降到 2 / 1,够宽时仍是设计里的三列。
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {collections.map((collection) => (
        <Button
          key={collection.id}
          variant="ghost"
          aria-label={`Open ${collection.name}`}
          onClick={() => onOpenCollection(collection.id)}
          className="h-auto min-w-0 items-stretch justify-start overflow-hidden rounded-[var(--radius-card)] border border-border bg-card p-0 text-left shadow-none hover:bg-card"
        >
          <span className="relative block aspect-[4/3] w-32 shrink-0 overflow-hidden bg-muted">
            {collection.coverUrl ? (
              // 与 MediaTile 同一种做法:商家自家 /files 素材,裸 img,不过 next/image。
              // eslint-disable-next-line @next/next/no-img-element
              <img src={collection.coverUrl} alt="" loading="lazy" className="size-full object-cover" />
            ) : null}
          </span>
          <span className="min-w-0 p-4">
            <span className="block truncate text-sm font-semibold">{collection.name}</span>
            {/* 外层 Button 基类带 `whitespace-nowrap`:这一行不 truncate 就会被硬切在字中间。 */}
            <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">
              {collectionItemCountLabel(collection.itemCount)} ·{" "}
              {collectionUpdatedLabel(collection.updatedAt, new Date())}
            </span>
          </span>
        </Button>
      ))}
    </div>
  );
}

export default CollectionsView;
