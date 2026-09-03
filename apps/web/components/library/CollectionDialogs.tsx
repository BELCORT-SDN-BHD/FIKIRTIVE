"use client";

/**
 * 「加入合集」与「新建合集」两个弹层(设计 `design-system/patterns/library/LibraryReference.tsx`
 * 的 `collectionDialogOpen` / `newCollectionDialogOpen` 两段;规格 §7.3②;验收 FRONT-A6)。
 *
 * 设计里这两个弹层的成功是**一句 toast**(评审夹具本来就没有后端)。生产里不许这么干:
 * 每一次加入都是一次真写入,所以这里等服务端回话再关弹层 —— 写入中禁用按钮、失败就把
 * 服务端那句话原样显示在弹层里,而不是关掉弹层再弹一句「成功」。
 *
 * 「Nothing is duplicated」这句设计文案在生产里是**真的**:合集只存一条链接,加入不复制
 * 文件(`lib/library-collections.ts`)。所以这句话留着。
 */

import * as React from "react";
import { FolderPlus } from "lucide-react";

import { Button } from "@/design-system/primitives/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/design-system/primitives/dialog";
import { Input } from "@/design-system/primitives/input";
import { Spinner } from "@/design-system/primitives/spinner";
import { addToCollection, createCollection, listCollections } from "@/lib/library-collections";
import type { LibraryCollectionSummary, LibrarySubjectRef } from "@/lib/library-types";

export type CollectionDialogsProps = {
  /** 要加进合集的那些素材;空数组 = 只是想新建一个空合集。 */
  subjects: readonly LibrarySubjectRef[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 直接开在「新建」那一步(顶栏的 New collection 键走这条)。 */
  startOnCreate?: boolean;
  /** 写入成功之后通知外面重取列表 —— 界面上的数字必须来自服务端,不是加法算出来的。 */
  onChanged: () => void;
};

export function CollectionDialogs({
  subjects,
  open,
  onOpenChange,
  startOnCreate = false,
  onChanged,
}: CollectionDialogsProps) {
  const [step, setStep] = React.useState<"pick" | "create">(startOnCreate ? "create" : "pick");
  const [collections, setCollections] = React.useState<LibraryCollectionSummary[] | null>(null);
  const [name, setName] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setStep(startOnCreate ? "create" : "pick");
    setName("");
    setError(null);
    let cancelled = false;
    void (async () => {
      const result = await listCollections();
      if (cancelled) return;
      if ("error" in result) {
        setCollections([]);
        setError(result.error);
        return;
      }
      setCollections(result.collections);
      // 一个合集都还没有的时候直接开在「新建」——「挑一个」挑不出东西来。
      if (!startOnCreate && result.collections.length === 0) setStep("create");
    })();
    return () => { cancelled = true; };
  }, [open, startOnCreate]);

  async function pick(collectionId: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await addToCollection(collectionId, [...subjects]);
    setBusy(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    onChanged();
    onOpenChange(false);
  }

  async function create() {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    const created = await createCollection(clean);
    if ("error" in created) {
      setBusy(false);
      setError(created.error);
      return;
    }
    if (subjects.length) {
      const added = await addToCollection(created.id, [...subjects]);
      if ("error" in added) {
        // 合集建出来了、素材没进去 —— 说清楚是哪一半没成,而不是一句笼统的失败。
        setBusy(false);
        setError(`${created.name} was created, but nothing was added. ${added.error}`);
        onChanged();
        return;
      }
    }
    setBusy(false);
    onChanged();
    onOpenChange(false);
  }

  return (
    <>
      <Dialog open={open && step === "pick"} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add to collection</DialogTitle>
            <DialogDescription>
              Collections keep links to the same media. Nothing is duplicated.
            </DialogDescription>
          </DialogHeader>
          {collections === null ? (
            <div className="flex min-h-24 items-center justify-center">
              <Spinner aria-label="Loading collections" />
            </div>
          ) : (
            <div className="space-y-1">
              {collections.map((collection) => (
                <Button
                  key={collection.id}
                  variant="ghost"
                  disabled={busy}
                  className="w-full justify-start"
                  onClick={() => void pick(collection.id)}
                >
                  <FolderPlus aria-hidden />
                  {collection.name}
                  <span className="ml-auto text-xs font-normal text-muted-foreground">
                    {collection.itemCount}
                  </span>
                </Button>
              ))}
            </div>
          )}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy} onClick={() => { setError(null); setStep("create"); }}>
              New collection
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={open && step === "create"} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New collection</DialogTitle>
            <DialogDescription>
              Name this one-layer collection. Media stays linked to its original source.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Collection name"
            autoFocus
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void create(); }}
            placeholder="Collection name"
          />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!name.trim() || busy} onClick={() => void create()}>
              {busy ? "Creating…" : "Create collection"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
