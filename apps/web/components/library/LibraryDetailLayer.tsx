"use client";

/**
 * LibraryDetailLayer.tsx —— 点开一张图之后的那一层。图是主角,能对它做的事坐在旁边。
 *
 * 照 `ApprovalLayer.tsx` 的成例(同一套 `Dialog` + `unstyled` + 专属 scrim)。那一面付过一次
 * 学费(commit 42503fa5):`unstyled` 会连 shadcn 默认的 `-translate-*-1/2` 一起拿掉,居中得由
 * 这一层自己的 css 负责,而入场关键帧**必须专属命名、每一帧都带着那半个 -50%** —— 借别人的
 * 关键帧、或者写一帧 `transform: none`,层会当场飞出视口。r22-library.css 里那条
 * `r22-lib-layer-in` 就是照这条规矩写的,测试也钉着它。
 */

import { Download, FolderPlus, Star } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

import { dayLabel, libraryCanvasHref, type LibraryAsset } from "./library-fixture";

export function LibraryDetailLayer({
  asset,
  fixture,
  onClose,
  onStar,
  onDownload,
  onAddToPack,
}: {
  asset: LibraryAsset;
  fixture: boolean;
  onClose: () => void;
  onStar: (asset: LibraryAsset) => void;
  onDownload: () => void;
  onAddToPack: (asset: LibraryAsset) => void;
}) {
  const href = asset.projectId ? libraryCanvasHref(asset.projectId, fixture) : null;

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent unstyled showCloseButton={false} className="r22-lib-layer" overlayClassName="r22-lib-scrim">
        <div className="r22-lib-layer-stage">
          <figure className="r22-lib-layer-frame"><img src={asset.poster} alt="" /></figure>
        </div>

        <div className="r22-lib-layer-side">
          <DialogTitle className="r22-lib-layer-name">{asset.name}</DialogTitle>
          <p className="r22-lib-layer-meta">
            <span>{asset.kind === "video" ? `Video · ${asset.duration ?? ""}`.trim() : "Image"}</span>
            <i aria-hidden="true">·</i>
            <time dateTime={asset.createdAt}>{dayLabel(asset.createdAt)}</time>
          </p>
          {href && asset.projectName ? (
            <Link className="r22-lib-layer-origin" href={href}>Made in {asset.projectName}</Link>
          ) : (
            <p className="r22-lib-layer-origin">Uploaded by you</p>
          )}

          <h3 className="r22-lib-layer-h">{asset.prompt ? "Prompt" : "Where this came from"}</h3>
          <DialogDescription className="r22-lib-layer-body">
            {asset.prompt ?? "You added this picture yourself, so there is no prompt behind it."}
          </DialogDescription>

          <div className="r22-lib-layer-acts">
            <Button unstyled type="button" aria-pressed={asset.starred} onClick={() => onStar(asset)}>
              <Star fill={asset.starred ? "currentColor" : "none"} aria-hidden="true" />{asset.starred ? "Starred" : "Star"}
            </Button>
            <Button unstyled type="button" onClick={onDownload}><Download aria-hidden="true" />Download</Button>
            <Button unstyled type="button" onClick={() => onAddToPack(asset)}><FolderPlus aria-hidden="true" />Add to pack</Button>
            {href ? <Link className="r22-lib-layer-open" href={href}>Open in canvas</Link> : null}
          </div>
        </div>

        <DialogClose className="r22-lib-layer-x" aria-label="Close this picture">
          <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

export default LibraryDetailLayer;
