"use client";

/**
 * Create's single production entry. One submit atomically creates one Canvas, one empty
 * Conversation and a durable first-turn handoff; Canvas then sends that exact prompt through the
 * existing Otto stream. The browser UUID is held across a retry so an uncertain response cannot
 * duplicate the merchant's work.
 *
 * FRONT §7.1 ⑨ (`docs/specs/frontend-baseline.md`): the geometry, copy and control set here are
 * the approved entry-surface composer — `design-system/patterns/canvas/CreationComposer.tsx`
 * rendered with `surface="entry"`. Every class string below is copied from that pattern verbatim
 * so the two cannot drift silently (`create-design-parity.test.ts` compares them line by line) —
 * except the disclosure line in departure ③, which the pattern does not have at all.
 *
 * Two deliberate departures, ② a Founder rule from the 2026-09-03 ruling and ③ a later ruling
 * that reopened one cell of it. (Departure ① — "Add context" not rendered because a reference
 * could not reach the Canvas — is gone: the contract it was waiting for is the paragraph below.)
 *   ② 生产必需而设计没有的用设计的样式呈现 — the error and pending states (Field / FieldError /
 *      Spinner) are production-necessary and use the design system's own primitives, no new copy.
 *   ③ 披露先于扣费 — Founder 2026-09-05 裁决②「输入框下加一行价钱」reopened exactly one cell of
 *      the 2026-09-03 ruling: this page may carry a price line again. The pattern has no such line,
 *      so the block below the composer is the one place whose class strings are not copied from it.
 *      It renders the same `ConversationCostHint` the Canvas and the Otto front door already use —
 *      no second price copy, and not a single number is written here (`lib/credit-format.ts` stays
 *      the only author). The rest of 裁决五 is untouched: the visible "Create with Otto" heading and
 *      the "Nothing paid starts before you confirm the exact credits in Canvas." sentence stay gone.
 *      Registered in `docs/specs/frontend-baseline.md` §5, row 2026-09-05「裁决②」.
 *
 * ADD CONTEXT — the pattern's menu, now wired (spec §7.3⑨「起步页参考契约」). Three ways in,
 * the same three the Canvas composer has:
 *   · Upload image — `uploadFilesDirect` + `finalizeCandidateUploads`, the one upload authority.
 *     `finalizeCandidateUploads` needs a `projectId`, and this page has none yet, so attaching the
 *     first reference opens the Canvas first (`ensureCanvasDraft`, same `requestId` as the submit,
 *     so it is the SAME Canvas — never a second one). Cost of that: upload then walk away and an
 *     empty Canvas stays in the history, holding the picture that was put in it. Registered in §5.
 *   · Choose from Library — the Canvas composer's own `CanvasLibraryPicker`, unchanged: it reads
 *     the merchant's whole store through `getGenerationHistory` and needs no `projectId`.
 *   · `@` a reference — `useReferencePicker`, the same hook both Otto composers use.
 * Not rendered: **Add URL**. The only URL import in the repo is `ctx.mediaImport.fromUrl`
 * (`lib/otto-media-port.ts`), a tool Otto calls inside its own turn; there is no server action a
 * composer can call, so the item is absent rather than a button that does nothing (Founder
 * 2026-09-03 rule ①「无契约的控件不出现」) — exactly as on the Canvas composer.
 *
 * Attaching costs nothing. What the merchant picks travels in the handoff row as typed
 * `{type, id}` references (never a bare string, never an image URL), and the Canvas hangs them on
 * the FIRST turn through the pendingFirst channel it already had. Ownership is re-checked
 * server-side when the handoff is read — an id from this page is a locator, not a claim.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpIcon, ImagesIcon, PlusIcon, UploadIcon, XIcon } from "lucide-react";
import type { ReferenceRef } from "@fikirtive/core/reference-ref";
import { UPLOAD_FAILURE_COPY } from "@fikirtive/core/upload";
import { createCanvasConversation, ensureCanvasDraft } from "@/lib/canvas-entry-actions";
import { canvasHref } from "@/components/canvas/canvas-href";
import { CanvasLibraryPicker } from "@/components/canvas/CanvasLibraryPicker";
import { ConversationCostHint } from "@/components/otto/ConversationCostHint";
import { UnderstandingCostHint } from "@/components/otto/UnderstandingCostHint";
import { ReferencePickerMenu } from "@/components/reference-picker/ReferencePickerMenu";
import { useReferencePicker } from "@/components/reference-picker/useReferencePicker";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupTextarea } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import {
  composerReferenceLabel,
  removeComposerReference,
  upsertComposerReference,
  type OttoComposerReference,
} from "@/lib/canvas-chat-reference";
import { uploadFilesDirect } from "@/lib/direct-upload";
import { finalizeCandidateUploads } from "@/lib/upload-actions";
import { ACCEPT_ATTACH } from "@/lib/video-frame";
import { PRODUCT_VOCABULARY } from "@/lib/product-vocabulary";

/**
 * 起步页的上传只收图片,菜单项就照夹具写「Upload image」。
 *
 * 画布那一份收视频(它有抽帧器,一整套 `<video>` + `<canvas>` 的取帧界面),所以那边的文案是
 * 「Upload image or video」。起步页没有抽帧器,把视频收下来就得在这里再造一套 —— 与其造,
 * 不如说实话:这一页收图片,视频到画布里挂。清单从 `ACCEPT_ATTACH` **筛**出来,不另抄一份,
 * 免得两处允许的类型有一天不一样。
 */
const ACCEPT_ENTRY_IMAGE = ACCEPT_ATTACH.split(",")
  .filter((type) => type.startsWith("image/"))
  .join(",");

/**
 * `accept` 只是文件选择器的**提示**:商家在系统对话框里切到「所有文件」照样挑得到一段影片,
 * 而上传权威本身收视频(`ACCEPT_ATTACH` 含 `video/*`),于是那段影片真的传得上去,芯片再用
 * `<img>` 去画它 —— 屏幕上一个破图,而商家什么都没做错(判官 #1242 P2-4)。挡在这里,并说
 * 一句他下一步能照做的话。
 */
const ENTRY_VIDEO_NOT_HERE = `Videos go in from the ${PRODUCT_VOCABULARY.canvas} — this page takes images.`;

type EntryReference = Omit<OttoComposerReference, "requestId">;

export function StartSomething() {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [attached, setAttached] = useState<EntryReference[]>([]);
  const [pending, startTransition] = useTransition();
  const requestIdRef = useRef<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const picker = useReferencePicker({
    text: draft,
    setText: setDraft,
    getTextarea: () => textareaRef.current,
  });

  /** 整场只有一个 —— 先建草稿画布用它,送出时收编的也是它,所以永远是同一块画布。 */
  function requestId(): string {
    return (requestIdRef.current ??= crypto.randomUUID());
  }

  function attach(reference: EntryReference) {
    setAttachError(null);
    setAttached((current) => upsertComposerReference(current, reference));
  }

  function detach(reference: EntryReference) {
    if (reference.src.startsWith("blob:")) URL.revokeObjectURL(reference.src);
    setAttached((current) => removeComposerReference(current, reference.generationId));
  }

  async function handleFilePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset the input so the same file can be picked again after a removal.
    event.target.value = "";
    if (!file) return;
    setAttachError(null);
    if (!file.type.startsWith("image/")) {
      setAttachError(ENTRY_VIDEO_NOT_HERE);
      return;
    }
    setUploading(true);
    try {
      // 先有画布才落得下这一行 Generation —— 见文件抬头的 Add context 那一段。
      const canvas = await ensureCanvasDraft({ requestId: requestId() });
      if ("error" in canvas) {
        setAttachError(canvas.error);
        return;
      }
      const outcome = await uploadFilesDirect([file], () => {});
      if (outcome.files.length === 0) {
        setAttachError(outcome.failures[0]?.reason ?? UPLOAD_FAILURE_COPY.blocked);
        return;
      }
      const finalized = await finalizeCandidateUploads(canvas.projectId, "", [], outcome.files);
      if ("error" in finalized || !finalized.generationIds?.[0]) {
        setAttachError("error" in finalized ? finalized.error : UPLOAD_FAILURE_COPY.blocked);
        return;
      }
      attach({
        generationId: finalized.generationIds[0],
        src: URL.createObjectURL(file),
        kind: "image",
        previewKind: "image",
        label: composerReferenceLabel(file.name, "image"),
      });
    } catch {
      // 底层原文只进日志:商家读到的永远是这一句商家话(与画布 composer 同一条规矩)。
      setAttachError(UPLOAD_FAILURE_COPY.blocked);
    } finally {
      setUploading(false);
    }
  }

  /**
   * 一把闸,两个入口。发送键 `disabled={busy}`,而 Enter 从前只看 `pending` —— 上传还没落地时
   * 商家敲一下 Enter,画布照开、那张正在传的图**不在 references 里**(它此刻还没有 generationId),
   * 屏幕上也没有一个字说它掉了。同一把闸(判官 #1242 第二轮 P1-1)。
   */
  const busy = pending || uploading;

  function startCanvas(prompt: string) {
    if (busy) return;
    const trimmed = prompt.trim();
    if (!trimmed) {
      setError("Describe what you want to create.");
      return;
    }
    setError(null);
    /**
     * 一件参考只有在它的 `@名字` 还留在送出的那句话里时才算数 —— 这条规则不在这里重写,
     * 直接用 picker 自己的 `entityIdsForSend`(商家把 `@名字` 删掉,引用就跟着下车)。
     */
    const sentEntityIds = new Set(picker.entityIdsForSend(trimmed));
    const references: ReferenceRef[] = [
      // 上传与素材库挑的,在本仓库都是一行 `Generation`(上传只是 `source = UPLOAD`)。
      ...attached.map((reference) => ({ type: "generation" as const, id: reference.generationId })),
      ...picker.picked.filter((entry) => sentEntityIds.has(entry.ref.id)).map((entry) => entry.ref),
    ];
    startTransition(async () => {
      const result = await createCanvasConversation({
        prompt: trimmed,
        requestId: requestId(),
        ...(references.length ? { references } : {}),
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(canvasHref(result.projectId, {
        threadId: result.threadId,
        handoffId: result.handoffId,
      }));
    });
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startCanvas(draft);
      }}
    >
      <Field data-invalid={Boolean(error)}>
        <ReferencePickerMenu {...picker.menuProps}>
          <InputGroup className="flex-col items-stretch rounded-[var(--radius-card)] bg-background p-2">
            {attached.length > 0 && (
              <div className="flex flex-wrap gap-2 px-1 pb-1">
                {attached.map((reference) => (
                  <div
                    key={reference.generationId}
                    className="flex items-center gap-2 rounded-[var(--radius)] bg-muted px-2 py-1 text-xs"
                  >
                    {/* Decorative — the name is right beside it in the same chip. 影片走
                        `<video>`:同一个 `previewKind` 判据画布 composer(`OttoChatStream`)也在用,
                        Library 挑一段影片过来时 `<img>` 只会画出一个破图(判官 #1242 第二轮 P2-1)。 */}
                    {reference.previewKind === "video" ? (
                      <video
                        src={reference.src}
                        muted
                        playsInline
                        preload="metadata"
                        className="size-5 rounded-[2px] object-cover"
                      />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={reference.src} alt="" className="size-5 rounded-[2px] object-cover" />
                    )}
                    <span className="max-w-72 truncate">{reference.label}</span>
                    <Button
                      type="button"
                      aria-label={`Remove ${reference.label}`}
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => detach(reference)}
                    >
                      <XIcon className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <InputGroupTextarea
              ref={textareaRef}
              aria-label="Otto creation prompt"
              className="w-full px-2.5 py-2 text-base leading-6 min-h-[78px]"
              placeholder="Describe an image or video to create"
              value={draft}
              aria-invalid={Boolean(error)}
              maxLength={4000}
              {...picker.ariaProps}
              onChange={(event) => {
                setDraft(event.target.value);
                picker.handleTextChange(event.target.value, event.target.selectionStart ?? event.target.value.length);
                if (error) setError(null);
              }}
              onKeyDown={(event) => {
                // 引用菜单开着时,方向键与 Enter 属于菜单 —— 它吃下了就不再送出。
                if (picker.handleKeyDown(event)) return;
                if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && draft.trim()) {
                  event.preventDefault();
                  startCanvas(draft);
                }
              }}
            />
            {/* Hidden file input — opened by the "Upload image" item above. `@/components/ui`
                is the only wrapper layer商家可见面允许用的原语(#840 围栏),画布那一份
                (`OttoChatStream`)也是这么写的。 */}
            <Input
              hidden
              ref={fileInputRef}
              type="file"
              accept={ACCEPT_ENTRY_IMAGE}
              onChange={(event) => void handleFilePick(event)}
            />
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      aria-label="Add a reference"
                      size="icon-sm"
                      variant="ghost"
                      disabled={busy}
                      className={attached.length ? "text-primary" : "text-muted-foreground"}
                    >
                      {uploading ? <Spinner aria-label="Attaching reference" /> : <PlusIcon aria-hidden="true" />}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" side="top">
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Add a reference</DropdownMenuLabel>
                      <DropdownMenuItem onSelect={() => fileInputRef.current?.click()}>
                        <UploadIcon aria-hidden="true" />
                        Upload image
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setLibraryOpen(true)}>
                        <ImagesIcon aria-hidden="true" />
                        Choose from Library
                      </DropdownMenuItem>
                    </DropdownMenuGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <span className="hidden text-xs text-muted-foreground sm:inline">Add context</span>
              </div>
              <Button
                type="submit"
                aria-label="Send prompt"
                disabled={busy || !draft.trim()}
                size="icon-sm"
                variant="otto"
              >
                {pending ? <Spinner aria-label={`Starting ${PRODUCT_VOCABULARY.canvas}`} /> : <ArrowUpIcon />}
              </Button>
            </div>
          </InputGroup>
        </ReferencePickerMenu>
        <FieldError>{error ?? attachError}</FieldError>
      </Field>
      {/* 披露先于扣费(Founder 2026-09-05 裁决②「输入框下加一行价钱」;登记在
          `docs/specs/frontend-baseline.md` §5)。按一下这个发送键就在同一笔事务里开一条
          `surface="canvas"` 的对话,画布挂载即把这第一轮送出去 —— 那一轮**本身按用量计费**,
          而这条路径此前从按下到扣钱全程零披露。挂的是画布与门厅用的**同一个**组件,不是
          第二份价目:数值只有 `lib/credit-format.ts` 一处作者,这份文件里一个钱数都不写。
          裁决五删掉的「Create with Otto」标题行与「Nothing paid starts…」那句不恢复 ——
          松开的只有「这一页不出现价钱」这一格。挂参考本身不花钱,所以这一句不随参考变。 */}
      {/* 上传即自动理解,而自动理解**是一笔真的钱**(MONEY-A9「披露先于扣费」)。本刀之前这一页
          传不了东西,所以这一句不在;本刀给它装上了 Upload image,这一句就跟着来 —— 挂的是
          三处上传口用的**同一个**组件(`components/otto/UnderstandingCostHint.tsx`),不是这一页
          自己写的第二份价目,而且它在文件选择器还没打开的时候就在屏幕上。 */}
      <div className="mt-2 flex flex-col gap-0.5">
        <UnderstandingCostHint />
        <ConversationCostHint />
      </div>
      <CanvasLibraryPicker open={libraryOpen} onOpenChange={setLibraryOpen} onPick={attach} />
    </form>
  );
}

export default StartSomething;
