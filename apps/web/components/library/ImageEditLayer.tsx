"use client";

/**
 * ImageEditLayer.tsx —— 「改这一张」那一层。Library 的单图详情与画布的逐图动作排开的是
 * **同一份**这个组件,不是两套长得像的东西。
 *
 * 形状照 Magnific 的 Restyling an image:左边一张大图,右边三件 ——
 *   ① 风格预设格(六个商家会说的短语,不是参数名);
 *   ② 「Describe the change」人话输入(预设说不出来的那一句,自己写);
 *   ③ 版本条(Original 加每一次改出来的那一版,点一下换预览)。
 *
 * 画法照 `LibraryDetailLayer` 的成例(同一套 `Dialog` + `unstyled` + 专属 scrim)。那一面
 * 付过一次学费(commit 42503fa5):`unstyled` 会连 shadcn 默认的 `-translate-*-1/2` 一起拿掉,
 * 居中由这一层自己的 css 负责,而入场关键帧**必须专属命名、每一帧都带着那半个 -50%** ——
 * 借别人的关键帧、或者写一帧 `transform: none`,层会当场飞出视口。
 *
 * 诚实那一条写在最显眼的地方:这一面是样机,真的改图还没接上,所以**预览仍然是原来那一张**,
 * 层里那句话逐字说清楚这件事。改出来的是库里**新的一条**,原图一个字节都不动。
 */

import { Sparkles } from "lucide-react";
import { useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { fixtureQuoteCredits } from "@/components/canvas/r22-canvas-fixture";

import { IMAGE_EDIT_PRESETS, type LibraryAsset } from "./library-fixture";
/* 这一层两面都开得起来(Library 与画布),而 portal 出去的那一层只读得到 `:root` 上的
   `--r22-*` 央册 token —— 所以它自带整份画法,连 scrim 都是自己的,不借任何一面的 css。 */
import "./r22-image-edit.css";

/** 一次改动落地之后的三种结果。三种都要说得出口 —— 悄悄吞掉一种就是屏上写着做到了。 */
export type ImageEditOutcome = "added" | "existing" | "no-room";

/** 改一张图的价钱 = 一张图的价钱。价目只有 `r22-canvas-fixture` 那一处,这里不写第二个。 */
export const IMAGE_EDIT_CREDITS = fixtureQuoteCredits("image", 1);

export function ImageEditLayer({
  asset,
  versions,
  onClose,
  onMakeEdit,
}: {
  /** 被改的那一张(原图)。 */
  asset: LibraryAsset;
  /** 这张图已经改出过的那几版,旧的在前。 */
  versions: LibraryAsset[];
  onClose: () => void;
  /** 宿主落盘,并如实回答这一次到底发生了什么。 */
  onMakeEdit: (change: string) => ImageEditOutcome;
}) {
  const [preset, setPreset] = useState("");
  const [phrase, setPhrase] = useState("");
  /** 此刻预览的是哪一版。`""` = 原图。 */
  const [previewId, setPreviewId] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  /** shadcn 官方示例的 `htmlFor` / `id` 配对要一个稳定前缀。 */
  const presetId = useId();
  const timerRef = useRef<number | null>(null);

  /** 预设与人话是同一句话的两种说法,谁后说算谁的 —— 两句一起发,商家就说不清要哪一个。 */
  const change = phrase.trim() || preset;
  const preview = versions.find((version) => version.id === previewId) ?? asset;

  function close() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    onClose();
  }

  function makeEdit() {
    if (!change || busy) return;
    setBusy(true);
    setStatus("Otto is on it. Nothing is charged until it lands.");
    timerRef.current = window.setTimeout(() => {
      const outcome = onMakeEdit(change);
      setBusy(false);
      setPhrase("");
      setPreset("");
      setStatus(
        outcome === "added"
          ? `${asset.name} — ${change} is in your Library — ${IMAGE_EDIT_CREDITS} cr.`
          : outcome === "existing"
            ? "You already made that same edit, so nothing new was made and nothing was charged."
            : "There is no room left in this preview, so nothing was kept.",
      );
    }, 640);
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) close(); }}>
      <DialogContent unstyled showCloseButton={false} className="r22-edit-layer" overlayClassName="r22-edit-scrim">
        <div className="r22-edit-stage">
          <figure className="r22-edit-frame">
            {/* eslint-disable-next-line @next/next/no-img-element -- 与详情层同一张本地样张,尺寸由容器定,没有可优化的远端资源。 */}
            <img src={preview.poster} alt="" />
          </figure>
          <p className="r22-edit-honest">Stand-in preview — the picture on screen stays as it was until editing is connected.</p>
        </div>

        <div className="r22-edit-side">
          <DialogTitle className="r22-edit-name">Edit {asset.name}</DialogTitle>
          <DialogDescription className="r22-edit-sub">
            Each edit is kept as a new picture, so the one you started from stays exactly as it is.
          </DialogDescription>

          <h3 className="r22-edit-h">Style</h3>
          {/* 一组**真**单选:方向键循环、焦点跟随、Tab 只占一站,全是 shadcn RadioGroup
              (Radix roving focus)自带的。这一面上一版把那一整套自己写了一遍 —— 写得对,
              但它是第三份实现,而键盘行为分家只有用键盘的人碰得到。 */}
          <RadioGroup
            unstyled
            className="r22-edit-presets"
            aria-label="Style"
            value={preset}
            disabled={busy}
            onValueChange={setPreset}
          >
            {IMAGE_EDIT_PRESETS.map((option) => (
              <label
                key={option.id}
                htmlFor={`${presetId}-${option.id}`}
                data-preset={option.id}
                className={preset === option.label ? "r22-edit-preset is-selected" : "r22-edit-preset"}
                data-busy={busy ? "" : undefined}
              >
                <RadioGroupItem unstyled id={`${presetId}-${option.id}`} value={option.label} data-r22-edit-preset={option.id} />
                <i aria-hidden="true" />
                <b>{option.label}</b>
                <small>{option.hint}</small>
              </label>
            ))}
          </RadioGroup>

          <h3 className="r22-edit-h">Describe the change</h3>
          <Textarea
            unstyled
            className="r22-edit-phrase"
            rows={2}
            value={phrase}
            disabled={busy}
            aria-label="Describe the change"
            placeholder="Say it in your own words…"
            onChange={(event) => setPhrase(event.target.value)}
          />

          <h3 className="r22-edit-h">Versions</h3>
          <div className="r22-edit-versions" role="group" aria-label="Versions">
            <Button
              unstyled
              type="button"
              className={previewId === "" ? "r22-edit-version is-selected" : "r22-edit-version"}
              aria-pressed={previewId === ""}
              data-r22-edit-version="original"
              onClick={() => setPreviewId("")}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- 40px 版本缩略,同一张本地样张。 */}
              <img src={asset.poster} alt="" />
              <span>Original</span>
            </Button>
            {versions.map((version) => (
              <Button
                unstyled
                type="button"
                key={version.id}
                className={previewId === version.id ? "r22-edit-version is-selected" : "r22-edit-version"}
                aria-pressed={previewId === version.id}
                data-r22-edit-version={version.id}
                onClick={() => setPreviewId(version.id)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- 同上。 */}
                <img src={version.poster} alt="" />
                <span>{version.prompt ?? version.name}</span>
              </Button>
            ))}
          </div>

          <div className="r22-edit-acts">
            <span className="r22-edit-status" role="status" aria-live="polite">{status}</span>
            <Button unstyled type="button" className="r22-edit-go" disabled={!change || busy} data-r22-edit-go onClick={makeEdit}>
              <Sparkles aria-hidden="true" />
              {busy ? "Making it…" : `Make this edit · ${IMAGE_EDIT_CREDITS} cr`}
            </Button>
          </div>
        </div>

        <DialogClose className="r22-edit-x" aria-label="Close editing">
          <svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" /></svg>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

export default ImageEditLayer;
