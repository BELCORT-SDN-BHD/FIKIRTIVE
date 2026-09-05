"use client";
/**
 * G2a · per-asset detail panel.
 * G2b adds: variant switcher (25), aspect picker (17), edit @composer (24), crop (16).
 * Opens as a shadcn Sheet so it stays anchored to the viewport, traps focus, and restores focus
 * when it closes. Escape closes the crop layer first, then the inspector.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";
import { getGeneration } from "@/lib/asset-actions";
import { saveCroppedGeneration } from "@/lib/asset-actions";
import { setFavorite } from "@/lib/asset-actions";
import { deleteGeneration } from "@/lib/actions";
import { getPublicMediaLink } from "@/lib/media-link-actions";
import {
  startAssetGen,
  getGenJob,
  getActiveGenModels,
  type ActiveGenModels,
} from "@/lib/gen-actions";
import { readPick, writePick, PICK_SCOPE_NOTE } from "@/lib/result-pick";
import { notifyBalanceRefresh } from "@/lib/balance-refresh";
import { CropIcon, DownloadIcon, HeartIcon, LinkIcon, PlayIcon, RotateCcwIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Separator } from "@/components/ui/separator";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Spinner } from "@/components/ui/spinner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { MentionInput } from "@/components/MentionInput";
import { UnderstandingCostHint } from "@/components/otto/UnderstandingCostHint";
import { ImageShapePicker } from "@/components/gen/ImageShapePicker";
import { VideoSpecPicker } from "@/components/gen/VideoSpecPicker";
import {
  clampVideoSpec,
  defaultVideoSpec,
  videoSpecCredits,
  videoSpecMenu as videoSpecMenuOf,
  type VideoSpec,
} from "@/lib/video-spec";
import { creditsLabel } from "@/lib/credit-format";
import { canvasDownloadFileName } from "@/lib/canvas-selection";
import { sameOriginDownloadUrl } from "@/lib/download-url";
import { assetSpendControlDisabled, type AssetSpendStatus } from "@/lib/asset-detail-status";
import { ClipActions } from "@/components/asset/ClipActions";
import type { EntityDTO } from "@/lib/types";

type GenDTO = {
  id: string;
  projectId: string;
  url: string;
  urls: string[];
  // aligned to urls; carries each variant's own id/state (F08) and its OWN engine receipt (#776 r2)
  variants: { id: string; url: string; favorite: boolean; finalPrompt: string | null }[];
  kind: string;
  prompt: string;
  /** #776：被请求的那一行自己的「引擎真正跑的那句」。切换缩略图后要读 `variants[i].finalPrompt`。 */
  finalPrompt: string | null;
  /**
   * #914 r4：平台**实际交给引擎**的那一句（worker 在发送那一刻记的）。比对已在服务端做完
   * （asset-actions.sentPromptReceipt）：null = 这一行不是一次引擎调用的产物（历史生成，
   * 或上传/裁剪这类没调过引擎的行）⇒ 整块不渲染，一个字不说。
   */
  sentPrompt: null | { verbatim: true } | { verbatim: false; text: string };
  /** Creation S2 §8.1①(CREATE-A4 / A12)—— 这一趟为什么落到这一档(只写能力名词)。
   *  null / 缺席 = 没升档,整块不渲染 —— 不编一句「用了默认档」。 */
  routeReason?: string | null;
  favorite: boolean;
  sourceGenerationId: string | null;
  /** #643 T2：这张图当初交付时的形状（快照，非像素反推）。老图读不到 ⇒ null。 */
  imageAspect: string | null;
};

type PanelState = "loading" | "ready" | "error";
/** #896 — the only thing left that asks twice is DELETE. The three paid actions
 *  (Regenerate / Animate / Generate edit) now follow the canvas rule: the price is on the
 *  button, the press does it, and a button whose quote hasn't landed is off. Deleting is a
 *  different kind of act — it is irreversible and it isn't a purchase — so V16's confirm stays. */
type ConfirmAction = "delete" | null;

/** Render the cropped area of an image to a canvas and return a data URL. */
async function getCroppedDataUrl(
  imageSrc: string,
  pixelCrop: Area,
): Promise<string> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.crossOrigin = "anonymous";
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = imageSrc;
  });
  const canvas = document.createElement("canvas");
  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(
    img,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );
  return canvas.toDataURL("image/png");
}

export default function DetailPanel({
  generationId,
  projectId,
  onClose,
  entities = [],
  readOnlyReason,
}: {
  generationId: string;
  projectId: string;
  onClose: () => void;
  entities?: EntityDTO[];
  readOnlyReason?: string;
}) {
  const readOnly = !!readOnlyReason;
  const [state, setState] = useState<PanelState>("loading");
  const [gen, setGen] = useState<GenDTO | null>(null);
  const [favorite, setFavoriteLocal] = useState(false);

  // Variant switcher (25)
  const [selectedIdx, setSelectedIdx] = useState(0);

  // #645 T4 — the VIDEO spec (length / quality / shape), used by Animate only. Animate always
  // starts from THIS image, so the shape seeds to Adaptive: the engine follows the source frame
  // rather than being told a ratio it would have to crop or pad to.
  const [videoSpec, setVideoSpec] = useState<VideoSpec | null>(null);
  // #643 T2 —— the IMAGE shape, used by Regenerate and by the edit composer. Seeded from the
  // shape this very image was delivered in, so "do it again" / "edit this" keep the shape by
  // default; the merchant can pick another one and what is on screen is what gets made.
  const [chosenImageAspect, setChosenImageAspect] = useState<string>("");

  // Edit @composer (24)
  const [editPrompt, setEditPrompt] = useState("");
  const [editIds, setEditIds] = useState<string[]>([]);
  const [editStatus, setEditStatus] = useState<AssetSpendStatus>("idle");
  const [composerKey, setComposerKey] = useState(() => String(Date.now()));

  // Crop (16)
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [cropStatus, setCropStatus] = useState<"idle" | "saving" | "done" | "failed">("idle");

  // Action states
  const [regenStatus, setRegenStatus] = useState<AssetSpendStatus>("idle");
  const [animStatus, setAnimStatus] = useState<AssetSpendStatus>("idle");
  const [paidActionError, setPaidActionError] = useState<string | null>(null);
  // FRONT-A12「任何写入失败都有错误反馈,不出现『假成功』」—— 付费那三条路早就有
  // `paidActionError`,不花钱的那几个动作却一声不吭:收藏失败只把心形悄悄弹回去,复制链接
  // 失败连按钮都不动。这一格专收它们,标题随动作走,句子是**这一次**真的失败原因。
  const [actionError, setActionError] = useState<{ title: string; message: string } | null>(null);
  const [copied, setCopied] = useState(false);
  // 复制成功时说清楚这条链子活多久 —— 分钟数来自铸链那一处(lib/media-public-link.ts),
  // 不在这一层写第二个数字。一条 10 分钟后就打不开的链子,不说＝另一种假成功。
  const [copiedMinutes, setCopiedMinutes] = useState<number | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  // 删除自己一格:它的错误必须留在确认框里(框不关、可重试),不能混进面板下方那一条 ——
  // 面板一关商家就以为删掉了,而服务端刚刚拒绝了这次删除。
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const regenBusyRef = useRef(false);
  const animBusyRef = useRef(false);
  const editBusyRef = useRef(false);

  const cancelledRef = useRef(false);
  // 「Copied!」那 6 秒的计时器要留个把手:连按两次复制时,不清掉上一颗,第二次的提示会被
  // 上一轮的计时器提前抹掉(最短只剩几毫秒)—— 而 6 秒本来就是为了放下「链子活多久」那句。
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fetch opaque active capability ids, exact quotes, and video controls once. Spend handlers
  // await this server-derived contract; provider-backed model ids stay server-side.
  const [activeModels, setActiveModels] = useState<ActiveGenModels | null>(null);
  const modelsRef = useRef<ActiveGenModels | null>(null);
  const ensureModels = async () => {
    if (!modelsRef.current) modelsRef.current = await getActiveGenModels();
    setActiveModels(modelsRef.current);
    return modelsRef.current;
  };
  useEffect(() => { void ensureModels(); }, []);

  useEffect(() => {
    cancelledRef.current = false;
    queueMicrotask(() => {
      if (cancelledRef.current) return;
      setState("loading");
      setGen(null);
      setSelectedIdx(0);
      setCropOpen(false);
      setEditStatus("idle");
      setPaidActionError(null);
      setActionError(null);
      setDeleteError(null);
    });
    getGeneration(generationId).then((result) => {
      if (cancelledRef.current) return;
      if ("error" in result) {
        setState("error");
        return;
      }
      setGen(result);
      setFavoriteLocal(result.favorite);
      setState("ready");

      // Restore persisted variant pick
      const saved = readPick(result.id);
      if (saved !== null && saved < result.urls.length) {
        setSelectedIdx(saved);
      }

    });
    return () => {
      cancelledRef.current = true;
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    };
  }, [generationId]);

  useEffect(() => {
    if (!activeModels) return;
    // 带首帧的那条路(Animate)⇒ 形状默认 Adaptive。菜单与默认档都来自服务端解析。
    const initial = defaultVideoSpec(activeModels, { hasSourceImage: true });
    queueMicrotask(() => setVideoSpec((current) => current ?? initial));
  }, [activeModels]);

  // #643 T2：图片形状的种子 = 这张图**当初交付时的形状**（快照，不是从像素反推）；
  // 快照读不到（T1 之前的老图）就用服务端的默认形状 —— 那正是那些老图当年真的形状。
  // 换看另一张图（gen.id 变了）就重新播种，不把上一张的形状带过来。
  useEffect(() => {
    if (!activeModels) return;
    const seed = gen?.imageAspect || activeModels.imageDefaultAspect;
    if (seed) queueMicrotask(() => setChosenImageAspect(seed));
  }, [activeModels, gen?.id, gen?.imageAspect]);

  // Clear edit composer on generation change
  useEffect(() => {
    queueMicrotask(() => {
      setEditPrompt("");
      setEditIds([]);
      setComposerKey(String(Date.now()));
    });
  }, [gen?.id]);

  useEffect(() => {
    if (!gen) return;
    queueMicrotask(() => setFavoriteLocal(gen.variants[selectedIdx]?.favorite ?? gen.favorite));
  }, [gen, selectedIdx]);

  // The generation the user is actually LOOKING AT — the selected variant, not the primary
  // prop. All mutate/spend handlers act on this so a sibling variant isn't animated/deleted/
  // starred/edited against the wrong image (F08/F09). Still an owned id resolved server-side.
  const selectedGenId = gen ? (gen.variants[selectedIdx]?.id ?? gen.id) : generationId;
  const targetProjectId = gen?.projectId ?? projectId;
  const imageCost = activeModels?.imageCredits ?? null;
  // #645 T4：视频按档计价，所以这里报的必须是**选中那一档**的价（服务端那张按档价目表），
  // 不是默认档的价 —— 显示一个价、扣另一个价是这条线上最贵的一类缺陷。
  const videoCost = activeModels
    ? (videoSpec ? videoSpecCredits(activeModels, videoSpec) : activeModels.videoCredits)
    : null;

  // #896 r2 P0-a —— 每条付费路一道闸,**控件与动作读同一个布尔值**。
  // 之前闸只装在按钮的 disabled 上:编辑框的 Shift/Cmd/Ctrl+Enter 直接进 handleEditSubmit,
  // 报价还没回来也照跑 —— 它自己 await 一次 ensureModels() 再发付费请求,于是商家在屏幕上
  // 从没见过那个价就被扣了钱。按钮变灰是**提示**,不是闸;闸必须在动作入口,这样按钮、
  // 快捷键、以及以后任何新入口都同样 fail closed(关类不补例)。
  const regenBlocked = assetSpendControlDisabled(regenStatus, readOnly) || imageCost == null;
  const animateBlocked = assetSpendControlDisabled(animStatus, readOnly) || videoCost == null;
  const editBlocked =
    assetSpendControlDisabled(editStatus, readOnly) || !editPrompt.trim() || imageCost == null;
  // Freeze only while the request is actively moving. A cancelled or failed action may keep its
  // spend button unavailable briefly, but the merchant is free to prepare different material.
  const regenMaterialLocked = regenStatus === "running";
  const animateMaterialLocked = animStatus === "running";
  const editMaterialLocked = editStatus === "running";

  const handleFavorite = useCallback(async () => {
    if (readOnly) return;
    if (!gen) return;
    const targetGenId = selectedGenId;
    const next = !favorite;
    const applyLocal = (value: boolean) => {
      setFavoriteLocal(value);
      setGen((prev) => prev
        ? {
            ...prev,
            favorite: prev.id === targetGenId ? value : prev.favorite,
            variants: prev.variants.map((variant) => (
              variant.id === targetGenId ? { ...variant, favorite: value } : variant
            )),
          }
        : prev);
    };
    applyLocal(next); // optimistic
    const result = await setFavorite(targetGenId, next);
    if ("error" in result) {
      applyLocal(!next); // revert
      // 服务端那句原样送到屏幕上(`setFavorite` 的 "Not authorized." / "Not found.",
      // asset-actions.ts)—— 不在这一层编一句更好听的。回滚是**状态**正确,不是反馈:
      // 心形自己弹回去,商家只看见「点了又弹回来」,不知道是被拒了还是自己点空了。
      setActionError({ title: "Couldn't update Saved", message: result.error });
      return;
    }
    setActionError(null);
  }, [gen, favorite, selectedGenId, readOnly]);

  const pollJob = useCallback(async (jobId: string): Promise<"done" | "failed" | "cancelled" | "timeout"> => {
    // ~8 min at 2.5s — mirrors the canvas poll() window (useCanvasGen.ts). Video gens can
    // legitimately exceed the old ~4-min cap; the worker settles late jobs regardless of this
    // client poll. A client-side give-up is a "timeout" (still working), NOT a "failed": surfacing
    // it as failed invites a retry, and a retry while the job is still running is a wasted trip —
    // the server-derived key makes it land back on the SAME job (no second charge), but the button
    // should still tell the truth about what is happening.
    for (let i = 0; i < 192; i++) {
      if (cancelledRef.current) return "timeout";
      const job = await getGenJob(jobId);
      if (!job) return "failed";
      if (job.status === "DONE") return "done";
      if (job.status === "FAILED") return "failed";
      // A cancel is its own ending, not a failure (#602 T3 · r2 judge P2). It stops the poll —
      // before, CANCELLED was unrecognised here and this loop ran its full ~8-minute budget on a
      // job that had already stopped — and it gets its own word, so the button that comes back
      // does not say "Failed — retry?" about something the merchant chose to stop.
      if (job.status === "CANCELLED") return "cancelled";
      await new Promise((r) => setTimeout(r, 2500));
    }
    return "timeout";
  }, []);

  // After a job completes, resolve its new generation id and load it into the panel
  // (so a paid regen/animate/edit result is visible here, not only in Library).
  const reloadFromJob = useCallback(async (jobId: string) => {
    const job = await getGenJob(jobId);
    const newId = job?.generationIds?.[0];
    if (!newId) return;
    setState("loading");
    setGen(null);
    const r = await getGeneration(newId);
    if (cancelledRef.current) return;
    if (!r || "error" in r) { setState("error"); return; }
    setGen(r);
    setFavoriteLocal(r.favorite);
    setSelectedIdx(0);
    setState("ready");
  }, []);

  const handleRegen = useCallback(async () => {
    if (regenBlocked) return;
    if (!gen || regenBusyRef.current) return;
    regenBusyRef.current = true;
    try {
      setPaidActionError(null);
      setRegenStatus("running");
      const models = await ensureModels(); // F18: server-resolved model
      // #643 T2：形状是屏幕上正显示的那一格 —— 重做一张不会悄悄换掉形状。
      const aspectRatio = chosenImageAspect || gen.imageAspect || models.imageDefaultAspect;
      // #645 T4(判官 r1 P0-2)：同 Animate —— 屏幕上那个价随请求发出去，服务端重核。
      const result = await startAssetGen({
        expectedCredits: models.imageCredits,
        projectId: targetProjectId,
        prompt: gen.prompt,
        count: 1,
        kind: "image",
        model: models.image,
        ...(aspectRatio ? { aspectRatio } : {}),
        // 幂等键由服务端从「动作 + 这一次锚在哪张图上 + 请求体」算出来(gen-actions 的
        // startAssetGen)。这一面一个键都不出:带时间戳的键让刷新、第二个标签页、一次双击
        // 各自变成一次新的付费动作。
        assetOp: "regen",
        assetAnchorGenerationId: generationId,
      });
      if ("error" in result) {
        setPaidActionError(result.error);
        setRegenStatus("failed");
        return;
      }
      // The hold is on the ledger the moment startGen accepts, and the settle/refund
      // lands when the job resolves — announce both so the global nav's credits figure
      // moves with the money instead of waiting for a page reload (#550). Same two-point
      // pattern the canvas generations already use (useCanvasGen's onBalanceRefresh).
      notifyBalanceRefresh();
      const status = await pollJob(result.id);
      notifyBalanceRefresh();
      if (!cancelledRef.current) {
        setRegenStatus(status);
        if (status === "failed") {
          setPaidActionError("The new image did not finish. You can try again.");
        }
        // A timeout means the paid job is STILL RUNNING (the worker settles it late) — keep the
        // "still processing" state so the control never reverts to an inviting "Regenerate" for
        // work that is already under way. This is honesty, not the money guard: since the key is
        // derived server-side from the intent, a re-click while that job is active is reused, not
        // re-charged. done/failed reset to idle (a real failure is refunded, so retrying is safe).
        if (status !== "timeout") {
          setTimeout(() => { if (!cancelledRef.current) setRegenStatus("idle"); }, 3000);
        }
      }
      if (status === "done") await reloadFromJob(result.id);
    } finally {
      regenBusyRef.current = false;
    }
  }, [gen, generationId, targetProjectId, pollJob, reloadFromJob, regenBlocked, chosenImageAspect]);

  const handleAnimate = useCallback(async () => {
    if (animateBlocked) return;
    if (!gen || animBusyRef.current) return;
    animBusyRef.current = true;
    try {
      setPaidActionError(null);
      setAnimStatus("running");
      const models = await ensureModels();
      const vm = models.video;
      const vd = models.videoDefaults;
      // #645 T4：发出去的就是选择器上显示的那一档 —— 规格夹回菜单，夹不住就回默认档
      // （绝不把一个菜单外的值送进付费请求）。没有选择器时按服务端默认档交付。
      const spec = clampVideoSpec(models, videoSpec ?? undefined, { hasSourceImage: true });
      // #645 T4(判官 r1 P0-2)：屏幕上那个价是商家授权的一部分，所以它随请求一起发出去。
      // 服务端自己算一遍，不符就在扣款前拒绝 —— 与 Canvas / Otto 同一套绑定。
      const quoted = videoSpecCredits(models, spec);
      if (quoted == null) {
        if (!cancelledRef.current) {
          setPaidActionError("We could not confirm the video price. Check the selected spec and try again.");
          setAnimStatus("failed");
        }
        return;
      }
      const result = await startAssetGen({
        expectedCredits: quoted,
        projectId: targetProjectId,
        prompt: gen.prompt,
        count: 1,
        kind: "video",
        model: vm,
        sourceGenerationId: selectedGenId,
        durationSeconds: spec.seconds,
        resolution: spec.resolution,
        audio: videoSpec?.audio ?? vd.audio,
        ...(spec.aspectRatio ? { aspectRatio: spec.aspectRatio } : {}),
        // 键由服务端算 —— 见 handleRegen 那一处的注释。
        assetOp: "animate",
        assetAnchorGenerationId: selectedGenId,
      });
      if ("error" in result) {
        if (!cancelledRef.current) {
          setPaidActionError(result.error);
          setAnimStatus("failed");
        }
        return;
      }
      notifyBalanceRefresh();
      const status = await pollJob(result.id);
      notifyBalanceRefresh();
      if (!cancelledRef.current) {
        setAnimStatus(status);
        if (status === "failed") {
          setPaidActionError("The video did not finish. You can try again.");
        }
        // Timeout ⇒ the paid video job is still running (worker settles late ones) — stay in
        // "still processing" so a re-click can't fire a second charge. See handleRegen.
        if (status !== "timeout") {
          setTimeout(() => { if (!cancelledRef.current) setAnimStatus("idle"); }, 3000);
        }
      }
      if (status === "done") await reloadFromJob(result.id);
    } finally {
      animBusyRef.current = false;
    }
  }, [gen, selectedGenId, targetProjectId, pollJob, videoSpec, reloadFromJob, animateBlocked]);

  const handleCopyLink = useCallback(async () => {
    if (!gen) return;
    // 复制的必须是**别人打得开**的那条链子。`gen.urls[i]` 是 `/files/…` 站内相对路径:登录墙
    // 后面、而且没有域名 —— 贴到别处一无所用。这里向既有的签名公共门要一条(服务端
    // `getPublicMediaLink`,复用 `/api/media/pub/<token>` 那道门,不另造一套分享)。
    const minted = await getPublicMediaLink(selectedGenId);
    if (cancelledRef.current) return;
    if ("error" in minted) {
      // 判官 P2-1:失败必须**撤掉上一轮的成功提示**。这颗键按得动第二次,上一次成功留下的
      // 「Copied!」与那句时长还在 6 秒窗口里;不撤的话,屏幕上同时写着「已复制」和
      // 「复制不了」—— 商家有理由相信前者,那正是这一票要消灭的假成功。
      setCopied(false);
      setActionError({ title: "Couldn't copy the link", message: minted.error });
      return;
    }
    // 相对路径要在浏览器这一头补成绝对地址 —— 服务端不可靠地知道对外的域名,浏览器知道。
    const url = new URL(minted.path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setActionError(null);
      setCopiedMinutes(minted.expiresInMinutes);
      setCopied(true);
      // 6 秒,不是原来的 2 秒:现在这块地方还要放下「这条链子活多久」那一句,2 秒读不完。
      // 再按一次就重新计时:先撤掉上一颗,否则它会在新提示刚出来时把提示抹掉。
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => { if (!cancelledRef.current) setCopied(false); }, 6000);
    } catch {
      // 浏览器拒了剪贴板(权限、非安全上下文、根本没有这个 API)。旧写法在这里一个字都不说 ——
      // 按钮不变、剪贴板是空的,商家以为链接已经在手上了。这一句没有服务端来源,所以由这里
      // 写,但只说已知的事实:什么都没复制成。
      // 判官 P2-1:同上 —— 上一轮的「Copied!」不撤,就跟这句错误同屏打架。
      setCopied(false);
      setActionError({
        title: "Couldn't copy the link",
        message: "Your browser blocked clipboard access, so nothing was copied.",
      });
    }
  }, [gen, selectedGenId]);

  const handleDelete = useCallback(async () => {
    if (readOnly) return;
    setDeleteBusy(true);
    const result = await deleteGeneration(selectedGenId);
    setDeleteBusy(false);
    if ("error" in result) {
      // 服务端拒绝了这次删除 ⇒ 确认框留在原地、把它那句话摆出来、Delete 还能再按一次。
      // 旧写法把返回值整个丢掉、无条件 onClose():屏幕上跟删成功一模一样,而东西还在
      // ——FRONT-A12 要拦的正是这种「假成功」。
      setDeleteError(result.error);
      return;
    }
    setConfirmAction(null);
    onClose();
  }, [selectedGenId, onClose, readOnly]);

  const confirmDetails = confirmAction === "delete"
    ? {
        title: "Delete this asset?",
        description: "This removes the selected generation from your library. A canvas card that uses it stays where it is and reads 'Preview missing'. This cannot be undone.",
        confirmLabel: "Delete",
        disabled: readOnly,
      }
    : null;

  // Variant switcher: switch displayed url + persist pick
  const handleVariantPick = useCallback((idx: number) => {
    if (!gen) return;
    setSelectedIdx(idx);
    setFavoriteLocal(gen.variants[idx]?.favorite ?? gen.favorite);
    // 判官 P2-2:这一条错误说的是**上一张**(收藏/复制都按选中的那一张的 id 走)。换了张图
    // 还挂着它,商家会把它读成新这张的状态。换图＝换对象,旧的那句就此作废。
    setActionError(null);
    writePick(gen.id, idx);
  }, [gen]);

  // Edit @composer: submit an edit generation
  const handleEditSubmit = useCallback(async () => {
    // The gate, not the button. This handler is reachable from the composer's
    // Shift/Cmd/Ctrl+Enter as well as from the priced button beside it, and both ways in
    // must refuse on exactly the same terms — no quote on screen, no spend (#896 r2 P0-a).
    if (editBlocked) return;
    if (!gen || editBusyRef.current) return;
    editBusyRef.current = true;
    try {
      setPaidActionError(null);
      setEditStatus("running");
      const models = await ensureModels(); // F18: server-resolved model
      // #643 T2：编辑同样交付屏幕上显示的那一格。服务端在没收到形状时会按底图快照继承，
      // 这里显式带上是为了让「屏幕上写的」与「引擎收到的」永远是同一个值。
      const aspectRatio = chosenImageAspect || gen.imageAspect || models.imageDefaultAspect;
      // #645 T4(判官 r1 P0-2)：编辑框也显示价格，所以它同样带绑定。
      const result = await startAssetGen({
        expectedCredits: models.imageCredits,
        projectId: targetProjectId,
        prompt: editPrompt.trim(),
        entityIds: editIds,
        count: 1,
        kind: "image",
        model: models.image,
        ...(aspectRatio ? { aspectRatio } : {}),
        // F09: condition the edit on the image the user is actually viewing (the selected
        // variant), so a paid "edit this" result relates to the displayed image instead of
        // being an unconditioned fresh generation. Owned id resolved server-side (D19).
        sourceGenerationId: selectedGenId,
        // 键由服务端算 —— 见 handleRegen 那一处的注释。改一个字的编辑就是另一个意图,
        // 摘要覆盖了提示词与 @元素,所以它自然拿到另一个键。
        assetOp: "edit",
        assetAnchorGenerationId: selectedGenId,
      });
      if ("error" in result) {
        if (!cancelledRef.current) {
          setPaidActionError(result.error);
          setEditStatus("failed");
        }
        return;
      }
      notifyBalanceRefresh();
      const status = await pollJob(result.id);
      notifyBalanceRefresh();
      if (!cancelledRef.current) {
        setEditStatus(status);
        if (status === "failed") {
          setPaidActionError("The edited image did not finish. You can try again.");
        }
        // Timeout ⇒ the paid edit job is still running — stay in "still processing" so a re-click
        // can't fire a second charge. See handleRegen.
        if (status !== "timeout") {
          setTimeout(() => { if (!cancelledRef.current) setEditStatus("idle"); }, 3000);
        }
      }
      if (status === "done") await reloadFromJob(result.id);
    } finally {
      editBusyRef.current = false;
    }
  }, [gen, editPrompt, editIds, editBlocked, targetProjectId, pollJob, reloadFromJob, selectedGenId, chosenImageAspect]);

  // 确认框**不再抢先关掉** —— 关不关由服务端的答复决定(handleDelete):成功才关,失败留在
  // 原地带着那句话。抢先关是旧写法里「假成功」的另一半。
  const runConfirmedAction = useCallback(() => {
    if (readOnly) return;
    setDeleteError(null);
    void handleDelete();
  }, [handleDelete, readOnly]);

  // Crop: confirm crop and save
  const handleCropConfirm = useCallback(async () => {
    if (readOnly) return;
    if (!gen || !croppedAreaPixels) return;
    const srcUrl = gen.urls[selectedIdx] ?? gen.url;
    setCropStatus("saving");
    let dataUrl: string;
    try {
      dataUrl = await getCroppedDataUrl(srcUrl, croppedAreaPixels);
    } catch {
      if (!cancelledRef.current) setCropStatus("failed");
      return;
    }
    const result = await saveCroppedGeneration(selectedGenId, dataUrl);
    if ("error" in result) {
      if (!cancelledRef.current) setCropStatus("failed");
      return;
    }
    // Close crop modal; reload panel with new generation id
    if (!cancelledRef.current) {
      setCropOpen(false);
      setCropStatus("idle");
      // Reload panel to new cropped generation
      // (parent passes generationId as key; we call getGeneration with the new id)
      setState("loading");
      setGen(null);
      getGeneration(result.id).then((r) => {
        if (cancelledRef.current) return;
        if ("error" in r) { setState("error"); return; }
        setGen(r);
        setFavoriteLocal(r.favorite);
        setSelectedIdx(0);
        setState("ready");
      });
    }
  }, [gen, croppedAreaPixels, selectedIdx, selectedGenId, readOnly]);

  // Compute active URL to display
  const displayUrl = gen ? (gen.urls[selectedIdx] ?? gen.url) : null;

  // #645 T4：视频规格菜单（只在模型暴露时渲染）— F18: server-resolved model
  const videoSpecMenu = activeModels ? videoSpecMenuOf(activeModels) : null;
  const imageAspectRatios = activeModels?.imageAspectRatios ?? [];

  return (
    <TooltipProvider>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <SheetContent
          side="right"
          className="cv-detail max-w-[min(440px,calc(100vw-1rem))] sm:max-w-[440px]"
          onEscapeKeyDown={(event) => {
            if (!cropOpen) return;
            event.preventDefault();
            setCropOpen(false);
          }}
          onInteractOutside={(event) => {
            if (cropOpen) event.preventDefault();
          }}
        >
          <SheetHeader className="cv-detail-header">
            <SheetTitle>Asset details</SheetTitle>
            <SheetDescription>Review this asset and continue working from it.</SheetDescription>
          </SheetHeader>

          {/* Content */}
          {state === "loading" && (
            <Empty className="cv-detail-state">
              <EmptyHeader>
                <EmptyTitle>Loading asset…</EmptyTitle>
                <EmptyDescription>Fetching the latest saved version.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {state === "error" && (
            <Empty className="cv-detail-state">
              <EmptyHeader>
                <EmptyTitle>Could not load this asset</EmptyTitle>
                <EmptyDescription>Close this panel and try opening the asset again.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}

          {state === "ready" && gen && displayUrl && (
            <div className="cv-detail-content">
              {/* Media preview */}
              <div className="cv-detail-preview">
                {gen.kind === "video" ? (
                  <video
                    key={displayUrl}
                    src={displayUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="cv-detail-media"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={displayUrl}
                    alt={gen.prompt}
                    className="cv-detail-media"
                  />
                )}
              </div>

            {/* Variant switcher (25): thumbnail strip when multiple urls */}
            {gen.urls.length > 1 && (
              <div
                role="listbox"
                aria-label="Variant thumbnails"
                className="cv-detail-variants"
              >
                {gen.urls.map((u, i) => (
                  <Button
                    key={u}
                    role="option"
                    aria-selected={i === selectedIdx}
                    data-selected={i === selectedIdx ? "true" : undefined}
                    onClick={() => handleVariantPick(i)}
                    variant="ghost"
                    className="cv-detail-variant h-[62px] w-[62px] p-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={u}
                      alt={`Variant ${i + 1}`}
                      className="size-full object-cover"
                    />
                  </Button>
                ))}
              </div>
            )}

            {/* 选中哪一张只写进这台浏览器的 localStorage(`lib/result-pick.ts` 的
                `otto:pick:<id>`),不是账号级设置 —— 换台机器、换个浏览器、清一次站点数据
                就回到第一张。不说出口就等于让浏览器临时状态冒充持久化(接线书 §3.4)。
                升级成账号级要新的持久化列,不在本票(§5 已登记)。 */}
            {gen.urls.length > 1 && (
              <p className="text-[0.75rem] text-muted-foreground">{PICK_SCOPE_NOTE}</p>
            )}

            {/* Prompt text */}
            {gen.prompt && (
              <p className="cv-detail-prompt">{gen.prompt}</p>
            )}

            {/* #776/#914 生成回执 —— 引擎自报「它真正跑的那句话」，只有视频契约会给这个字段
                （官方 Image 响应结构没有 revised_prompt，参见 packages/core/src/refgen.ts 的
                GenerationReceipt 注释）；图片这条路上它恒为未知，不是「这次没报」。

                #914（Founder 裁决 2026-08-13，市调见 #909）：图片这一整行**永不出现**，不分
                「有 / 无」两种形状 —— 旧版 "Not reported by the engine." 曾经在图片这条路上
                永远显示，那不是诚实报告未知，是一个字段模板在填不上时自己编的句子（通行做法：
                有则显示、无则整行不出现，Ideogram / Adobe 同款）。商家想知道「这台引擎会不会
                自己改写我的话」，去选引擎的位置（ImageShapePicker / VideoSpecPicker）看一次
                静态能力说明就够了，不必每张图重复念一遍。视频这条路上这一行**行为不变**，r2
                判官的五条纪律原样保留：未知也要说出口、读这一张自己的那句、一模一样就只说
                一句、供应商指纹词已在服务端滤掉。 */}
            {gen.kind === "video" && (() => {
              // 回退只在「这一张根本不在列表里」时发生（与 displayUrl 同一套），**不是**在
              // 「这一张的值是 null」时发生 —— 后者正是要显示的答案。写成 `?.finalPrompt ??`
              // 的话，第二张没报就会悄悄继承第一张那一句，也就是判官点的那个串台。
              const selectedVariant = gen.variants[selectedIdx];
              // `?? null`：读不到这个字段（老的调用点、老的 DTO）与「引擎没报」是同一件事 ——
              // 未知。归一成 null，下面只需要判一种「不知道」。
              const shownFinalPrompt = (selectedVariant ? selectedVariant.finalPrompt : gen.finalPrompt) ?? null;
              return (
                <div className="cv-detail-fact">
                  <span className="cv-panel-label">What the engine ran</span>
                  <p className="cv-detail-fact-copy" data-unknown={shownFinalPrompt ? undefined : "true"}>
                    {shownFinalPrompt === null
                      ? "Not reported by the engine."
                      : shownFinalPrompt.trim() === gen.prompt.trim()
                        ? "Your prompt, exactly as you wrote it."
                        : shownFinalPrompt}
                  </p>
                </div>
              );
            })()}

            {/* #914 r4(判官 r3)图片回执:**我们自己**把哪一句交给了引擎 —— 不问引擎要,
                所以图片这条路上也答得出来。事实由 worker 在调用引擎那一刻记下(所有花钱
                入口唯一的汇合点，而且提示词到那时才拼完:#774 的参考图编号句是 worker 现
                产的)，比对在服务端一次做完（asset-actions.sentPromptReceipt）。

                r2/r3 的病根:记录点在 web 层 —— 记下的永远不是真正送出去的全文，于是
                「原样送出」这句话在模板一键成片这类必带底图的单上必然是谎。r4 把记录点
                搬到真实发送层，这里只负责显示服务端已经比完的结论:
                  · null（这一行不是引擎产的：历史生成，或上传/裁剪这类 $0 摄取行）⇒
                    **整块不渲染**，一个字都不说；
                  · 逐字相同 ⇒ 一句 "Sent exactly as you wrote it."；
                  · 不同     ⇒ 把实际送出的全文亮出来（已过白标）。 */}
            {/* `!= null` 而不是 `!== null`:字段整个读不到(老的调用点 / 老的 DTO)与「没有
                这条记录」是同一件事 —— 两种都往「什么都不说」那一边倒,与服务端
                sentPromptReceipt 的同一条纪律对齐。 */}
            {gen.kind === "image" && gen.sentPrompt != null && (
              <div className="cv-detail-fact">
                <span className="cv-panel-label">What we sent to the engine</span>
                <p className="cv-detail-fact-copy whitespace-pre-wrap">
                  {gen.sentPrompt.verbatim ? "Sent exactly as you wrote it." : gen.sentPrompt.text}
                </p>
              </div>
            )}

            {/* Creation S2 §8.1①(CREATE-A4 / CREATE-A12,Codex r1 P1-3 落修)—— **为什么是这一档**。
                与上面两块回执同族:都是「我们对这一张做了什么」的可查记录。服务端已经比完
                (asset-actions 的 merchantRouteReason:白标 + 「空即未知」),这里只负责显示。
                `!= null` 而不是 `!== null` —— 字段整个读不到(老的调用点 / 老的 DTO)与
                「这一趟没升档」是同一件事:两种都往「什么都不说」那一边倒,整块不渲染,
                绝不编一句「用了默认档」。句子里只有能力名词,一个型号名都没有。 */}
            {gen.routeReason != null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--muted-foreground)" }}>
                  Why this tier
                </span>
                <p style={{ margin: 0, fontSize: 14, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                  {gen.routeReason}
                </p>
              </div>
            )}

            {/* #643 T2 — Image shape: what Regenerate and the edit composer below will deliver.
                Seeded from the shape this image was made in, so neither one silently reshapes it.
                Same cost in every shape. */}
            {gen.kind === "image" && imageAspectRatios.length > 0 && chosenImageAspect && (
              <div className="cv-detail-spec">
                <span className="cv-panel-label">Image shape</span>
                <ImageShapePicker
                  compact
                  label="Image shape"
                  value={chosenImageAspect}
                  options={imageAspectRatios}
                  onChange={setChosenImageAspect}
                  disabled={readOnly || regenMaterialLocked || editMaterialLocked}
                  title="The shape a new image made here will have — same cost in every shape"
                />
              </div>
            )}

            {/* Video spec (#645 T4): length, quality and shape of the clip Animate will make.
                Labelled apart from the image shape above so the two shape controls on one panel
                cannot be confused for each other (#643 T2). The shape defaults to Adaptive —
                Animate always starts from this image, so the engine follows it rather than
                being told a ratio. The price below follows the chosen spec. */}
            {gen.kind === "image" && videoSpec && videoSpecMenu && (
              <div className="cv-detail-spec">
                <span className="cv-panel-label">Video spec</span>
                <VideoSpecPicker
                  compact
                  value={videoSpec}
                  menu={videoSpecMenu}
                  onChange={setVideoSpec}
                  disabled={readOnly || animateMaterialLocked}
                  hasSourceImage
                  audioToggle
                />
              </div>
            )}

            {/* Action rail */}
            <div className="cv-detail-actions">
              {/* Favorite */}
              <Button
                variant={favorite ? "secondary" : "ghost"}
                size="sm"
                onClick={handleFavorite}
                disabled={readOnly}
                title={readOnlyReason}
              >
                <HeartIcon data-icon="inline-start" fill={favorite ? "currentColor" : "none"} />
                {favorite ? "Saved" : "Save"}
              </Button>

              {/* Regenerate — #896: the canvas rule. The price is on the button, the press
                  does it, and until the server quote lands the button says so and is off. */}
              {gen.kind === "image" && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleRegen()}
                  disabled={regenBlocked}
                  title={readOnlyReason}
                  aria-live="polite"
                >
                  {regenStatus === "running" || imageCost == null
                    ? <Spinner data-icon="inline-start" aria-hidden="true" />
                    : <RotateCcwIcon data-icon="inline-start" />}
                  {regenStatus === "running"
                    ? "Generating…"
                    : regenStatus === "done"
                    ? "New version ready"
                    : regenStatus === "timeout"
                    ? "Still processing — check the library"
                    : regenStatus === "cancelled"
                    ? "Canceled"
                    : regenStatus === "failed"
                    ? "Failed — retry?"
                    : imageCost == null
                    ? "Checking cost…"
                    : `Regenerate · ${creditsLabel(imageCost)}`}
                </Button>
              )}

              {/* Animate (image → video) — priced from the spec chosen above, so the number on
                  the button follows the picker rather than a stale default tier (#645 T4). */}
              {gen.kind === "image" && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleAnimate()}
                  disabled={animateBlocked}
                  title={readOnlyReason}
                  aria-live="polite"
                >
                  {animStatus === "running" || videoCost == null
                    ? <Spinner data-icon="inline-start" aria-hidden="true" />
                    : <PlayIcon data-icon="inline-start" />}
                  {animStatus === "running"
                    ? "Animating…"
                    : animStatus === "done"
                    ? "Video ready"
                    : animStatus === "timeout"
                    ? "Still processing — check the library"
                    : animStatus === "cancelled"
                    ? "Canceled"
                    : animStatus === "failed"
                    ? "Failed — retry?"
                    : videoCost == null
                    ? "Checking cost…"
                    : `Animate · ${creditsLabel(videoCost)}`}
                </Button>
              )}

              {/* Crop (16) */}
              {gen.kind === "image" && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setCrop({ x: 0, y: 0 }); setZoom(1); setCropStatus("idle"); setCropOpen(true); }}
                  disabled={readOnly}
                  title={readOnlyReason}
                >
                  <CropIcon data-icon="inline-start" />
                  Crop
                </Button>
              )}

              {/* Download —— 走查 P0-2:必须走同源附件地址。直接指向 `/files/…` 会 302 到 R2,
                  `download` 属性跨源被浏览器忽略,商家就被导航出应用、片子也没存下。
                  文件名与画布批量下载同一个函数,商家在两处存到的名字一模一样。 */}
              <Button asChild variant="ghost" size="sm">
                <a
                  href={sameOriginDownloadUrl(
                    displayUrl,
                    canvasDownloadFileName({ id: selectedGenId, type: gen.kind, prompt: gen.prompt }, 0, displayUrl),
                  )}
                  download
                >
                  <DownloadIcon data-icon="inline-start" />
                  Download
                </a>
              </Button>

              {/* Copy link */}
              <Button variant="ghost" size="sm" onClick={handleCopyLink}>
                <LinkIcon data-icon="inline-start" />
                {copied ? "Copied!" : "Copy link"}
              </Button>

              {/* Delete */}
              <Button variant="destructive-secondary" size="sm" onClick={() => { if (!readOnly) { setDeleteError(null); setConfirmAction("delete"); } }} disabled={readOnly} title={readOnlyReason}>
                Delete
              </Button>
            </div>

            {/* 复制出去的是一条签名公共链接(`/api/media/pub/<token>`),寿命就是铸它时那个
                TTL。不说出口的话,商家把它贴进邮件、十分钟后对方打不开 —— 复制那一刻的
                「Copied!」就成了假成功。分钟数由服务端连着链子一起给。 */}
            {copied && copiedMinutes !== null && (
              <p className="text-[0.75rem] text-muted-foreground" role="status">
                {`Anyone with this link can open the asset for ${copiedMinutes} minutes.`}
              </p>
            )}

            {paidActionError && (
              <Alert variant="destructive" density="compact" role="alert">
                <AlertTitle>Couldn&apos;t complete this action</AlertTitle>
                <AlertDescription>{paidActionError}</AlertDescription>
              </Alert>
            )}

            {/* FRONT-A12 —— 不花钱的写入(收藏)与剪贴板动作(复制链接)失败时的那一句。
                与上面那条分开存:付费路每次开跑都会清掉自己那一格,共用一格的话商家一按
                Regenerate,刚刚那条「收藏没保存上」就无声消失了。 */}
            {actionError && (
              <Alert variant="destructive" density="compact" role="alert">
                <AlertTitle>{actionError.title}</AlertTitle>
                <AlertDescription>{actionError.message}</AlertDescription>
              </Alert>
            )}

            {/* #922 缺口 A —— 「改这条片子 / 把这条片子接下去」的商家自己那一面。
                在这里而不是在素材库网格上,是因为**画布也在这里**:画布视频卡的 "Detail"
                打开的正是这个面板,所以两个面共用同一个入口,不是两份实现(Founder
                「Shared actions」铁律)。入口到确认为止全程 $0;扣费仍然只发生在既有的
                `coworkGenerate(cardId)` 上,与 Otto 挂片子那条路同一张卡、同一个幂等域。 */}
            {gen.kind === "video" && (
              <ClipActions generationId={gen.id} disabled={readOnly} disabledReason={readOnlyReason} />
            )}

            {/* Edit @composer (24) */}
            {gen.kind === "image" && (
              <>
                <Separator />
                <div className="cv-detail-edit">
                  <span className="cv-panel-label">Describe your edit, @ to reference</span>
                  <div className="cv-detail-edit-row">
                    <div className="al-input-wrap cv-detail-edit-input">
                      <MentionInput
                        entities={entities}
                        docKey={composerKey}
                        placeholder="Describe your edit, @ to reference"
                        disabled={readOnly || editStatus === "running"}
                        onChange={(text, ids) => {
                          if (readOnly) return;
                          setEditPrompt(text);
                          setEditIds(ids);
                        }}
                        onSubmit={() => void handleEditSubmit()}
                      />
                    </div>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => void handleEditSubmit()}
                      disabled={editBlocked}
                      title={readOnlyReason}
                      aria-live="polite"
                    >
                      {(editStatus === "running" || imageCost == null) && (
                        <Spinner data-icon="inline-start" aria-hidden="true" />
                      )}
                      {editStatus === "running"
                        ? "Editing…"
                        : editStatus === "done"
                        ? "Edit ready!"
                        : editStatus === "timeout"
                        ? "Still processing — check the library"
                        : editStatus === "cancelled"
                        ? "Canceled"
                        : editStatus === "failed"
                        ? "Failed — try again"
                        : imageCost == null
                        ? "Checking cost…"
                        : `Generate edit · ${creditsLabel(imageCost)}`}
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* Crop modal (16) — normal-flow overlay inside panel, NOT position:fixed */}
            {cropOpen && !readOnly && (
              <div
                className="cv-detail-crop"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Crop area — takes remaining space */}
                <div className="cv-detail-crop-stage">
                  <Cropper
                    image={displayUrl}
                    crop={crop}
                    zoom={zoom}
                    onCropChange={setCrop}
                    onZoomChange={setZoom}
                    onCropComplete={(_croppedArea, croppedAreaPx) => {
                      setCroppedAreaPixels(croppedAreaPx);
                    }}
                  />
                </div>
                {/* Crop controls */}
                <div className="cv-detail-crop-actions">
                  {/* MONEY-A9 §7.3 —— 披露先于扣费。裁一张已有的图不是「只是裁一下」:
                   *  `saveCroppedGeneration` 落的是一条全新的 `source:"UPLOAD"` image Asset,
                   *  扫描器照样建理解行、照样扣。商家只改了构图却被收一笔他不知道存在的钱,
                   *  正是这条验收要拦的那种账。所以这一行挂在 Confirm crop 旁边,而不是之后。 */}
                  <div className="mr-auto max-w-[60%] self-center">
                    <UnderstandingCostHint />
                  </div>
                  {cropStatus === "failed" && (
                    <span className="self-center text-xs text-destructive">
                      Crop failed — try again
                    </span>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setCropOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleCropConfirm}
                    disabled={readOnly || cropStatus === "saving"}
                  >
                    {cropStatus === "saving" ? "Saving…" : "Confirm crop"}
                  </Button>
                </div>
              </div>
            )}
            </div>
          )}
          <Dialog
            open={confirmAction !== null}
            onOpenChange={(open) => {
              if (!open) { setConfirmAction(null); setDeleteError(null); }
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{confirmDetails?.title ?? ""}</DialogTitle>
                <DialogDescription>{confirmDetails?.description ?? ""}</DialogDescription>
              </DialogHeader>
              {/* FRONT-A12 —— 服务端拒绝这次删除时,那句话就摆在按下 Delete 的地方,框不关、
                  东西还在,再按一次就是重试。 */}
              {deleteError && (
                <Alert variant="destructive" density="compact" role="alert">
                  <AlertTitle>Couldn&apos;t delete this asset</AlertTitle>
                  <AlertDescription>{deleteError}</AlertDescription>
                </Alert>
              )}
              <DialogFooter>
                <Button variant="secondary" onClick={() => { setConfirmAction(null); setDeleteError(null); }}>
                  Cancel
                </Button>
                <Button
                  variant={confirmAction === "delete" ? "destructive" : "default"}
                  disabled={(confirmDetails?.disabled ?? true) || deleteBusy}
                  onClick={runConfirmedAction}
                >
                  {deleteBusy ? "Deleting…" : (confirmDetails?.confirmLabel ?? "Confirm")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SheetContent>
      </Sheet>
    </TooltipProvider>
  );
}
