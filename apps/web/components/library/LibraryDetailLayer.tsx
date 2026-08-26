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

import { ArrowUpRight, Download, FolderPlus, Star, Wand2 } from "lucide-react";
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
  onEdit,
  onOpenSource,
}: {
  asset: LibraryAsset;
  fixture: boolean;
  onClose: () => void;
  onStar: (asset: LibraryAsset) => void;
  /** `null` = Download 这一颗这一期不摆出来(见 `LibraryWorkroom` 的 `LIBRARY_DOWNLOAD_ENABLED`)。 */
  onDownload: (() => void) | null;
  onAddToPack: (asset: LibraryAsset) => void;
  /** 开那一层「改这一张」。视频没有可改的那一帧,所以那颗键在视频上是关着的。 */
  onEdit: (asset: LibraryAsset) => void;
  /** 这一张是改出来的时候,回到它的原图。 */
  onOpenSource: (assetId: string) => void;
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
          {/*
            属性住行,不住散文(审计 B-5)。此前这里是「Video · 0:12 · 24 Aug」一句用
            `·` 串起来的话 —— 三个属性,没有一个说得出自己叫什么。改成 `<dl>` 之后每一条
            都有名字,与 Otto IQ 详情层已经做对的那一份同形。
          */}
          <dl className="r22-lib-layer-meta">
            <div><dt>Type</dt><dd>{asset.kind === "video" ? "Video" : "Image"}</dd></div>
            {asset.kind === "video" && asset.duration ? <div><dt>Length</dt><dd>{asset.duration}</dd></div> : null}
            <div><dt>Made</dt><dd><time dateTime={asset.createdAt}>{dayLabel(asset.createdAt)}</time></dd></div>
          </dl>
          {/* 改出来的那一条先说自己是从哪一张来的 —— 那一句本身就是回原图的路。 */}
          {asset.editedFromId && asset.editedFromName ? (
            <Button unstyled type="button" className="r22-lib-layer-origin r22-lib-layer-source" data-r22-lib-edited-from={asset.editedFromId} onClick={() => onOpenSource(asset.editedFromId!)}>
              Edited from {asset.editedFromName}
            </Button>
          ) : null}
          {/*
            **通往那块板的路只剩这一条**(2026-08-26 beta 清扫,审计 P2-20)。此前这一层画
            了两条链接、同一个 `href`:这里的「Made in Raya launch」与动作排末尾那颗
            「Open in Canvas」。商家读到两个控件,按下去到同一个地方 —— 重复的入口不是多
            一条路,是多一次「这两颗有什么不一样」的犹豫。
            留下的是带项目名这一条:它多说了一件对方不知道的事(这张是在哪块板上做出来
            的),而「Open in Canvas」只重复了门名。丢掉的那半件事(说得出自己开的是
            Canvas)补在可及名字与那枚箭头上,所以合并之后这一条仍然两件事都做。
          */}
          {href && asset.projectName ? (
            <Link className="r22-lib-layer-origin" href={href} data-r22-lib-open aria-label={`Open ${asset.projectName} in Canvas`}>
              Made in {asset.projectName}<ArrowUpRight aria-hidden="true" />
            </Link>
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
            <Button unstyled type="button" disabled={asset.kind === "video"} data-r22-lib-edit onClick={() => onEdit(asset)}>
              <Wand2 aria-hidden="true" />Edit image
            </Button>
            {/* 藏起来的那一期,动作排就是三颗 —— flex 排的,少一颗自己收拢,不留空位。 */}
            {onDownload ? <Button unstyled type="button" onClick={onDownload}><Download aria-hidden="true" />Download</Button> : null}
            <Button unstyled type="button" onClick={() => onAddToPack(asset)}><FolderPlus aria-hidden="true" />Add to pack</Button>
          </div>
          {/* 关着的那颗键要说得出为什么关着 —— 灰着不说话,商家只会以为坏了。 */}
          {asset.kind === "video" ? (
            <p className="r22-lib-layer-note" data-r22-lib-edit-note>Editing works on pictures, so this clip cannot be restyled here.</p>
          ) : null}
        </div>

        <DialogClose className="r22-lib-layer-x" aria-label="Close this picture">
          <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

export default LibraryDetailLayer;
