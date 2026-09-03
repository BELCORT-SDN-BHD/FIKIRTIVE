"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  Plus,
  Film,
  ImageIcon,
  RotateCcw,
  Scissors,
  X,
} from "lucide-react";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { merchantGenFailureCopy } from "@fikirtive/core";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EntityDTO, EntityTypeDTO } from "@/lib/types";
import type { AdJobItem, HistoryThumb } from "@/lib/data";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import { updateEntity, softDeleteEntity } from "@/lib/actions";
import { saveBrandRecord } from "@/lib/brand-record-actions";
import { buildStuffItems } from "@/lib/stuff-items";
import { getGenerationHistory, type LibraryItem } from "@/lib/library-actions";
import { ExitLink } from "@/components/exits/Exits";
import { BRAND_MEMORY_HREF } from "@/lib/exits";
import { StuffLibrary } from "./stuff/StuffLibrary";
import { AddAssetDialog } from "./stuff/AddAssetDialog";
import { ElementVariantsDialog } from "./stuff/ElementVariantsDialog";
import { useRouter } from "next/navigation";
import DetailPanel from "@/components/asset/DetailPanel";

// Kept as a public export — lib/stuff-items imports this type-only.
export interface AdTile {
  id: string;
  projectId: string;
  assetId: string;
  src: string;
  kind: "image" | "video";
  prompt: string;
  createdAt: string;
}

export interface OttoStuffProps {
  entities: EntityDTO[];
  ads: AdTile[];
  adJobs: AdJobItem[];
  records: BrandRecordRow[];
  history: HistoryThumb[];
  onOpenThread?: (threadId: string, projectId?: string) => void;
  onRetryWithOtto?: (prompt: string) => void;
}

function libraryItemToHistoryThumb(item: LibraryItem): HistoryThumb {
  return {
    id: item.id,
    projectId: item.projectId,
    assetId: item.assetId,
    src: item.url,
    kind: item.kind,
    prompt: item.prompt,
  };
}

/** Codex QA-CRE-007 — a failed card's title used to be the WHOLE prompt: CSS line-clamp hid the
 *  overflow visually, but the full string still sat in the DOM (a screen reader, "view source",
 *  or a wide card before the clamp kicks in all showed it whole). A short title is enough to
 *  recognise which generation this is; the merchant reads the honest reason below it, not the
 *  prompt, to learn what went wrong. */
const LIBRARY_CARD_TITLE_MAX = 60;

function libraryCardTitle(prompt: string): string {
  const trimmed = prompt.trim();
  return trimmed.length > LIBRARY_CARD_TITLE_MAX ? `${trimmed.slice(0, LIBRARY_CARD_TITLE_MAX)}…` : trimmed;
}

function AdJobCard({
  job,
  onOpenThread,
  onRetryWithOtto,
  onHide,
}: {
  job: AdJobItem;
  onOpenThread?: (threadId: string, projectId?: string) => void;
  onRetryWithOtto?: (prompt: string) => void;
  onHide?: (jobId: string) => void;
}) {
  const isProcessing = job.status === "processing";
  const pillLabel = isProcessing ? "Processing…" : "Didn't go through";
  const when = new Date(job.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  // Codex QA-CRE-007 — the card's OWN floor, independent of `apps/web/lib/data.ts` having mapped
  // `job.error` already: a row persisted before that fix shipped (or by a code path it missed)
  // can still carry the raw ops diagnostic. Re-running it through the same whitelist here is
  // idempotent for an already-mapped sentence (it is itself a whitelisted entry) and turns any
  // unrecognised string into the honest generic line instead of showing it verbatim.
  const errorCopy = job.error ? merchantGenFailureCopy(job.error) : "";

  return (
    <Card size="sm" className="gap-3 shadow-none">
      <CardHeader className="gap-2">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground/70">
            {job.kind === "video" ? <Film size={15} /> : <ImageIcon size={15} />}
          </span>
          <Badge variant={isProcessing ? "warning" : "destructive"}>{pillLabel}</Badge>
        </div>
        {job.prompt && (
          <CardTitle className="overflow-hidden text-[0.8125rem] leading-5 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
            {libraryCardTitle(job.prompt)}
          </CardTitle>
        )}
        <div className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">
          {when}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {errorCopy && !isProcessing && (
          <p className="overflow-hidden text-[0.75rem] leading-5 text-muted-foreground [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
            {errorCopy}
          </p>
        )}
        <div className="flex flex-wrap gap-1.5">
          {/* W2-1 —— 这两颗键做的都是「跳进聊天里」,而聊天不在这一页上:`/library` 变成真
            路由之后,商家可以站在一个没有聊天面的 Library 上(Otto 面板是 W2-7 才来的)。
            原来它们只看 job 有没有 threadId / prompt,handler 缺席时按下去什么都不发生 ——
            一颗按不动的按钮比没有按钮更糟。所以改成:谁给得起这个动作,谁才画这颗键。
            旧壳(OttoView)两个 handler 一直都传,所以那边一颗不少、行为一模一样。 */}
          {job.threadId && onOpenThread && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-[0.75rem]"
              onClick={() => onOpenThread(job.threadId, job.projectId)}
            >
              <ExternalLink size={13} />
              Open conversation
            </Button>
          )}
          {!isProcessing && job.prompt && onRetryWithOtto && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-[0.75rem]"
              onClick={() =>
                onRetryWithOtto(`Try again with this failed generation: ${job.prompt}`)
              }
            >
              <RotateCcw size={13} />
              Retry with Otto
            </Button>
          )}
          {!isProcessing && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[0.75rem]"
              onClick={() => onHide?.(job.id)}
            >
              <X size={13} />
              Hide
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function OttoStuff({
  entities,
  ads,
  adJobs,
  records,
  history,
  onOpenThread,
  onRetryWithOtto,
}: OttoStuffProps) {
  const router = useRouter();
  const [entityList, setEntityList] = useState<EntityDTO[]>(entities);
  const [prevEntities, setPrevEntities] = useState(entities);
  if (prevEntities !== entities) {
    // server truth arrived (router.refresh) — resync and drop stale optimistic edits
    setPrevEntities(entities);
    setEntityList(entities);
  }
  const [addOpen, setAddOpen] = useState(false);
  // #781 — which saved element the merchant opened (base look + styling variants).
  const [openEntityId, setOpenEntityId] = useState<string | null>(null);
  const [chooseProductFor, setChooseProductFor] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<{ generationId: string; projectId: string } | null>(null);
  const [generationHistory, setGenerationHistory] = useState<HistoryThumb[]>(history);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyRequestRef = useRef(0);
  const [hiddenFailedJobs, setHiddenFailedJobs] = useState<Set<string>>(new Set());

  // Stable across renders: the element dialog polls a running variant generation and takes this
  // as a dependency — a new function identity every render would restart that poll each tick.
  const refreshServerData = useCallback(() => router.refresh(), [router]);

  const fetchGenerationHistory = useCallback(async (cursor: string | null, replace: boolean) => {
    const requestId = ++historyRequestRef.current;
    setHistoryLoading(true);
    setHistoryError(null);
    const res = await getGenerationHistory({ cursor, take: 80 });
    if (requestId !== historyRequestRef.current) return;
    if ("error" in res) {
      setHistoryError(res.error);
      setHistoryLoading(false);
      return;
    }
    const nextItems = res.items.map(libraryItemToHistoryThumb);
    setGenerationHistory((prev) => {
      if (replace) return nextItems;
      const seen = new Set(prev.map((item) => item.id));
      return [...prev, ...nextItems.filter((item) => !seen.has(item.id))];
    });
    setHistoryCursor(res.nextCursor);
    setHistoryHasMore(res.hasMore);
    setHistoryLoading(false);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setGenerationHistory(history);
      setHistoryCursor(null);
      setHistoryHasMore(false);
      setHistoryError(null);
      void fetchGenerationHistory(null, true);
    });
  }, [history, fetchGenerationHistory]);

  const items = useMemo(
    () => buildStuffItems({ entities: entityList, history: generationHistory, ads, records }),
    [entityList, generationHistory, ads, records],
  );

  async function handleRename(entityId: string, newName: string): Promise<string | null> {
    const trimmed = newName.trim();
    if (!trimmed) return "Enter a name.";
    const snapshot = entityList.find((e) => e.id === entityId);
    if (!snapshot || trimmed === snapshot.name) return null;
    setEntityList((cur) => cur.map((e) => (e.id === entityId ? { ...e, name: trimmed } : e)));
    try {
      const res = await updateEntity(entityId, { name: trimmed });
      if ("error" in res) {
        setEntityList((cur) => cur.map((e) => (e.id === entityId ? { ...e, name: snapshot.name } : e)));
        return res.error;
      }
      return null;
    } catch {
      setEntityList((cur) => cur.map((e) => (e.id === entityId ? { ...e, name: snapshot.name } : e)));
      throw new Error("The rename response was lost.");
    }
  }

  /** beta bug 4 — correct a saved element's kind. Optimistic like the rename beside it, but the
   *  failure is NOT silent: the action refuses while a generation using this element is running,
   *  and the merchant has to read why nothing changed, so the message goes back to the dialog. */
  async function handleChangeType(entityId: string, type: EntityTypeDTO): Promise<string | null> {
    const snapshot = entityList.find((e) => e.id === entityId);
    if (!snapshot || snapshot.type === type) return null;
    setEntityList((cur) => cur.map((e) => (e.id === entityId ? { ...e, type } : e)));
    try {
      const res = await updateEntity(entityId, { type });
      if ("error" in res) {
        setEntityList((cur) => cur.map((e) => (e.id === entityId ? { ...e, type: snapshot.type } : e)));
        return res.error;
      }
      return null;
    } catch {
      setEntityList((cur) => cur.map((e) => (e.id === entityId ? { ...e, type: snapshot.type } : e)));
      throw new Error("The type change response was lost.");
    }
  }

  async function handleDelete(entityId: string): Promise<string | null> {
    const snapshot = entityList.find((e) => e.id === entityId);
    setEntityList((cur) => cur.filter((e) => e.id !== entityId));
    try {
      const res = await softDeleteEntity(entityId);
      if ("error" in res) {
        setEntityList((cur) => (snapshot ? [...cur, snapshot] : cur));
        return res.error;
      }
      return null;
    } catch {
      setEntityList((cur) => (snapshot ? [...cur, snapshot] : cur));
      throw new Error("The removal response was lost.");
    }
  }

  // Active product records to choose from when linking an image as a product image.
  const activeProducts = records.filter((r) => r.kind === "product" && r.status === "active");
  const visibleAdJobs = adJobs.filter((j) => !hiddenFailedJobs.has(j.id));
  const processingJobs = visibleAdJobs.filter((j) => j.status === "processing");
  const failedJobs = visibleAdJobs.filter((j) => j.status === "failed");

  async function linkProductImage(rec: BrandRecordRow, assetId: string) {
    const data = { ...(rec.data as Record<string, unknown>), imageAssetId: assetId };
    await saveBrandRecord({ id: rec.id, kind: "product", data });
    setChooseProductFor(null);
    router.refresh();
  }

  return (
    <div className="gb flex-1 overflow-auto px-3 py-4 leading-[1.5] sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[1120px]">
        <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h1 className="m-0 text-[1.5rem] font-semibold tracking-[-0.025em] text-foreground">
              Library
            </h1>
            <p className="mb-0 mt-1 max-w-[620px] text-[0.875rem] leading-5 text-muted-foreground">
              Everything you and Otto have made or saved across every project.
              <span aria-hidden className="mx-1.5">·</span>
              <span className="font-mono text-xs tabular-nums">
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
            </p>
          </div>
          <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
            <Button
              asChild
              nativeButton={false}
              size="sm"
              variant="secondary"
              className="flex-1 sm:flex-none"
            >
              <Link href={SHELL_ROUTES.create}>
                <Scissors aria-hidden />
                Create
              </Link>
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)} className="flex-1 sm:flex-none">
              <Plus aria-hidden />
              Add asset
            </Button>
          </div>
        </div>

        {processingJobs.length > 0 && (
          <section className="mb-6" aria-labelledby="library-in-progress">
            <div className="mb-3 flex items-center gap-2">
              <h2 id="library-in-progress" className="text-sm font-semibold">
                In progress
              </h2>
              <Badge variant="warning" className="font-mono tabular-nums">
                {processingJobs.length}
              </Badge>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {processingJobs.map((job) => (
                <AdJobCard key={job.id} job={job} onOpenThread={onOpenThread} />
              ))}
            </div>
          </section>
        )}

        <StuffLibrary
          items={items}
          mode="library"
          onRename={handleRename}
          onChangeType={handleChangeType}
          onDelete={handleDelete}
          onSetProductImage={(assetId) => setChooseProductFor(assetId)}
          onOpenGeneration={(generationId, itemProjectId) =>
            setDetailFor({ generationId, projectId: itemProjectId })
          }
          onOpenEntity={(id) => setOpenEntityId(id)}
          onAdd={() => setAddOpen(true)}
        />
        <div className="mt-4 flex items-center gap-3">
          {historyHasMore && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={historyLoading}
              onClick={() => void fetchGenerationHistory(historyCursor, false)}
            >
              {historyLoading ? "Loading..." : "Load more"}
            </Button>
          )}
          {historyError && (
            <Alert variant="destructive" className="max-w-lg">
              <AlertDescription>{historyError}</AlertDescription>
            </Alert>
          )}
        </div>

        {failedJobs.length > 0 && (
          <Card className="mt-6 gap-4 shadow-none">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle>Needs attention</CardTitle>
                <Badge variant="destructive" className="font-mono tabular-nums">
                  {failedJobs.length}
                </Badge>
              </div>
              <p className="text-[0.8125rem] text-muted-foreground">
                Failed generations stay here so the library remains focused on reusable assets.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
              {failedJobs.map((job) => (
                <AdJobCard
                  key={job.id}
                  job={job}
                  onOpenThread={onOpenThread}
                  onRetryWithOtto={onRetryWithOtto}
                  onHide={(id) => setHiddenFailedJobs((cur) => new Set(cur).add(id))}
                />
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      <AddAssetDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={() => router.refresh()}
      />

      <ElementVariantsDialog
        // keyed by element: opening a different one starts from a clean form instead of
        // inheriting the last element's half-typed variant
        key={openEntityId ?? "none"}
        entity={entityList.find((e) => e.id === openEntityId) ?? null}
        open={!!openEntityId}
        onOpenChange={(next) => { if (!next) setOpenEntityId(null); }}
        onChanged={refreshServerData}
      />

      {/* W2-1 —— 与 AddAssetDialog 同一个修法(规格书 §4.3):手搓的 `fixed inset-0` 遮罩
          自己接 onClick 当「点外面关闭」,却没有焦点陷阱、也不认 Escape。换成
          components/ui/dialog 之后这三件事由 Radix 一次给全,屏幕上的东西一样不少。 */}
      {chooseProductFor && (
        <Dialog open onOpenChange={(next) => { if (!next) setChooseProductFor(null); }}>
          <DialogContent className="sm:max-w-[420px]">
            <DialogHeader className="pr-8">
              <DialogTitle>Set as product image</DialogTitle>
              <DialogDescription>Pick which product this image belongs to.</DialogDescription>
            </DialogHeader>
            {activeProducts.length === 0 ? (
              // #701 — the path is real (Brand memory → Your products → + Add product); it
              // just was not a link, so the merchant had to find four levels of it themselves.
              <p className="m-0 text-[0.875rem] text-muted-foreground">
                No products yet —{" "}
                <ExitLink href={BRAND_MEMORY_HREF}>add one in Brand memory</ExitLink> first.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {activeProducts.map((rec) => {
                  const name = (rec.data as { name?: unknown }).name;
                  return (
                    <Button
                      key={rec.id}
                      type="button"
                      variant="ghost"
                      onClick={() => void linkProductImage(rec, chooseProductFor)}
                      className="h-auto w-full justify-start rounded-[10px] px-3 py-2 text-left text-[0.9375rem] font-normal text-foreground hover:bg-accent"
                    >
                      {typeof name === "string" && name ? name : "Untitled product"}
                    </Button>
                  );
                })}
              </div>
            )}
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setChooseProductFor(null)}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {detailFor && (
        <DetailPanel
          generationId={detailFor.generationId}
          projectId={detailFor.projectId}
          entities={entities}
          onClose={() => {
            setDetailFor(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

export default OttoStuff;
