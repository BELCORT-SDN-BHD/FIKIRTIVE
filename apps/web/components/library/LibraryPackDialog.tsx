"use client";

/**
 * LibraryPackDialog.tsx —— 「放进素材包」那一层。
 *
 * 一层做两件事,因为商家的动作只有一个:我要把这几张收在一起。已经有包就点那个包,还没有
 * 就当场起一个 —— 逼商家先离开这一层去别处建一个空包,是把我们的数据结构当成了流程。
 */

import { FolderPlus } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import type { LibraryPack } from "./library-fixture";

export function LibraryPackDialog({
  open,
  count,
  packs,
  onClose,
  onAdd,
  onCreate,
}: {
  open: boolean;
  count: number;
  packs: LibraryPack[];
  onClose: () => void;
  onAdd: (packId: string) => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  // 从批量条进来的时候手里有货,从左边那颗「New pack」进来的时候没有 —— 同一层,两句话。
  const blurb = count === 0
    ? "Name it now and drop pictures in whenever you like."
    : `${count === 1 ? "1 item" : `${count} items`} will show up in the pack you pick.`;

  function create() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setName("");
    onCreate(trimmed);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) { setName(""); onClose(); } }}>
      <DialogContent unstyled showCloseButton={false} className="r22-lib-packlayer" overlayClassName="r22-lib-scrim">
        <DialogTitle className="r22-lib-packlayer-title">{count === 0 ? "New asset pack" : "Add to an asset pack"}</DialogTitle>
        <DialogDescription className="r22-lib-packlayer-sub">{blurb}</DialogDescription>
        {count === 0 ? null : (
          <div className="r22-lib-packlayer-list">
            {packs.map((pack) => (
              <Button unstyled type="button" key={pack.id} onClick={() => onAdd(pack.id)}>{pack.name}</Button>
            ))}
          </div>
        )}
        <div className="r22-lib-packlayer-new">
          <Input
            unstyled
            aria-label="New pack name"
            placeholder="New pack name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); create(); } }}
          />
          <Button unstyled type="button" disabled={!name.trim()} onClick={create}><FolderPlus aria-hidden="true" />Create pack</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default LibraryPackDialog;
