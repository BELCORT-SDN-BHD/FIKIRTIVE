"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Badge } from "@/components/ui/badge";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { ChevronRight, Eye, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { addMemory, deleteMemory, updateMemory, type MemoryRow } from "@/lib/memory-actions";
import { useOttoPanelControls } from "@/components/otto/panel/OttoPanelShell";
import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import { OTTO_IQ_FIXTURE_SAVED_KEY, appendOttoIQSavedRow, readOttoIQSavedRows } from "./otto-iq-fixture";
import { OTTO_RESEARCH_SAMPLE_SITE, requestOttoSiteResearch } from "@/components/otto/conversation/otto-research";
import "./r22-otto-iq.css";
import "./r22-otto-iq-hub.css";
import "./r22-knowledge-flow.css";

type Pane = "hub" | "voice" | "audiences" | "sources" | "style" | "visual";
type Card = {
  id: Exclude<Pane, "hub">;
  title: string;
  description: string;
  categories: string[];
};

const CARDS: Card[] = [
  { id: "voice", title: "Brand Voice", description: "How you sound. Otto reads this before writing any caption or reply.", categories: ["voice", "tone"] },
  { id: "audiences", title: "Audiences", description: "Who you are writing to. Otto picks one before drafting.", categories: ["audience", "people"] },
  { id: "sources", title: "Knowledge Base", description: "Pages, files and notes you choose for Otto to use — each one keeps its source.", categories: ["knowledge", "source", "fact", "product"] },
  { id: "style", title: "Style Guide", description: "Writing defaults, approved language and claims Otto must avoid.", categories: ["style", "rule", "never", "do not say"] },
  { id: "visual", title: "Visual Guidelines", description: "The images, colours and framing Otto can reference when making a picture.", categories: ["visual", "look", "color", "colour"] },
];

/**
 * beta V1 只做 creation(Founder 2026-08-26)。Brand Voice 的真路 —— 读商家自己的素材生成
 * 一份声音 —— 还没接上,生产上按下「Generate voice」只会撞上一句实话,而那句实话要等他
 * 填完名字与 1000 字素材两屏才出现。
 *
 * 处置照 `BETA_HIDDEN_NAV_KEYS` 的手法:**只藏入口,不删面**。hub 上不摆这张卡,
 * `/brand?tab=voice` 直接输地址仍然到得了,那一面的诚实阻断一个字没动。门回来的时候
 * 把这张表清空即可。
 */
const BETA_HIDDEN_CARDS: ReadonlyArray<Exclude<Pane, "hub">> = ["voice"];

function rowName(row: MemoryRow): string {
  return row.content.split(":", 1)[0]?.trim() || "Untitled context";
}

type BrandVoiceSource = "text" | "url" | "file";
type BrandVoiceStep = "details" | "source" | "generating" | "review" | "success";
const BRAND_VOICE_DRAFT_KEY = "r22:brand-voice:draft";
const BRAND_VOICE_SAVED_KEY = "r22:brand-voice:saved";
const KNOWLEDGE_DRAFT_KEY = "r22:knowledge-base:draft:v1";
const AUDIENCE_DRAFT_KEY = "r22:audience:draft:v1";
const STYLE_DRAFT_KEY = "r22:style-guide:draft:v1";
const VISUAL_DRAFT_KEY = "r22:visual-guideline:draft:v1";
const FIXTURE_UPDATED_AT = "2026-08-25T08:42:00.000Z";

function fixtureMemoryId(kind: string, material: string): string {
  const slug = material.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "untitled";
  return `fixture-${kind}-${slug}`;
}

function fixtureUpdatedAt(): Date { return new Date(FIXTURE_UPDATED_AT); }

function readFixtureSession(key: string): string | null {
  try { return window.sessionStorage.getItem(scopedR22FixtureKey(key)); } catch { return null; }
}

function writeFixtureSession(key: string, value: string) {
  try { window.sessionStorage.setItem(scopedR22FixtureKey(key), value); } catch { /* The surface still works without refresh recovery. */ }
}

function removeFixtureSession(key: string) {
  try { window.sessionStorage.removeItem(scopedR22FixtureKey(key)); } catch { /* The surface still works without refresh recovery. */ }
}

/**
 * 一行表单 = 标签 + 控件 + (计数/提示) + (就近的错误)。归位 `ui/field`(审计 A-11)。
 *
 * 此前这一面写的是 `<label>名字<Input/><small>12 / 80</small></label>`,而那句 `role="alert"`
 * 的错误挂在**整块字段的末尾** —— 商家在第一格填错,话出现在第五格底下,而且没有任何
 * 程序上的关联:读屏软件读到那个输入框时不会把错误一起念出来。
 *
 * 这里把三件事一次接对:错误长在出错的那一格旁边(`FieldError`),用 `aria-describedby`
 * 接进控件,`aria-invalid` 让边框自己红。字数计数改住 `FieldDescription` —— 它本来就是
 * 「这一格的补充说明」那一格。
 */
function FlowField({ id, label, hint, error, className, children }: {
  id: string;
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: (control: { id: string; "aria-describedby": string | undefined; "aria-invalid": true | undefined }) => React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
  return (
    <Field className={className} data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? <FieldDescription id={hintId}>{hint}</FieldDescription> : null}
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  );
}

/** 不长在任何单一格子上的错误(整块的、跨字段的)仍要有去处 —— 同一个 `FieldError`。 */
function FlowFormError({ error }: { error: string }) {
  return <FieldError className="r22-brand-voice-error">{error}</FieldError>;
}

function BrandVoiceFlow({
  open,
  fixture,
  onOpenChange,
  onFixtureSave,
}: {
  open: boolean;
  fixture: boolean;
  onOpenChange: (open: boolean) => void;
  onFixtureSave: (row: MemoryRow) => void;
}) {
  const [step, setStep] = useState<BrandVoiceStep>("details");
  const [name, setName] = useState("");
  const [access, setAccess] = useState<"workspace" | "private">("workspace");
  const [bestUse, setBestUse] = useState("Company profile");
  const [source, setSource] = useState<BrandVoiceSource>("text");
  const [sourceText, setSourceText] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [description, setDescription] = useState("");
  const [excerpts, setExcerpts] = useState(["", "", ""]);
  const [error, setError] = useState("");
  /** 出错的是**哪一格** —— 有它,错误才长得到那一格旁边(审计 A-11)。空串 = 整块的错。 */
  const [errorField, setErrorField] = useState("");
  const [draftReady, setDraftReady] = useState(!fixture);
  const [cancelOpen, setCancelOpen] = useState(false);
  const fail = (field: string, message: string) => { setErrorField(field); setError(message); };
  const clearError = () => { setErrorField(""); setError(""); };

  useEffect(() => {
    if (!open) { setDraftReady(!fixture); return; }
    setCancelOpen(false);
    if (fixture) {
      const stored = readFixtureSession(BRAND_VOICE_DRAFT_KEY);
      if (stored) {
        try {
          const draft = JSON.parse(stored) as { version?: number; step?: BrandVoiceStep; name?: string; access?: "workspace" | "private"; bestUse?: string; source?: BrandVoiceSource; sourceText?: string; sourceUrl?: string; fileName?: string; description?: string; excerpts?: string[]; error?: string; errorField?: string };
          if (draft.version !== 1) throw new Error("stale draft");
          setStep(draft.step === "success" ? "review" : draft.step ?? "details");
          setName(draft.name ?? ""); setAccess(draft.access ?? "workspace"); setBestUse(draft.bestUse ?? "Company profile"); setSource(draft.source ?? "text"); setSourceText(draft.sourceText ?? ""); setSourceUrl(draft.sourceUrl ?? ""); setFileName(draft.fileName ?? ""); setDescription(draft.description ?? ""); setExcerpts(draft.excerpts?.length === 3 ? draft.excerpts : ["", "", ""]); setError(draft.error ?? ""); setErrorField(draft.errorField ?? "");
          setDraftReady(true);
          return;
        } catch {
          removeFixtureSession(BRAND_VOICE_DRAFT_KEY);
        }
      }
    }
    setStep("details"); setName(""); setAccess("workspace"); setBestUse("Company profile"); setSource("text"); setSourceText(""); setSourceUrl(""); setFileName(""); setDescription(""); setExcerpts(["", "", ""]); setError(""); setErrorField(""); setDraftReady(true);
  }, [fixture, open]);

  useEffect(() => {
    if (!fixture || !open || !draftReady || step === "success") return;
    writeFixtureSession(BRAND_VOICE_DRAFT_KEY, JSON.stringify({ version: 1, step, name, access, bestUse, source, sourceText, sourceUrl, fileName, description, excerpts, error, errorField }));
  }, [access, bestUse, description, draftReady, error, errorField, excerpts, fileName, fixture, name, open, source, sourceText, sourceUrl, step]);

  useEffect(() => {
    if (!open || step !== "generating") return;
    const timer = window.setTimeout(() => {
      setDescription("Clear, warm and practical. The voice uses specific product details, calm confidence and direct language without invented claims.");
      setExcerpts(["Made for slower mornings, with useful details before decoration.", "A calm Raya launch that keeps the product and its proof in view.", "Warm, direct and specific — never louder than the customer needs."]);
      setStep("review");
    }, 560);
    return () => window.clearTimeout(timer);
  }, [open, step]);

  function continueDetails() {
    if (!name.trim()) return fail("name", "Give this Brand Voice a name.");
    if (!bestUse.trim()) return fail("bestUse", "Add at least one best-use label.");
    clearError();
    setStep("source");
  }

  function generate() {
    if (source === "text" && sourceText.trim().length < 1000) return fail("source", "1000 character minimum not met. Add more approved example content.");
    if (source === "url" && !/^https?:\/\//i.test(sourceUrl.trim())) return fail("source", "Enter a complete http or https URL you own or may use.");
    if (source === "file" && !fileName) return fail("source", "Choose a supported file before generating.");
    // 生产不许进伪造。`generating` 那一步之后是写死的描述与三条摘录 —— 那是**演示**,
    // 不是这家商家粘贴的内容读出来的。以前它照样跑,商家一路读到与自己毫无关系的
    // 「生成结果」,直到 Save 才撞上 `save()` 里那句实话。诚实要在花商家时间之前说,
    // 所以阻断挪到入口,用的是同一句话;fixture 一个字节没变。
    // 形状与同文件的兄弟流一致(KnowledgeBaseFlow `submit()`、AudienceFlow `next()`)。
    if (!fixture) return fail("source", "Making a Brand Voice from your own material is not switched on yet. Nothing was saved.");
    clearError();
    setStep("generating");
  }

  function save() {
    if (!description.trim()) return fail("description", "Keep a Brand Voice description before saving.");
    if (!fixture) return fail("description", "Making a Brand Voice from your own material is not switched on yet. Nothing was saved.");
    onFixtureSave({
      id: fixtureMemoryId("voice", name),
      category: "voice",
      content: `${name.trim()}: ${description.trim()}`,
      source: "user",
      pinned: true,
      updatedAt: fixtureUpdatedAt(),
    });
    removeFixtureSession(BRAND_VOICE_DRAFT_KEY);
    setStep("success");
  }

  const sourceLabel = source === "text" ? "Pasted approved text" : source === "url" ? sourceUrl || "Website URL" : fileName || "Uploaded file";
  const dirty = step !== "details" || Boolean(name.trim() || sourceText.trim() || sourceUrl.trim() || fileName || description.trim());
  const requestClose = () => dirty ? setCancelOpen(true) : onOpenChange(false);
  const discardDraft = () => {
    if (fixture) removeFixtureSession(BRAND_VOICE_DRAFT_KEY);
    setCancelOpen(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : requestClose()}>
      <DialogContent className="r22-brand-voice-flow" showCloseButton={false}>
        {step === "details" ? <>
          <DialogHeader><DialogTitle>Add Brand Voice</DialogTitle><DialogDescription>Voice details</DialogDescription></DialogHeader>
          <div className="r22-brand-voice-layout"><div className="r22-brand-voice-fields">
            <h2>Voice details</h2><p>Give your voice a name and choose who can access it. You’ll add example content on the next step.</p>
            <FlowField id="voice-name" label="Name" hint={`${name.length} / 80`} error={errorField === "name" ? error : undefined}>{(control) => <Input unstyled autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Batik House voice" {...control} />}</FlowField>
            <FieldSet><FieldLegend variant="label">Voice access</FieldLegend><RadioGroup unstyled value={access} onValueChange={(value) => setAccess(value as "workspace" | "private")}><label className={access === "workspace" ? "is-selected" : ""}><RadioGroupItem unstyled value="workspace" /><span><b>Anyone in this workspace</b><small>Workspace members can use this voice.</small></span></label><label className={access === "private" ? "is-selected" : ""}><RadioGroupItem unstyled value="private" /><span><b>Private to me</b><small>Only you can access and use this voice.</small></span></label></RadioGroup></FieldSet>
            <FlowField id="voice-best-use" label="Best used for" error={errorField === "bestUse" ? error : undefined}>{(control) => <Input unstyled value={bestUse} onChange={(event) => setBestUse(event.target.value)} placeholder="Company profile, blogs, product launches" {...control} />}</FlowField>
          </div><aside className="r22-brand-voice-preview"><b>{name || "Untitled Brand Voice"}</b><span>Best used for: {bestUse || "Not set"}</span><span>Visibility: {access === "workspace" ? "Anyone" : "Private"}</span><Separator /><small>EXAMPLE CONTENT</small><i /><i /><small>DESCRIPTION</small><i /><i /></aside></div>
          {error && !errorField ? <FlowFormError error={error} /> : null}
          <DialogFooter><Button unstyled type="button" className="is-quiet" onClick={requestClose}>Cancel</Button><Button unstyled type="button" className="is-primary" onClick={continueDetails}>Next</Button></DialogFooter>
        </> : step === "source" ? <>
          <DialogHeader><DialogTitle>Add Brand Voice</DialogTitle><DialogDescription>Add example content</DialogDescription></DialogHeader>
          <div className="r22-brand-voice-layout"><div className="r22-brand-voice-fields">
            <h2>Add example content</h2><p>Add up to 8 examples. The more on-brand and high-quality the examples are, the better your voice will be.</p>
            <Tabs unstyled value={source} onValueChange={(value) => { setSource(value as BrandVoiceSource); clearError(); }}><TabsList unstyled className="r22-brand-source-tabs"><TabsTrigger unstyled value="text">Paste text</TabsTrigger><TabsTrigger unstyled value="url">Add URLs</TabsTrigger><TabsTrigger unstyled value="file">Upload files</TabsTrigger></TabsList></Tabs>
            {source === "text" ? <FlowField key="source-text" id="voice-source-text" label="Approved example text" hint={`${sourceText.trim().length} characters · 1000 character minimum`} error={errorField === "source" ? error : undefined}>{(control) => <Textarea unstyled rows={9} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste a blog, email, social post, or other approved content." {...control} />}</FlowField> : source === "url" ? <FlowField key="source-url" id="voice-source-url" label="Website URL" hint="FIKIRTIVE will only use this page once reading links is switched on and you confirm you may use it." error={errorField === "source" ? error : undefined}>{(control) => <Input unstyled type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://batikhouse.example/about" {...control} />}</FlowField> : <FlowField key="source-file" className="r22-brand-file" id="voice-source-file" label="Upload a file" hint={fileName || "TXT, DOC, DOCX or PDF"} error={errorField === "source" ? error : undefined}>{(control) => <Input unstyled type="file" accept=".txt,.doc,.docx,.pdf" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} {...control} />}</FlowField>}
            <div className="r22-brand-added"><b>Added context</b><span>{sourceLabel}</span></div>
          </div><aside className="r22-brand-voice-preview"><b>{name}</b><span>Best used for: {bestUse}</span><span>Visibility: {access === "workspace" ? "Anyone" : "Private"}</span><Separator /><small>EXAMPLE CONTENT</small><i /><i /><small>DESCRIPTION</small><i /><i /></aside></div>
          {error && !errorField ? <FlowFormError error={error} /> : null}
          <DialogFooter><Button unstyled type="button" className="is-quiet" onClick={() => setStep("details")}>Back</Button><Button unstyled type="button" className="is-primary" onClick={generate}>Generate voice</Button></DialogFooter>
        </> : step === "generating" ? <div className="r22-brand-generating" aria-live="polite"><Spinner aria-hidden="true" /><DialogTitle>Generating Brand Voice</DialogTitle><DialogDescription>We are reading the material you added. Nothing is marked done until that finishes.</DialogDescription><article><b>{name}</b><small>Reviewing your sources</small><i /><i /><i /></article></div> : step === "review" ? <>
          <DialogHeader><DialogTitle>Review and edit</DialogTitle><DialogDescription>Check this voice before you save it for Otto to use.</DialogDescription></DialogHeader>
          <div className="r22-brand-review"><FlowField id="voice-description" label="Description" error={errorField === "description" ? error : undefined}>{(control) => <Textarea unstyled rows={7} value={description} onChange={(event) => setDescription(event.target.value)} {...control} />}</FlowField><FieldSet><FieldLegend variant="label">Excerpts</FieldLegend>{excerpts.map((excerpt, index) => <Textarea unstyled rows={3} aria-label={`Excerpt ${index + 1}`} key={index} value={excerpt} onChange={(event) => setExcerpts((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />)}</FieldSet><p>Source: {sourceLabel} · Scope: {access === "workspace" ? "Workspace" : "Private"}</p></div>
          {error && !errorField ? <FlowFormError error={error} /> : null}
          <DialogFooter><Button unstyled type="button" className="is-quiet" onClick={() => setStep("source")}>Back</Button><Button unstyled type="button" className="is-primary" onClick={save}>Save Brand Voice</Button></DialogFooter>
        </> : <div className="r22-brand-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>Brand Voice saved</DialogTitle><DialogDescription>{name} is saved for Otto to use in this workspace.</DialogDescription><Button unstyled type="button" className="is-primary" onClick={() => onOpenChange(false)}>Done</Button></div>}
      </DialogContent>
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="r22-brand-cancel-dialog"><AlertDialogHeader><AlertDialogTitle>Discard this Brand Voice draft?</AlertDialogTitle><AlertDialogDescription>Your current step and approved examples are kept if you refresh. Discarding removes only this draft and leaves everything already in Otto IQ untouched.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={discardDraft}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </Dialog>
  );
}

/**
 * P2-9(beta 卫生大扫除 2026-08-26):这一层原本把 From text / Upload file / Enter URL
 * 三条路画得一样真,而后两条在生产上走到底只有一句「Links and file uploads are not
 * switched on yet」。收成能真的存下来的那一条 —— 选择器只剩一颗时它本身也没有意义了,
 * 所以按下 Add 直接进表单。读链接与读文件回来的时候,把选择器与另两条支路一起加回来。
 */
type KnowledgeStep = "form" | "processing" | "success";

function KnowledgeBaseFlow({ open, fixture, onOpenChange, onSaved }: {
  open: boolean;
  fixture: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (row: MemoryRow) => void;
}) {
  const [step, setStep] = useState<KnowledgeStep>("form");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");
  const [workspace, setWorkspace] = useState(true);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(!fixture);
  const fail = (field: string, message: string) => { setErrorField(field); setError(message); };
  const clearError = () => { setErrorField(""); setError(""); };

  useEffect(() => {
    if (!open) { setDraftReady(!fixture); return; }
    setCancelOpen(false);
    const stored = fixture ? readFixtureSession(KNOWLEDGE_DRAFT_KEY) : null;
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { version?: number; name?: string; content?: string; tags?: string; workspace?: boolean; error?: string; errorField?: string };
        if (draft.version !== 2) throw new Error("stale draft");
        setStep("form"); setName(draft.name ?? ""); setContent(draft.content ?? ""); setTags(draft.tags ?? ""); setWorkspace(draft.workspace ?? true); setError(draft.error ?? ""); setErrorField(draft.errorField ?? ""); setDraftReady(true); return;
      } catch { removeFixtureSession(KNOWLEDGE_DRAFT_KEY); }
    }
    setStep("form"); setName(""); setContent(""); setTags(""); setWorkspace(true); setError(""); setErrorField(""); setDraftReady(true);
  }, [fixture, open]);

  useEffect(() => {
    if (!fixture || !open || !draftReady || step === "success") return;
    writeFixtureSession(KNOWLEDGE_DRAFT_KEY, JSON.stringify({ version: 2, name, content, tags, workspace, error, errorField }));
  }, [content, draftReady, error, errorField, fixture, name, open, step, tags, workspace]);

  useEffect(() => {
    if (!open || step !== "processing" || !fixture) return;
    const timer = window.setTimeout(() => {
      onSaved({ id: fixtureMemoryId("knowledge", name), category: "knowledge", content: `${name.trim()}: ${content.trim().slice(0, 220)}`, source: "user", pinned: workspace, updatedAt: fixtureUpdatedAt() });
      removeFixtureSession(KNOWLEDGE_DRAFT_KEY);
      setStep("success");
    }, 620);
    return () => window.clearTimeout(timer);
  }, [content, fixture, name, onSaved, open, step, workspace]);

  const dirty = Boolean(name.trim() || content.trim() || tags.trim());
  const requestClose = () => dirty ? setCancelOpen(true) : onOpenChange(false);

  const submit = async () => {
    if (!name.trim()) return fail("name", "Give this source a name.");
    if (!content.trim()) return fail("body", "Add the approved text Otto may reference.");
    clearError();
    if (fixture) { setStep("processing"); return; }
    const result = await addMemory({ category: "knowledge", content: `${name.trim()}: ${content.trim()}` });
    if ("error" in result) return fail("", result.error);
    onSaved({ id: result.id, category: "knowledge", content: `${name.trim()}: ${content.trim()}`, source: "user", pinned: workspace, updatedAt: new Date() });
    setStep("success");
  };

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : requestClose()}>
    <DialogContent className="r22-kb-flow" showCloseButton={false}>
      {step === "processing" ? <div className="r22-kb-processing" aria-live="polite"><Spinner aria-hidden="true" /><DialogTitle>Reading {name}</DialogTitle><DialogDescription>Usually under a minute. This source is not available to Otto until processing finishes.</DialogDescription><Progress className="r22-kb-progress" aria-label="Working" /></div> : step === "success" ? <div className="r22-brand-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>Knowledge source saved</DialogTitle><DialogDescription>{name} is saved for {workspace ? "everyone in this workspace" : "you only"}.</DialogDescription><Button unstyled type="button" className="is-primary" onClick={() => onOpenChange(false)}>Done</Button></div> : <>
        <DialogHeader><DialogTitle>Add text to Knowledge Base</DialogTitle><DialogDescription>Add only material this workspace is allowed to use. Nothing is saved until you add it.</DialogDescription></DialogHeader>
        <div className="r22-kb-fields">
          <FlowField id="kb-name" label="Name" hint={`${name.length} / 100`} error={errorField === "name" ? error : undefined}>{(control) => <Input unstyled autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder="What Otto should call this" {...control} />}</FlowField>
          <FlowField id="kb-body" label="What Otto should know" hint={`${content.length} / 200000`} error={errorField === "body" ? error : undefined}>{(control) => <Textarea unstyled rows={8} maxLength={200000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Paste material this workspace may use." {...control} />}</FlowField>
          <FlowField id="kb-tags" label="Tags">{(control) => <Input unstyled value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Brand story" {...control} />}</FlowField>
          <label className="r22-kb-check"><Checkbox unstyled checked={workspace} onCheckedChange={(checked) => setWorkspace(checked === true)} />Available to this workspace</label>
          {error && !errorField ? <FlowFormError error={error} /> : null}
        </div>
        <DialogFooter><Button unstyled type="button" className="is-quiet" onClick={requestClose}>Cancel</Button><Button unstyled type="button" className="is-primary" onClick={() => void submit()}>Add to Knowledge Base</Button></DialogFooter>
      </>}
    </DialogContent>
    <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="r22-brand-cancel-dialog"><AlertDialogHeader><AlertDialogTitle>Discard this knowledge draft?</AlertDialogTitle><AlertDialogDescription>The name, text, tags and visibility will be cleared.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { removeFixtureSession(KNOWLEDGE_DRAFT_KEY); setCancelOpen(false); onOpenChange(false); }}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </Dialog>;
}

/**
 * P2-10(beta 卫生大扫除 2026-08-26):这条流原本四步 —— 基本信息、Audience documentation、
 * Customer stories、Review。中间两步只做一件事:收 file / URL / 粘贴文本 / Knowledge Base
 * 四种来源,而生产上带着任何一条来源走到底,得到的是「Reading audience sources is not
 * switched on yet」。收成能真的存下来的两步(基本信息 + Review)。读来源回来的时候,把
 * 那两步与 `docs` / `stories` 一起加回来。
 */
function AudienceFlow({ open, fixture, onOpenChange, onSaved }: {
  open: boolean;
  fixture: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (row: MemoryRow) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"workspace" | "private">("workspace");
  const [triggers, setTriggers] = useState(["Looks for a thoughtful weekend gift"]);
  const [requirements, setRequirements] = useState(["Gift-ready after work"]);
  const [indicators, setIndicators] = useState(["Weekend orders"]);
  const [characteristics, setCharacteristics] = useState([{ key: "Shopping window", value: "Friday evening" }]);
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState("");
  const [status, setStatus] = useState<"editing" | "processing" | "success">("editing");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(!fixture);
  const fail = (field: string, message: string) => { setErrorField(field); setError(message); };
  const clearError = () => { setErrorField(""); setError(""); };

  useEffect(() => {
    if (!open) { setDraftReady(!fixture); return; }
    setCancelOpen(false);
    const stored = fixture ? readFixtureSession(AUDIENCE_DRAFT_KEY) : null;
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { version?: number; step?: number; name?: string; description?: string; scope?: "workspace" | "private"; triggers?: string[]; requirements?: string[]; indicators?: string[]; characteristics?: Array<{ key: string; value: string }>; error?: string; errorField?: string };
        if (draft.version !== 2) throw new Error("stale draft");
        setStep(Math.min(1, Math.max(0, draft.step ?? 0))); setName(draft.name ?? ""); setDescription(draft.description ?? ""); setScope(draft.scope ?? "workspace"); setTriggers(draft.triggers ?? [""]); setRequirements(draft.requirements ?? [""]); setIndicators(draft.indicators ?? [""]); setCharacteristics(draft.characteristics ?? []); setError(draft.error ?? ""); setErrorField(draft.errorField ?? ""); setStatus("editing"); setDraftReady(true); return;
      } catch { removeFixtureSession(AUDIENCE_DRAFT_KEY); }
    }
    setStep(0); setName(""); setDescription(""); setScope("workspace"); setTriggers(["Looks for a thoughtful weekend gift"]); setRequirements(["Gift-ready after work"]); setIndicators(["Weekend orders"]); setCharacteristics([{ key: "Shopping window", value: "Friday evening" }]); setError(""); setErrorField(""); setStatus("editing"); setDraftReady(true);
  }, [fixture, open]);

  useEffect(() => {
    if (!fixture || !open || !draftReady || status !== "editing") return;
    writeFixtureSession(AUDIENCE_DRAFT_KEY, JSON.stringify({ version: 2, step, name, description, scope, triggers, requirements, indicators, characteristics, error, errorField }));
  }, [characteristics, description, draftReady, error, errorField, fixture, indicators, name, open, requirements, scope, status, step, triggers]);

  const next = async () => {
    if (step === 0 && !name.trim()) return fail("name", "Add both a name and description.");
    if (step === 0 && !description.trim()) return fail("description", "Add both a name and description.");
    if (step < 1) { clearError(); setStep((value) => value + 1); return; }
    const reviewComplete = [...triggers, ...requirements, ...indicators].every((item) => item.trim()) && characteristics.every((item) => item.key.trim() && item.value.trim());
    if (!reviewComplete) return fail("", "Complete every audience detail before generating.");
    clearError(); setStatus("processing");
    const saveRow = async () => {
      const content = `${name.trim()}: ${description.trim()} Buying triggers: ${triggers.join("; ")}. Requirements: ${requirements.join("; ")}. Success: ${indicators.join("; ")}.`;
      if (fixture) return { id: fixtureMemoryId("audience", name), category: "audience", content, source: "user" as const, pinned: scope === "workspace", updatedAt: fixtureUpdatedAt() };
      const result = await addMemory({ category: "audience", content });
      if ("error" in result) { setStatus("editing"); fail("", result.error); return null; }
      return { id: result.id, category: "audience", content, source: "user" as const, pinned: scope === "workspace", updatedAt: new Date() };
    };
    window.setTimeout(async () => {
      const row = await saveRow();
      if (!row) return;
      onSaved(row); removeFixtureSession(AUDIENCE_DRAFT_KEY); setStatus("success");
    }, fixture ? 620 : 0);
  };

  const dirty = step > 0 || Boolean(name.trim() || description.trim());
  const requestClose = () => dirty ? setCancelOpen(true) : onOpenChange(false);
  const editableList = (label: string, values: string[], setValues: React.Dispatch<React.SetStateAction<string[]>>) => <section className="r22-audience-list"><h3>{label} <span>{values.length} / 8</span></h3>{values.map((value, index) => <div key={`${label}-${index}`}><Input unstyled value={value} aria-label={`${label} ${index + 1}`} onChange={(event) => setValues((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><Button unstyled type="button" onClick={() => setValues((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></div>)}<Button unstyled type="button" className="is-quiet" disabled={values.length >= 8} onClick={() => setValues((current) => [...current, ""])}>Add</Button></section>;

  return <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : requestClose()}><DialogContent className="r22-kb-flow r22-audience-flow" showCloseButton={false}>
    {status === "processing" ? <div className="r22-kb-processing" aria-live="polite"><Spinner aria-hidden="true" /><DialogTitle>Generating audience</DialogTitle><DialogDescription>Reviewing the details and approved source list. Nothing is saved until this finishes.</DialogDescription><Progress className="r22-kb-progress" aria-label="Working" /></div> : status === "success" ? <div className="r22-brand-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>Audience saved</DialogTitle><DialogDescription>{name} is saved for Otto to use.</DialogDescription><Button unstyled className="is-primary" type="button" onClick={() => onOpenChange(false)}>Done</Button></div> : <>
      <DialogHeader><DialogTitle>Add Audience</DialogTitle><DialogDescription>{["Basic information", "Review"][step]}</DialogDescription></DialogHeader>
      <div className="r22-audience-steps" aria-label={`Step ${step + 1} of 2`}>{["Basic information", "Review"].map((label, index) => <span className={index === step ? "is-current" : index < step ? "is-done" : ""} key={label}>{index + 1} {label}</span>)}</div>
      <div className="r22-audience-layout"><div className="r22-kb-fields">{step === 0 ? <>
        <FlowField id="audience-name" label="Name" hint={`${name.length} / 100`} error={errorField === "name" ? error : undefined}>{(control) => <Input unstyled autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)} {...control} />}</FlowField>
        <FlowField id="audience-description" label="Description" hint={`${description.length} / 500`} error={errorField === "description" ? error : undefined}>{(control) => <Textarea unstyled rows={5} value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} {...control} />}</FlowField>
        <FieldSet><FieldLegend variant="label">Audience access</FieldLegend><RadioGroup unstyled value={scope} onValueChange={(value) => setScope(value as "workspace" | "private")}><label><RadioGroupItem unstyled value="workspace" />Anyone in this workspace</label><label><RadioGroupItem unstyled value="private" />Private to me</label></RadioGroup></FieldSet>
      </> : <>{editableList("Buying triggers", triggers, setTriggers)}{editableList("Use case requirements", requirements, setRequirements)}{editableList("Key success indicators", indicators, setIndicators)}<section className="r22-audience-list"><h3>Additional characteristics <span>{characteristics.length} / 10</span></h3>{characteristics.map((item, index) => <div key={index}><Input unstyled aria-label={`Characteristic ${index + 1} key`} value={item.key} placeholder="Key" onChange={(event) => setCharacteristics((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, key: event.target.value } : entry))} /><b>=</b><Input unstyled aria-label={`Characteristic ${index + 1} value`} value={item.value} placeholder="Value" onChange={(event) => setCharacteristics((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, value: event.target.value } : entry))} /><Button unstyled type="button" onClick={() => setCharacteristics((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></div>)}<Button unstyled className="is-quiet" type="button" disabled={characteristics.length >= 10} onClick={() => setCharacteristics((current) => [...current, { key: "", value: "" }])}>Add characteristic</Button></section></>}
        {error && !errorField ? <FlowFormError error={error} /> : null}</div><aside className="r22-audience-preview"><b>{name || "Audience"}</b><span>{scope === "workspace" ? "Workspace" : "Private"}</span><p>{description || "No description yet"}</p></aside></div>
      <DialogFooter><Button unstyled type="button" className="is-quiet" disabled={step === 0} onClick={() => { clearError(); setStep((value) => Math.max(0, value - 1)); }}>Back</Button><Button unstyled type="button" className="is-primary" onClick={() => void next()}>{step === 1 ? "Generate audience" : "Next"}</Button></DialogFooter>
    </>}
  </DialogContent><AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="r22-brand-cancel-dialog"><AlertDialogHeader><AlertDialogTitle>Discard this audience draft?</AlertDialogTitle><AlertDialogDescription>The audience details and review fields will be cleared.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { removeFixtureSession(AUDIENCE_DRAFT_KEY); setCancelOpen(false); onOpenChange(false); }}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></Dialog>;
}

function StyleGuideFlow({ open, fixture, onOpenChange, onSaved }: {
  open: boolean;
  fixture: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (row: MemoryRow) => void;
}) {
  const [kind, setKind] = useState<"never" | "promise">("never");
  const [phrase, setPhrase] = useState("");
  const [replacement, setReplacement] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState("");
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const fail = (field: string, message: string) => { setErrorField(field); setError(message); };

  useEffect(() => {
    if (!open) return;
    const stored = fixture ? readFixtureSession(STYLE_DRAFT_KEY) : null;
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { version?: number; kind?: "never" | "promise"; phrase?: string; replacement?: string; reason?: string };
        if (draft.version === 1) { setKind(draft.kind ?? "never"); setPhrase(draft.phrase ?? ""); setReplacement(draft.replacement ?? ""); setReason(draft.reason ?? ""); setError(""); setErrorField(""); setSuccess(false); return; }
      } catch { removeFixtureSession(STYLE_DRAFT_KEY); }
    }
    setKind("never"); setPhrase(""); setReplacement(""); setReason(""); setError(""); setErrorField(""); setSuccess(false);
  }, [fixture, open]);

  useEffect(() => {
    if (!fixture || !open || success) return;
    writeFixtureSession(STYLE_DRAFT_KEY, JSON.stringify({ version: 1, kind, phrase, replacement, reason }));
  }, [fixture, kind, open, phrase, reason, replacement, success]);

  const save = async () => {
    if (!phrase.trim()) return fail("phrase", kind === "never" ? "Add the word or phrase Otto must avoid." : "Add the promise Otto must never make.");
    if (kind === "never" && !replacement.trim()) return fail("replacement", "Add the approved replacement Otto should use instead.");
    if (!reason.trim()) return fail("reason", "Explain why this rule exists.");
    setError(""); setErrorField(""); setBusy(true);
    const content = kind === "never" ? `Never say “${phrase.trim()}”. Use “${replacement.trim()}” instead. Why: ${reason.trim()}` : `Never promise “${phrase.trim()}”. Why: ${reason.trim()}`;
    let row: MemoryRow;
    if (fixture) row = { id: fixtureMemoryId("style", phrase), category: "style", content, source: "user", pinned: true, updatedAt: fixtureUpdatedAt() };
    else {
      const result = await addMemory({ category: "style", content });
      if ("error" in result) { setBusy(false); fail("", result.error); return; }
      row = { id: result.id, category: "style", content, source: "user", pinned: true, updatedAt: new Date() };
    }
    window.setTimeout(() => { onSaved(row); removeFixtureSession(STYLE_DRAFT_KEY); setBusy(false); setSuccess(true); }, fixture ? 420 : 0);
  };
  const dirty = Boolean(phrase.trim() || replacement.trim() || reason.trim());
  const requestClose = () => dirty && !success ? setCancelOpen(true) : onOpenChange(false);

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : requestClose()}><DialogContent className="r22-kb-flow r22-style-flow" showCloseButton={false}>{success ? <div className="r22-brand-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>Style rule saved</DialogTitle><DialogDescription>Otto follows this rule in everything it makes from now on.</DialogDescription><Button unstyled className="is-primary" type="button" onClick={() => onOpenChange(false)}>Done</Button></div> : <>
    <DialogHeader><DialogTitle>Add Style Guide rule</DialogTitle><DialogDescription>You can edit or remove this rule at any time, and it stays in this workspace.</DialogDescription></DialogHeader>
    <div className="r22-kb-fields"><FieldSet><FieldLegend variant="label">Rule type</FieldLegend><RadioGroup unstyled value={kind} onValueChange={(value) => setKind(value as "never" | "promise")}><label><RadioGroupItem unstyled value="never" />Never say</label><label><RadioGroupItem unstyled value="promise" />Promise we never make</label></RadioGroup></FieldSet>
      <FlowField id="style-phrase" label={kind === "never" ? "Word or phrase" : "Promise"} error={errorField === "phrase" ? error : undefined}>{(control) => <Input unstyled autoFocus value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder={kind === "never" ? "Cheap" : "Guaranteed results"} {...control} />}</FlowField>
      {kind === "never" ? <FlowField id="style-replacement" label="Use instead" error={errorField === "replacement" ? error : undefined}>{(control) => <Input unstyled value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="Accessible" {...control} />}</FlowField> : null}
      <FlowField id="style-reason" label="Why this matters" error={errorField === "reason" ? error : undefined}>{(control) => <Textarea unstyled rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Keep claims specific and supported by the product details." {...control} />}</FlowField>
      <p className="r22-kb-permission">This rule applies to new Otto drafts. Existing published or scheduled work is not rewritten.</p>{error && !errorField ? <FlowFormError error={error} /> : null}</div>
    <DialogFooter><Button unstyled type="button" className="is-quiet" disabled={busy} onClick={requestClose}>Cancel</Button><Button unstyled type="button" className="is-primary" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save rule"}</Button></DialogFooter>
  </>}</DialogContent><AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="r22-brand-cancel-dialog"><AlertDialogHeader><AlertDialogTitle>Discard this style rule?</AlertDialogTitle><AlertDialogDescription>The phrase, replacement and reason will be cleared.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { removeFixtureSession(STYLE_DRAFT_KEY); setCancelOpen(false); onOpenChange(false); }}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></Dialog>;
}

function VisualGuidelineFlow({ open, fixture, onOpenChange, onSaved }: {
  open: boolean;
  fixture: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (row: MemoryRow) => void;
}) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"workspace" | "private">("workspace");
  /** P2-11(beta 卫生大扫除 2026-08-26):Logo 那一格已删 —— 读 logo 文件在生产上没接上,
   *  留着它等于让商家选完一个文件再被拒。颜色、字体、取景方向三格都真的存得下来。 */
  const [colours, setColours] = useState(["#0D9488", "#D4A373"]);
  const [nextColour, setNextColour] = useState("#16171C");
  const [titleFont, setTitleFont] = useState("Fraunces");
  const [headingFont, setHeadingFont] = useState("Geist");
  const [bodyFont, setBodyFont] = useState("");
  const [guideline, setGuideline] = useState("");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState("");
  const [status, setStatus] = useState<"editing" | "processing" | "success">("editing");
  const [cancelOpen, setCancelOpen] = useState(false);
  const fail = (field: string, message: string) => { setErrorField(field); setError(message); };
  const clearError = () => { setErrorField(""); setError(""); };

  useEffect(() => {
    if (!open) return;
    const stored = fixture ? readFixtureSession(VISUAL_DRAFT_KEY) : null;
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { version?: number; step?: number; name?: string; scope?: "workspace" | "private"; colours?: string[]; nextColour?: string; titleFont?: string; headingFont?: string; bodyFont?: string; guideline?: string };
        if (draft.version === 2) { setStep(Math.min(2, Math.max(0, draft.step ?? 0))); setName(draft.name ?? ""); setScope(draft.scope ?? "workspace"); setColours(draft.colours ?? []); setNextColour(draft.nextColour ?? "#16171C"); setTitleFont(draft.titleFont ?? ""); setHeadingFont(draft.headingFont ?? ""); setBodyFont(draft.bodyFont ?? ""); setGuideline(draft.guideline ?? ""); setError(""); setErrorField(""); setStatus("editing"); return; }
      } catch { removeFixtureSession(VISUAL_DRAFT_KEY); }
    }
    setStep(0); setName(""); setScope("workspace"); setColours(["#0D9488", "#D4A373"]); setNextColour("#16171C"); setTitleFont("Fraunces"); setHeadingFont("Geist"); setBodyFont(""); setGuideline(""); setError(""); setErrorField(""); setStatus("editing");
  }, [fixture, open]);

  useEffect(() => {
    if (!fixture || !open || status !== "editing") return;
    writeFixtureSession(VISUAL_DRAFT_KEY, JSON.stringify({ version: 2, step, name, scope, colours, nextColour, titleFont, headingFont, bodyFont, guideline }));
  }, [bodyFont, colours, fixture, guideline, headingFont, name, nextColour, open, scope, status, step, titleFont]);

  const next = async () => {
    if (step === 0 && !name.trim()) return fail("name", "Give this Visual Guideline a name.");
    if (step === 1 && !colours.length) return fail("colours", "Keep at least one colour and add a framing guideline.");
    if (step === 1 && !guideline.trim()) return fail("guideline", "Keep at least one colour and add a framing guideline.");
    if (step < 2) { clearError(); setStep((value) => value + 1); return; }
    const content = `${name.trim()}: Colours ${colours.join(", ")}. Fonts: ${[titleFont, headingFont, bodyFont].filter(Boolean).join(", ") || "not set"}. ${guideline.trim()}`;
    clearError(); setStatus("processing");
    const save = async () => {
      if (fixture) return { id: fixtureMemoryId("visual", name), category: "visual", content, source: "user" as const, pinned: scope === "workspace", updatedAt: fixtureUpdatedAt() };
      const result = await addMemory({ category: "visual", content });
      if ("error" in result) { setStatus("editing"); fail("", result.error); return null; }
      return { id: result.id, category: "visual", content, source: "user" as const, pinned: scope === "workspace", updatedAt: new Date() };
    };
    window.setTimeout(async () => { const row = await save(); if (!row) return; onSaved(row); removeFixtureSession(VISUAL_DRAFT_KEY); setStatus("success"); }, fixture ? 540 : 0);
  };
  const dirty = step > 0 || Boolean(name.trim() || guideline.trim());
  const requestClose = () => dirty && status !== "success" ? setCancelOpen(true) : onOpenChange(false);

  return <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : requestClose()}><DialogContent className="r22-kb-flow r22-visual-flow" showCloseButton={false}>{status === "processing" ? <div className="r22-kb-processing" aria-live="polite"><Spinner aria-hidden="true" /><DialogTitle>Saving Visual Guideline</DialogTitle><DialogDescription>Keeping the declared colours, font slots, source and scope together.</DialogDescription><Progress className="r22-kb-progress" aria-label="Working" /></div> : status === "success" ? <div className="r22-brand-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>Visual Guideline saved</DialogTitle><DialogDescription>{name} is saved for Otto to use.</DialogDescription><Button unstyled className="is-primary" type="button" onClick={() => onOpenChange(false)}>Done</Button></div> : <>
    <DialogHeader><DialogTitle>Add Visual Guideline</DialogTitle><DialogDescription>{["Basic information", "Colours, fonts and framing", "Review"][step]}</DialogDescription></DialogHeader>
    <div className="r22-audience-steps is-three" aria-label={`Step ${step + 1} of 3`}>{["Basic information", "Colours and rules", "Review"].map((label, index) => <span className={index === step ? "is-current" : index < step ? "is-done" : ""} key={label}>{index + 1} {label}</span>)}</div>
    <div className="r22-kb-fields">{step === 0 ? <><FlowField id="visual-name" label="Name" hint={`${name.length} / 100`} error={errorField === "name" ? error : undefined}>{(control) => <Input unstyled autoFocus maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Lilin product photography" {...control} />}</FlowField><FieldSet><FieldLegend variant="label">Guideline access</FieldLegend><RadioGroup unstyled value={scope} onValueChange={(value) => setScope(value as "workspace" | "private")}><label><RadioGroupItem unstyled value="workspace" />Anyone in this workspace</label><label><RadioGroupItem unstyled value="private" />Private to me</label></RadioGroup></FieldSet></> : step === 1 ? <>
      <section className="r22-visual-colours"><h3>Colours ({colours.length})</h3><div>{colours.map((colour, index) => <span key={`${colour}-${index}`}><i style={{ background: colour }} /><code>{colour}</code><Button unstyled type="button" aria-label={`Remove ${colour}`} onClick={() => setColours((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</Button></span>)}</div><FlowField id="visual-next-colour" label="Add colour" error={errorField === "colours" ? error : undefined}>{(control) => <><Input unstyled value={nextColour} onChange={(event) => setNextColour(event.target.value.toUpperCase())} {...control} /><Button unstyled type="button" className="is-quiet" onClick={() => { if (/^#[0-9A-F]{6}$/.test(nextColour) && !colours.includes(nextColour)) { setColours((current) => [...current, nextColour]); clearError(); } else fail("colours", "Enter a unique six-digit hex colour, for example #0D9488."); }}>Keep</Button></>}</FlowField></section>
      <section className="r22-visual-fonts"><h3>Fonts ({[titleFont, headingFont, bodyFont].filter(Boolean).length} of 3 set)</h3><FlowField id="visual-font-title" label="Title">{(control) => <Input unstyled value={titleFont} onChange={(event) => setTitleFont(event.target.value)} {...control} />}</FlowField><FlowField id="visual-font-heading" label="Heading">{(control) => <Input unstyled value={headingFont} onChange={(event) => setHeadingFont(event.target.value)} {...control} />}</FlowField><FlowField id="visual-font-body" label="Body">{(control) => <Input unstyled value={bodyFont} onChange={(event) => setBodyFont(event.target.value)} placeholder="Not set" {...control} />}</FlowField></section>
      <FlowField id="visual-guideline" label="Framing and image direction" error={errorField === "guideline" ? error : undefined}>{(control) => <Textarea unstyled rows={5} value={guideline} onChange={(event) => setGuideline(event.target.value)} placeholder="Natural morning light, close product detail, teal batik used as a supporting surface." {...control} />}</FlowField>
    </> : <div className="r22-visual-review"><b>{name}</b><span>{scope === "workspace" ? "Workspace" : "Private"}</span><dl><div><dt>Colours</dt><dd>{colours.join(", ")}</dd></div><div><dt>Fonts</dt><dd>{[titleFont, headingFont, bodyFont].filter(Boolean).join(", ") || "Not set"}</dd></div><div><dt>Direction</dt><dd>{guideline}</dd></div></dl></div>}{error && !errorField ? <FlowFormError error={error} /> : null}</div>
    <DialogFooter><Button unstyled type="button" className="is-quiet" disabled={step === 0} onClick={() => { clearError(); setStep((value) => Math.max(0, value - 1)); }}>Back</Button><Button unstyled type="button" className="is-primary" onClick={() => void next()}>{step === 2 ? "Save Visual Guideline" : "Next"}</Button></DialogFooter>
  </>}</DialogContent><AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="r22-brand-cancel-dialog"><AlertDialogHeader><AlertDialogTitle>Discard this Visual Guideline draft?</AlertDialogTitle><AlertDialogDescription>The name, colours, font slots and direction will be cleared.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { removeFixtureSession(VISUAL_DRAFT_KEY); setCancelOpen(false); onOpenChange(false); }}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></Dialog>;
}

export function R22OttoIQView({
  initialMemory,
  initialPane = "hub",
  fixture = false,
  fixtureState = "ready",
}: {
  initialMemory: MemoryRow[];
  initialPane?: Pane;
  fixture?: boolean;
  fixtureState?: "ready" | "loading" | "empty" | "error" | "permission" | "unknown";
}) {
  const router = useRouter();
  const otto = useOttoPanelControls();
  const [pane, setPane] = useState<Pane>(initialPane);
  const [rows, setRows] = useState(initialMemory);
  const [adding, setAdding] = useState(false);
  const [voiceFlowOpen, setVoiceFlowOpen] = useState(false);
  const [selected, setSelected] = useState<MemoryRow | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  /*
   * P1-2(beta 卫生大扫除 2026-08-26):hub 上那条「Otto noticed 4 things worth remembering」
   * 与它开出的 Review 层整块删了。层里写着「Nothing joins Otto IQ until you keep it」,
   * 却只有一颗 Done reviewing —— 没有 keep、没有 skip,关掉之后提示条原地不动,
   * 商家进得去出不来。要留就得补一份 pending 状态与两颗真按钮,那是一个功能不是一次打磨;
   * 真正能落格的建议路径是「Ask Otto to read your site」那一条,它在面板线程里逐组点头。
   */
  /** 「让 Otto 读一遍我的网站」那一层(裁决第 3 条的第一个入口)。 */
  const [researchOpen, setResearchOpen] = useState(false);
  const [researchSite, setResearchSite] = useState(OTTO_RESEARCH_SAMPLE_SITE);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fixtureWorkspaceId, setFixtureWorkspaceId] = useState(fixture ? "" : "production");
  const card = CARDS.find((item) => item.id === pane);
  const visibleCards = fixture ? CARDS : CARDS.filter((item) => !BETA_HIDDEN_CARDS.includes(item.id));
  const visible = useMemo(() => {
    if (!card) return rows;
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) =>
      card.categories.some((category) => row.category.toLowerCase().includes(category)) &&
      (!normalizedQuery || row.content.toLowerCase().includes(normalizedQuery)),
    );
  }, [card, query, rows]);

  useEffect(() => {
    if (!fixture) return;
    const activeWorkspaceId = readR22WorkspaceDirectory().activeId;
    setFixtureWorkspaceId(activeWorkspaceId);
    if (fixtureState !== "ready") {
      setRows(fixtureState === "empty" ? [] : initialMemory);
      return;
    }
    if (activeWorkspaceId !== "batik-house") setRows([]);
    if (readFixtureSession(BRAND_VOICE_DRAFT_KEY)) setVoiceFlowOpen(true);
    if (initialPane === "sources" && readFixtureSession(KNOWLEDGE_DRAFT_KEY)) setAdding(true);
    if (initialPane === "audiences" && readFixtureSession(AUDIENCE_DRAFT_KEY)) setAdding(true);
    if (initialPane === "style" && readFixtureSession(STYLE_DRAFT_KEY)) setAdding(true);
    if (initialPane === "visual" && readFixtureSession(VISUAL_DRAFT_KEY)) setAdding(true);
    for (const key of [BRAND_VOICE_SAVED_KEY, OTTO_IQ_FIXTURE_SAVED_KEY]) {
      const stored = readFixtureSession(key);
      if (!stored) continue;
      try {
        const saved = JSON.parse(stored) as Array<Omit<MemoryRow, "updatedAt"> & { updatedAt: string }>;
        setRows((current) => {
          const known = new Set(current.map((row) => row.id));
          return [...current, ...saved.filter((row) => !known.has(row.id)).map((row) => ({ ...row, updatedAt: new Date(row.updatedAt) }))];
        });
      } catch { removeFixtureSession(key); }
    }
  }, [fixture, fixtureState, initialMemory, initialPane]);

  if (fixture && (fixtureState === "loading" || fixtureState === "error" || fixtureState === "permission" || fixtureState === "unknown")) return <main className="r22-iq" data-r22-otto-iq data-state={fixtureState}><header><div><h1>Otto IQ</h1><p>What you have taught Otto — every item shows where it came from and who can use it.</p></div></header><section className="r22-iq-start"><div><b>{fixtureState === "loading" ? "Loading what Otto knows…" : fixtureState === "permission" ? "Otto IQ is not available to this member" : fixtureState === "unknown" ? "We could not tell whether Otto IQ loaded" : "Otto IQ could not be loaded"}</b>{fixtureState === "permission" ? <p>Names, counts and sources stay hidden until someone gives you access.</p> : null}</div>{fixtureState === "error" || fixtureState === "unknown" ? <Button unstyled type="button" onClick={() => router.replace("/brand?fixture=r22")}>Retry</Button> : null}</section></main>;

  if (fixture && !fixtureWorkspaceId) return <main className="r22-iq" data-r22-otto-iq aria-busy="true"><header><div><h1>Otto IQ</h1><p>Loading what Otto knows…</p></div></header></main>;

  const acceptSavedRow = (row: MemoryRow) => {
    setRows((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
    if (!fixture) return;
    // 存放处搬到了 `otto-iq-fixture.ts` —— 研究托付批准的那一下落的必须是**同一个**格子,
    // 各写各的键会让商家在线程里读到「已经存好了」,推开这扇门却什么都没有。
    appendOttoIQSavedRow(row);
  };

  const saveFixtureVoice = (row: MemoryRow) => acceptSavedRow(row);

  function open(next: Pane) {
    setPane(next);
    setAdding(false);
    setSelected(null);
    setQuery("");
    const params = new URLSearchParams();
    if (next !== "hub") params.set("tab", next);
    if (fixture) params.set("fixture", "r22");
    router.replace(`/brand${params.size ? `?${params.toString()}` : ""}`, { scroll: false });
  }

  function openRow(row: MemoryRow) {
    setSelected(row);
    setEditingContent(row.content);
    setError("");
    setDeleteOpen(false);
  }

  function saveSelected() {
    if (!selected || !editingContent.trim()) return;
    setError("");
    if (fixture) {
      setRows((current) => current.map((row) => row.id === selected.id ? { ...row, content: editingContent.trim(), source: "user", updatedAt: fixtureUpdatedAt() } : row));
      setSelected(null);
      return;
    }
    startTransition(async () => {
      const result = await updateMemory({ id: selected.id, content: editingContent.trim(), pinned: selected.pinned });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setRows((current) => current.map((row) => row.id === selected.id ? { ...row, content: editingContent.trim(), source: "user", updatedAt: new Date() } : row));
      setSelected(null);
    });
  }

  function removeSelected() {
    if (!selected) return;
    setError("");
    if (fixture) {
      setRows((current) => current.filter((row) => row.id !== selected.id));
      writeFixtureSession(OTTO_IQ_FIXTURE_SAVED_KEY, JSON.stringify(readOttoIQSavedRows().filter((row) => row.id !== selected.id)));
      setSelected(null);
      return;
    }
    startTransition(async () => {
      const result = await deleteMemory({ id: selected.id });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      setRows((current) => current.filter((row) => row.id !== selected.id));
      setSelected(null);
    });
  }

  /**
   * 「Ask Otto to read your site」——按下去不是开一条进度条,是**开一条对话**。
   *
   * Founder 2026-08-26 裁决第 3 条:这件事从头到尾住在那条线程里 —— 商家给网址、Otto 应承、
   * 整理完请他 approve、批准的落回这一面。所以这一层只做一件事:收下网址,把面板打开,
   * 剩下的都在那条线程里发生。这一面不自己画进度,也不自己画结果。
   */
  const researchDialog = (
    <Dialog open={researchOpen} onOpenChange={setResearchOpen}>
      <DialogContent className="r22-iq-detail" data-otto-iq-research-dialog>
        <DialogHeader>
          <DialogTitle>Ask Otto to read your site</DialogTitle>
          <DialogDescription>Otto reads it, sorts what it finds, and brings the groups back for you to keep or skip. Nothing is saved here until you say so.</DialogDescription>
        </DialogHeader>
        <FlowField id="otto-iq-research-site" label="Your site" hint="Otto opens the pages that are already public.">
          {(control) => <Input unstyled value={researchSite} onChange={(event) => setResearchSite(event.target.value)} placeholder={OTTO_RESEARCH_SAMPLE_SITE} {...control} />}
        </FlowField>
        <DialogFooter>
          <Button
            unstyled
            type="button"
            className="is-primary"
            data-otto-iq-research-go
            disabled={!researchSite.trim()}
            onClick={() => {
              requestOttoSiteResearch(researchSite.trim());
              setResearchOpen(false);
              otto?.openPanel();
            }}
          >
            Ask Otto
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  /**
   * P2-18(beta 卫生大扫除 2026-08-26):hub 头部原本挤着三个入口 —— 这一颗、一颗只写
   * 「Ask Otto」的、还有空态横幅里那颗 Open Brand Voice。前两颗只差四个词,商家得按一次
   * 才知道哪颗干什么。只留这一颗:它有明确产出(Otto 读完把整理好的几组带回来请他点头)。
   * 光按开面板那一颗删了 —— 宠物在每一页右下角都在,不缺第二个入口。
   *
   * hub 上它是那一颗主键(实心),来源那一面上它站在「Add Knowledge Base」旁边,所以在
   * 那里仍是次要的一颗。
   */
  const researchButton = (quiet: boolean) => (
    <Button unstyled type="button" className={quiet ? "is-quiet" : undefined} data-otto-iq-research onClick={() => setResearchOpen(true)}>
      Ask Otto to read your site
    </Button>
  );

  if (pane === "hub") {
    return (
      <main className="r22-iq" data-r22-otto-iq>
        <header>
          <div><h1>Otto IQ</h1><p>What you have taught Otto — every item shows where it came from and who can use it.</p></div>
          {researchButton(false)}
        </header>
        <div className="r22-iq-grid">
          {visibleCards.map((item) => {
            const count = rows.filter((row) => item.categories.some((category) => row.category.toLowerCase().includes(category))).length;
            return <Button unstyled type="button" data-kind={item.id} key={item.id} onClick={() => open(item.id)}><i aria-hidden="true" className="r22-iq-tile" data-pattern={item.id} /><span><b>{item.title}</b><small>{item.description}</small><em>{count ? `${count} saved` : "Nothing here yet"}</em></span></Button>;
          })}
        </div>
        <p className="r22-iq-consent">Only you choose what is saved here. Pending suggestions stay separate until you accept them; nothing is shared with another workspace.</p>
        {researchDialog}
      </main>
    );
  }

  return (
    <main className="r22-iq" data-r22-otto-iq>
      <nav><Button unstyled type="button" onClick={() => open("hub")}>Otto IQ</Button><ChevronRight className="size-3" aria-hidden="true" /><span>{card?.title}</span></nav>
      {/* 来源那一格多一条路:与其让商家一条一条手打,不如把网址交给 Otto 一次读完 —— 呈上来
          的每一组仍然要他自己点头才算数(裁决第 3 条)。 */}
      <header><div><h1>{card?.title}</h1><p>{card?.description}</p></div>{card?.id === "sources" ? researchButton(true) : null}<Button unstyled type="button" onClick={() => card?.id === "voice" ? setVoiceFlowOpen(true) : setAdding(true)}>Add {card?.title}</Button></header>
      {/* 搜索框归 `ui/input-group`(A-12);计数从一句话改成一枚芯片(B-4)—— 数字随
          筛选实时变,住在标签旁边而不是自己占一句。 */}
      <div className="r22-iq-toolbar"><InputGroup className="r22-iq-search"><InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon><InputGroupInput type="search" aria-label={`Search ${card?.title}`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${card?.title}`} /></InputGroup><Badge variant="outline" className="r22-iq-count" data-r22-iq-count>{visible.length} saved</Badge></div>
      {/*
        已存下来的 context 归位 `ui/table`(审计 A-6)。此前这一块是「四个 `<b>` 当表头 +
        一叠 `<Button>` 当数据行」,靠 `grid-template-columns` 对齐 —— 屏幕上是一张表,
        读出来不是:没有列头与格子的关系,商家用读屏软件听到的是四段没有归属的字。

        键盘路径长在名字那一格的按钮上(`<tr>` 不可聚焦);整行可点是给鼠标的,所以那颗
        按钮的点击要 `stopPropagation`,免得同一下开两遍。
      */}
      {visible.length ? <div className="r22-iq-table"><Table className="r22-iq-rows" aria-label={card?.title}><TableHeader><TableRow><TableHead>{card?.title}</TableHead><TableHead>Source</TableHead><TableHead>Scope</TableHead><TableHead>Updated</TableHead></TableRow></TableHeader><TableBody>{visible.map((row) => <TableRow key={row.id} data-r22-iq-row={row.id} onClick={() => openRow(row)}><TableCell><Button unstyled type="button" className="r22-iq-row-open" onClick={(event) => { event.stopPropagation(); openRow(row); }}><b>{rowName(row)}</b><small>{row.content}</small></Button></TableCell><TableCell>{row.source === "user" ? "You" : "Otto suggestion"}</TableCell><TableCell>{row.pinned ? "Workspace" : "Private"}</TableCell><TableCell>{new Date(row.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</TableCell></TableRow>)}</TableBody></Table></div> : <Empty className="r22-iq-empty"><EmptyHeader><EmptyMedia variant="icon"><Eye /></EmptyMedia><EmptyTitle>{query ? "No approved context matches" : "Start with approved context"}</EmptyTitle><EmptyDescription>{query ? "Try a different search. Nothing was hidden as deleted." : "Add text you own. Otto never goes looking for material anywhere else."}</EmptyDescription></EmptyHeader>{!query ? <EmptyContent><Button unstyled type="button" className="is-quiet" onClick={() => card?.id === "voice" ? setVoiceFlowOpen(true) : setAdding(true)}>Add {card?.title}</Button></EmptyContent> : null}</Empty>}

      <Dialog open={selected !== null} onOpenChange={(next) => { if (!next) setSelected(null); }}>
        <DialogContent className="r22-iq-detail">
          <DialogHeader><DialogTitle>{selected ? rowName(selected) : card?.title}</DialogTitle><DialogDescription>You can see where this came from and who can use it while you edit.</DialogDescription></DialogHeader>
          <dl><div><dt>Source</dt><dd>{selected?.source === "user" ? "You" : "Otto suggestion"}</dd></div><div><dt>Scope</dt><dd>{selected?.pinned ? "Workspace" : "Private"}</dd></div></dl>
          <label><span>Approved context</span><Textarea unstyled rows={9} value={editingContent} onChange={(event) => setEditingContent(event.target.value)} /></label>
          {error ? <p role="alert">{error}</p> : null}
          <DialogFooter><AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}><AlertDialogTrigger asChild><Button unstyled type="button" className="is-danger" disabled={pending}><Trash2 /> Delete</Button></AlertDialogTrigger><AlertDialogContent className="r22-brand-cancel-dialog"><AlertDialogHeader><AlertDialogTitle>Delete {selected ? rowName(selected) : "this context"}?</AlertDialogTitle><AlertDialogDescription>Otto will stop using this source in new work. Existing generated, scheduled or published work will not be rewritten.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep context</AlertDialogCancel><AlertDialogAction onClick={removeSelected}>Delete context</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><Button unstyled type="button" className="is-primary" disabled={!editingContent.trim() || pending} onClick={saveSelected}>{pending ? "Saving…" : "Save changes"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <BrandVoiceFlow open={voiceFlowOpen} fixture={fixture} onOpenChange={setVoiceFlowOpen} onFixtureSave={saveFixtureVoice} />
      <KnowledgeBaseFlow open={adding && card?.id === "sources"} fixture={fixture} onOpenChange={setAdding} onSaved={acceptSavedRow} />
      <AudienceFlow open={adding && card?.id === "audiences"} fixture={fixture} onOpenChange={setAdding} onSaved={acceptSavedRow} />
      <StyleGuideFlow open={adding && card?.id === "style"} fixture={fixture} onOpenChange={setAdding} onSaved={acceptSavedRow} />
      <VisualGuidelineFlow open={adding && card?.id === "visual"} fixture={fixture} onOpenChange={setAdding} onSaved={acceptSavedRow} />
      {researchDialog}
    </main>
  );
}
