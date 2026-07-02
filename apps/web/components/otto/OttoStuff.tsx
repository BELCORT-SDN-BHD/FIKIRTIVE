"use client";
import React, { useMemo, useState } from "react";
import { Plus, Film, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EntityDTO } from "@/lib/types";
import type { AdJobItem, HistoryThumb } from "@/lib/data";
import type { BrandRecordRow } from "@/lib/brand-record-actions";
import { updateEntity, softDeleteEntity } from "@/lib/actions";
import { saveBrandRecord } from "@/lib/brand-record-actions";
import { buildStuffItems } from "@/lib/stuff-items";
import { StuffLibrary } from "./stuff/StuffLibrary";
import { AddAssetDialog } from "./stuff/AddAssetDialog";
import { useRouter } from "next/navigation";

// Kept as a public export — lib/stuff-items imports this type-only.
export interface AdTile {
  id: string;
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
}

function AdJobCard({ job }: { job: AdJobItem }) {
  const isProcessing = job.status === "processing";
  const pillClass = isProcessing
    ? "bg-warning-soft text-warning-soft-foreground"
    : "bg-error-soft text-[var(--error-soft-foreground)]";
  const pillLabel = isProcessing ? "Processing…" : "Didn't go through";
  const when = new Date(job.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground/70">
          {job.kind === "video" ? <Film size={15} /> : <ImageIcon size={15} />}
        </span>
        <span className={`rounded-[99px] px-2 py-0.5 text-[0.75rem] font-medium ${pillClass}`}>
          {pillLabel}
        </span>
      </div>
      {job.prompt && (
        <div className="overflow-hidden text-[0.75rem] text-muted-foreground [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]">
          {job.prompt}
        </div>
      )}
      <div className="text-[0.75rem] text-muted-foreground/70">{when}</div>
    </div>
  );
}

export function OttoStuff({ entities, ads, adJobs, records, history }: OttoStuffProps) {
  const router = useRouter();
  const [entityList, setEntityList] = useState<EntityDTO[]>(entities);
  const [addOpen, setAddOpen] = useState(false);
  const [chooseProductFor, setChooseProductFor] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const items = useMemo(
    () => buildStuffItems({ entities: entityList, history, ads, records }),
    [entityList, history, ads, records],
  );

  async function handleRename(entityId: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const snapshot = entityList.find((e) => e.id === entityId);
    if (!snapshot || trimmed === snapshot.name) return;
    setEntityList((cur) => cur.map((e) => (e.id === entityId ? { ...e, name: trimmed } : e)));
    const res = await updateEntity(entityId, { name: trimmed });
    if ("error" in res) {
      setEntityList((cur) => cur.map((e) => (e.id === entityId ? { ...e, name: snapshot.name } : e)));
    }
  }

  async function handleDelete(entityId: string) {
    const snapshot = entityList.find((e) => e.id === entityId);
    setEntityList((cur) => cur.filter((e) => e.id !== entityId));
    setDeleteError(null);
    const res = await softDeleteEntity(entityId);
    if ("error" in res) {
      setEntityList((cur) => (snapshot ? [...cur, snapshot] : cur));
      setDeleteError(res.error);
    }
  }

  // Active product records to choose from when linking an image as a product image.
  const activeProducts = records.filter((r) => r.kind === "product" && r.status === "active");

  async function linkProductImage(rec: BrandRecordRow, assetId: string) {
    const data = { ...(rec.data as Record<string, unknown>), imageAssetId: assetId };
    await saveBrandRecord({ id: rec.id, kind: "product", data });
    setChooseProductFor(null);
    router.refresh();
  }

  return (
    // leading-[1.5] — design-baseline body line-height (Analytics standard)
    <div className="otto-stuff-scroll gb flex-1 overflow-auto p-6 leading-[1.5]">
      <style>{`
        @media (max-width: 680px) {
          .otto-stuff-scroll { padding: 1rem 0.75rem !important; }
        }
      `}</style>
      <div className="mx-auto max-w-[880px]">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="m-0 text-[1.5rem] font-bold tracking-[-0.02em] text-foreground">
              My Stuff
            </h1>
            <p className="mt-1 mb-0 max-w-[560px] text-[0.9375rem] text-muted-foreground leading-[1.5]">
              Everything you and Otto have made or saved — reuse any of it in the next campaign.
            </p>
          </div>
          <Button size="sm" onClick={() => setAddOpen(true)} className="shrink-0">
            <Plus size={16} />
            Add
          </Button>
        </div>

        {deleteError && (
          <div role="alert" className="mb-3 rounded-[14px] bg-error-soft px-3 py-2 text-[0.875rem] text-[var(--error-soft-foreground)]">
            {deleteError}
          </div>
        )}

        {/* In-flight / failed ad jobs stay above the library, unchanged. */}
        {adJobs.length > 0 && (
          <div className="mb-5 grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4">
            {adJobs.map((job) => (
              <AdJobCard key={job.id} job={job} />
            ))}
          </div>
        )}

        <StuffLibrary
          items={items}
          mode="library"
          onRename={handleRename}
          onDelete={handleDelete}
          onSetProductImage={(assetId) => setChooseProductFor(assetId)}
        />
      </div>

      <AddAssetDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onDone={() => router.refresh()}
      />

      {chooseProductFor && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Choose a product"
          onClick={() => setChooseProductFor(null)}
        >
          <div
            className="w-full max-w-[420px] rounded-[16px] border border-border bg-card p-6 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="m-0 mb-1 text-[1.125rem] font-semibold text-foreground">Set as product image</h2>
            <p className="mb-4 mt-0 text-[0.875rem] text-muted-foreground">Pick which product this image belongs to.</p>
            {activeProducts.length === 0 ? (
              <p className="text-[0.875rem] text-muted-foreground">
                No products yet — add one in Brand memory first.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {activeProducts.map((rec) => {
                  const name = (rec.data as { name?: unknown }).name;
                  return (
                    <button
                      key={rec.id}
                      type="button"
                      onClick={() => void linkProductImage(rec, chooseProductFor)}
                      className="rounded-[10px] px-3 py-2 text-left text-[0.9375rem] text-foreground hover:bg-accent"
                    >
                      {typeof name === "string" && name ? name : "Untitled product"}
                    </button>
                  );
                })}
              </div>
            )}
            <div className="mt-4 flex justify-end">
              <Button variant="ghost" size="sm" onClick={() => setChooseProductFor(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default OttoStuff;
