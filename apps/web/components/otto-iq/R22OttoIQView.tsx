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

import {
  BookOpenText,
  ChevronRight,
  Eye,
  MessageSquareText,
  Palette,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import "./r22-otto-iq.css";
import "./r22-otto-iq-hub.css";
import "./r22-knowledge-flow.css";

type Pane = "hub" | "voice" | "audiences" | "sources" | "style" | "visual";
type Card = {
  id: Exclude<Pane, "hub">;
  title: string;
  description: string;
  categories: string[];
  icon: typeof MessageSquareText;
};

const CARDS: Card[] = [
  { id: "voice", title: "Brand Voice", description: "How you sound. Otto reads this before writing any caption or reply.", categories: ["voice", "tone"], icon: MessageSquareText },
  { id: "audiences", title: "Audiences", description: "Who you are writing to. Otto picks one before drafting.", categories: ["audience", "people"], icon: UsersRound },
  { id: "sources", title: "Knowledge Base", description: "Pages, files and notes you choose for Otto to reference — with provenance.", categories: ["knowledge", "source", "fact", "product"], icon: BookOpenText },
  { id: "style", title: "Style Guide", description: "Writing defaults, approved language and claims Otto must avoid.", categories: ["style", "rule", "never", "do not say"], icon: ShieldCheck },
  { id: "visual", title: "Visual Guidelines", description: "The images, colours and framing Otto can reference when making a picture.", categories: ["visual", "look", "color", "colour"], icon: Palette },
];

const FIXTURE_COUNTS: Record<Exclude<Pane, "hub">, string> = {
  voice: "1 voice",
  audiences: "2 audiences",
  sources: "2 sources",
  style: "2 rules",
  visual: "1 logo · 5 colours · 2 fonts · 1 guideline",
};

function rowName(row: MemoryRow): string {
  return row.content.split(":", 1)[0]?.trim() || "Untitled context";
}

type BrandVoiceSource = "text" | "url" | "file";
type BrandVoiceStep = "details" | "source" | "generating" | "review" | "success";
const BRAND_VOICE_DRAFT_KEY = "r22:brand-voice:draft";
const BRAND_VOICE_SAVED_KEY = "r22:brand-voice:saved";
const OTTO_IQ_FIXTURE_SAVED_KEY = "r22:otto-iq:saved:v1";
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
  const [draftReady, setDraftReady] = useState(!fixture);
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    if (!open) { setDraftReady(!fixture); return; }
    setCancelOpen(false);
    if (fixture) {
      const stored = readFixtureSession(BRAND_VOICE_DRAFT_KEY);
      if (stored) {
        try {
          const draft = JSON.parse(stored) as { version?: number; step?: BrandVoiceStep; name?: string; access?: "workspace" | "private"; bestUse?: string; source?: BrandVoiceSource; sourceText?: string; sourceUrl?: string; fileName?: string; description?: string; excerpts?: string[]; error?: string };
          if (draft.version !== 1) throw new Error("stale draft");
          setStep(draft.step === "success" ? "review" : draft.step ?? "details");
          setName(draft.name ?? ""); setAccess(draft.access ?? "workspace"); setBestUse(draft.bestUse ?? "Company profile"); setSource(draft.source ?? "text"); setSourceText(draft.sourceText ?? ""); setSourceUrl(draft.sourceUrl ?? ""); setFileName(draft.fileName ?? ""); setDescription(draft.description ?? ""); setExcerpts(draft.excerpts?.length === 3 ? draft.excerpts : ["", "", ""]); setError(draft.error ?? "");
          setDraftReady(true);
          return;
        } catch {
          removeFixtureSession(BRAND_VOICE_DRAFT_KEY);
        }
      }
    }
    setStep("details"); setName(""); setAccess("workspace"); setBestUse("Company profile"); setSource("text"); setSourceText(""); setSourceUrl(""); setFileName(""); setDescription(""); setExcerpts(["", "", ""]); setError(""); setDraftReady(true);
  }, [fixture, open]);

  useEffect(() => {
    if (!fixture || !open || !draftReady || step === "success") return;
    writeFixtureSession(BRAND_VOICE_DRAFT_KEY, JSON.stringify({ version: 1, step, name, access, bestUse, source, sourceText, sourceUrl, fileName, description, excerpts, error }));
  }, [access, bestUse, description, draftReady, error, excerpts, fileName, fixture, name, open, source, sourceText, sourceUrl, step]);

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
    if (!name.trim()) return setError("Give this Brand Voice a name.");
    if (!bestUse.trim()) return setError("Add at least one best-use label.");
    setError("");
    setStep("source");
  }

  function generate() {
    if (source === "text" && sourceText.trim().length < 1000) return setError("1000 character minimum not met. Add more approved example content.");
    if (source === "url" && !/^https?:\/\//i.test(sourceUrl.trim())) return setError("Enter a complete http or https URL you own or may use.");
    if (source === "file" && !fileName) return setError("Choose a supported file before generating.");
    // 生产不许进伪造。`generating` 那一步之后是写死的描述与三条摘录 —— 那是**演示**,
    // 不是这家商家粘贴的内容读出来的。以前它照样跑,商家一路读到与自己毫无关系的
    // 「生成结果」,直到 Save 才撞上 `save()` 里那句实话。诚实要在花商家时间之前说,
    // 所以阻断挪到入口,用的是同一句话;fixture 一个字节没变。
    // 形状与同文件的兄弟流一致(KnowledgeBaseFlow `submit()`、AudienceFlow `next()`)。
    if (!fixture) return setError("Brand Voice generation and source ingestion are not connected. Nothing was saved.");
    setError("");
    setStep("generating");
  }

  function save() {
    if (!description.trim()) return setError("Keep a Brand Voice description before saving.");
    if (!fixture) return setError("Brand Voice generation and source ingestion are not connected. Nothing was saved.");
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
            <label>Name<Input unstyled autoFocus value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Batik House voice" /><small>{name.length} / 80</small></label>
            <fieldset><legend>Voice access</legend><RadioGroup unstyled value={access} onValueChange={(value) => setAccess(value as "workspace" | "private")}><label className={access === "workspace" ? "is-selected" : ""}><RadioGroupItem unstyled value="workspace" /><span><b>Anyone in this workspace</b><small>Workspace members can use this voice.</small></span></label><label className={access === "private" ? "is-selected" : ""}><RadioGroupItem unstyled value="private" /><span><b>Private to me</b><small>Only you can access and use this voice.</small></span></label></RadioGroup></fieldset>
            <label>Best used for<Input unstyled value={bestUse} onChange={(event) => setBestUse(event.target.value)} placeholder="Company profile, blogs, product launches" /></label>
          </div><aside className="r22-brand-voice-preview"><b>{name || "Untitled Brand Voice"}</b><span>Best used for: {bestUse || "Not set"}</span><span>Visibility: {access === "workspace" ? "Anyone" : "Private"}</span><Separator /><small>EXAMPLE CONTENT</small><i /><i /><small>DESCRIPTION</small><i /><i /></aside></div>
          {error ? <p className="r22-brand-voice-error" role="alert">{error}</p> : null}
          <DialogFooter><Button unstyled type="button" className="is-quiet" onClick={requestClose}>Cancel</Button><Button unstyled type="button" className="is-primary" onClick={continueDetails}>Next</Button></DialogFooter>
        </> : step === "source" ? <>
          <DialogHeader><DialogTitle>Add Brand Voice</DialogTitle><DialogDescription>Add example content</DialogDescription></DialogHeader>
          <div className="r22-brand-voice-layout"><div className="r22-brand-voice-fields">
            <h2>Add example content</h2><p>Add up to 8 examples. The more on-brand and high-quality the examples are, the better your voice will be.</p>
            <Tabs unstyled value={source} onValueChange={(value) => { setSource(value as BrandVoiceSource); setError(""); }}><TabsList unstyled className="r22-brand-source-tabs"><TabsTrigger unstyled value="text">Paste text</TabsTrigger><TabsTrigger unstyled value="url">Add URLs</TabsTrigger><TabsTrigger unstyled value="file">Upload files</TabsTrigger></TabsList></Tabs>
            {source === "text" ? <label key="source-text">Approved example text<Textarea unstyled rows={9} value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="Paste a blog, email, social post, or other approved content." /><small>{sourceText.trim().length} characters · 1000 character minimum</small></label> : source === "url" ? <label key="source-url">Website URL<Input unstyled type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://batikhouse.example/about" /><small>FIKIRTIVE will only use this source after ingestion is available and permission is confirmed.</small></label> : <label key="source-file" className="r22-brand-file">Upload a file<Input unstyled type="file" accept=".txt,.doc,.docx,.pdf" onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} /><small>{fileName || "TXT, DOC, DOCX or PDF"}</small></label>}
            <div className="r22-brand-added"><b>Added context</b><span>{sourceLabel}</span></div>
          </div><aside className="r22-brand-voice-preview"><b>{name}</b><span>Best used for: {bestUse}</span><span>Visibility: {access === "workspace" ? "Anyone" : "Private"}</span><Separator /><small>EXAMPLE CONTENT</small><i /><i /><small>DESCRIPTION</small><i /><i /></aside></div>
          {error ? <p className="r22-brand-voice-error" role="alert">{error}</p> : null}
          <DialogFooter><Button unstyled type="button" className="is-quiet" onClick={() => setStep("details")}>Back</Button><Button unstyled type="button" className="is-primary" onClick={generate}>Generate voice</Button></DialogFooter>
        </> : step === "generating" ? <div className="r22-brand-generating" aria-live="polite"><Spinner aria-hidden="true" /><DialogTitle>Generating Brand Voice</DialogTitle><DialogDescription>This step pauses here while approved sources are reviewed. FIKIRTIVE does not show success until analysis finishes.</DialogDescription><article><b>{name}</b><small>Reviewing your sources</small><i /><i /><i /></article></div> : step === "review" ? <>
          <DialogHeader><DialogTitle>Review and edit</DialogTitle><DialogDescription>Check the generated voice before it becomes approved Otto IQ context.</DialogDescription></DialogHeader>
          <div className="r22-brand-review"><label>Description<Textarea unstyled rows={7} value={description} onChange={(event) => setDescription(event.target.value)} /></label><fieldset><legend>Excerpts</legend>{excerpts.map((excerpt, index) => <Textarea unstyled rows={3} aria-label={`Excerpt ${index + 1}`} key={index} value={excerpt} onChange={(event) => setExcerpts((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />)}</fieldset><p>Source: {sourceLabel} · Scope: {access === "workspace" ? "Workspace" : "Private"}</p></div>
          {error ? <p className="r22-brand-voice-error" role="alert">{error}</p> : null}
          <DialogFooter><Button unstyled type="button" className="is-quiet" onClick={() => setStep("source")}>Back</Button><Button unstyled type="button" className="is-primary" onClick={save}>Save Brand Voice</Button></DialogFooter>
        </> : <div className="r22-brand-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>Brand Voice saved</DialogTitle><DialogDescription>{name} is now approved context for this workspace.</DialogDescription><Button unstyled type="button" className="is-primary" onClick={() => onOpenChange(false)}>Done</Button></div>}
      </DialogContent>
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="r22-brand-cancel-dialog"><AlertDialogHeader><AlertDialogTitle>Discard this Brand Voice draft?</AlertDialogTitle><AlertDialogDescription>Your current step and approved examples are kept if you refresh. Discarding removes only this draft and leaves everything already in Otto IQ untouched.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={discardDraft}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </Dialog>
  );
}

type KnowledgeSource = "text" | "url" | "file";
type KnowledgeStep = "choose" | KnowledgeSource | "processing" | "success";

function KnowledgeBaseFlow({ open, fixture, onOpenChange, onSaved }: {
  open: boolean;
  fixture: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (row: MemoryRow) => void;
}) {
  const [step, setStep] = useState<KnowledgeStep>("choose");
  const [source, setSource] = useState<KnowledgeSource>("text");
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [url, setUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [tags, setTags] = useState("");
  const [workspace, setWorkspace] = useState(true);
  const [error, setError] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(!fixture);

  useEffect(() => {
    if (!open) { setDraftReady(!fixture); return; }
    setCancelOpen(false);
    const stored = fixture ? readFixtureSession(KNOWLEDGE_DRAFT_KEY) : null;
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { version?: number; step?: KnowledgeStep; source?: KnowledgeSource; name?: string; content?: string; url?: string; fileName?: string; tags?: string; workspace?: boolean; error?: string };
        if (draft.version !== 1) throw new Error("stale draft");
        setStep(draft.step === "success" ? "choose" : draft.step ?? "choose"); setSource(draft.source ?? "text"); setName(draft.name ?? ""); setContent(draft.content ?? ""); setUrl(draft.url ?? ""); setFileName(draft.fileName ?? ""); setTags(draft.tags ?? ""); setWorkspace(draft.workspace ?? true); setError(draft.error ?? ""); setDraftReady(true); return;
      } catch { removeFixtureSession(KNOWLEDGE_DRAFT_KEY); }
    }
    setStep("choose"); setSource("text"); setName(""); setContent(""); setUrl(""); setFileName(""); setTags(""); setWorkspace(true); setError(""); setDraftReady(true);
  }, [fixture, open]);

  useEffect(() => {
    if (!fixture || !open || !draftReady || step === "success") return;
    writeFixtureSession(KNOWLEDGE_DRAFT_KEY, JSON.stringify({ version: 1, step, source, name, content, url, fileName, tags, workspace, error }));
  }, [content, draftReady, error, fileName, fixture, name, open, source, step, tags, url, workspace]);

  useEffect(() => {
    if (!open || step !== "processing" || !fixture) return;
    const timer = window.setTimeout(() => {
      onSaved({ id: fixtureMemoryId("knowledge", name), category: "knowledge", content: `${name.trim()}: ${source === "text" ? content.trim().slice(0, 220) : source === "url" ? url.trim() : fileName}`, source: "user", pinned: workspace, updatedAt: fixtureUpdatedAt() });
      removeFixtureSession(KNOWLEDGE_DRAFT_KEY);
      setStep("success");
    }, 620);
    return () => window.clearTimeout(timer);
  }, [content, fileName, fixture, name, onSaved, open, source, step, url, workspace]);

  const dirty = step !== "choose" || Boolean(name.trim() || content.trim() || url.trim() || fileName || tags.trim());
  const requestClose = () => dirty ? setCancelOpen(true) : onOpenChange(false);
  const choose = (next: KnowledgeSource) => { setSource(next); setStep(next); setError(""); };

  const submit = async () => {
    if (!name.trim()) return setError("Give this source a name.");
    if (source === "text" && !content.trim()) return setError("Add the approved text Otto may reference.");
    if (source === "url" && !/^https?:\/\//i.test(url.trim())) return setError("Enter a complete http or https URL.");
    if (source === "file" && !fileName) return setError("Choose a DOC, DOCX, PDF or TXT file.");
    setError("");
    if (fixture) { setStep("processing"); return; }
    if (source !== "text") return setError("URL and file ingestion are not connected. Nothing was uploaded, read or saved.");
    const result = await addMemory({ category: "knowledge", content: `${name.trim()}: ${content.trim()}` });
    if ("error" in result) return setError(result.error);
    onSaved({ id: result.id, category: "knowledge", content: `${name.trim()}: ${content.trim()}`, source: "user", pinned: workspace, updatedAt: new Date() });
    setStep("success");
  };

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : requestClose()}>
    <DialogContent className="r22-kb-flow" showCloseButton={false}>
      {step === "choose" ? <>
        <DialogHeader><DialogTitle>Add to Knowledge Base</DialogTitle><DialogDescription>Choose one source type. Files, URLs and pasted text keep separate provenance.</DialogDescription></DialogHeader>
        <div className="r22-kb-picker"><Button unstyled type="button" onClick={() => choose("text")}><b>From text</b><span>Write or paste information.</span></Button><Button unstyled type="button" onClick={() => choose("file")}><b>Upload file</b><span>DOC, DOCX, PDF or TXT · max 40 MB.</span></Button><Button unstyled type="button" onClick={() => choose("url")}><b>Enter URL</b><span>Otto reads one public, text-heavy page.</span></Button></div>
        <p className="r22-kb-permission">Add only material this workspace is allowed to use. Nothing is saved until the source finishes processing.</p>
        <DialogFooter><Button unstyled className="is-quiet" type="button" onClick={requestClose}>Cancel</Button></DialogFooter>
      </> : step === "processing" ? <div className="r22-kb-processing" aria-live="polite"><Spinner aria-hidden="true" /><DialogTitle>Reading {source === "file" ? fileName : source === "url" ? url : name}</DialogTitle><DialogDescription>Usually under a minute. This source is not available to Otto until processing finishes.</DialogDescription><Progress className="r22-kb-progress" aria-label="Working" /></div> : step === "success" ? <div className="r22-brand-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>Knowledge source saved</DialogTitle><DialogDescription>{name} is now available as {workspace ? "workspace" : "private"} context.</DialogDescription><Button unstyled type="button" className="is-primary" onClick={() => onOpenChange(false)}>Done</Button></div> : <>
        <DialogHeader><DialogTitle>{source === "text" ? "Add text to Knowledge Base" : source === "url" ? "Add URL to Knowledge Base" : "Upload file to Knowledge Base"}</DialogTitle><DialogDescription>Source type: {source === "text" ? "Pasted approved text" : source === "url" ? "Public page" : "Uploaded document"}</DialogDescription></DialogHeader>
        <div className="r22-kb-fields">
          <label>Name<Input unstyled autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)} placeholder={source === "file" ? "Brand story" : "What Otto should call this"} /><small>{name.length} / 100</small></label>
          {source === "text" ? <label>What Otto should know<Textarea unstyled rows={8} maxLength={200000} value={content} onChange={(event) => setContent(event.target.value)} placeholder="Paste material this workspace may use." /><small>{content.length} / 200000</small></label> : source === "url" ? <label>URL<Input unstyled type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/about" /><small>Works best on a page with plenty of text.</small></label> : <label className="r22-kb-file">Document<Input unstyled type="file" accept=".txt,.doc,.docx,.pdf" onChange={(event) => { const file = event.target.files?.[0]; setFileName(file?.name ?? ""); if (file && !name) setName(file.name.replace(/\.[^.]+$/, "")); }} /><span>{fileName || "Drag and drop or browse · max 40 MB"}</span></label>}
          <label>Tags<Input unstyled value={tags} onChange={(event) => setTags(event.target.value)} placeholder="Brand story" /></label>
          <label className="r22-kb-check"><Checkbox unstyled checked={workspace} onCheckedChange={(checked) => setWorkspace(checked === true)} />Available to this workspace</label>
          {error ? <p className="r22-brand-voice-error" role="alert">{error}</p> : null}
        </div>
        <DialogFooter><Button unstyled type="button" className="is-quiet" onClick={() => { setStep("choose"); setError(""); }}>Back</Button><Button unstyled type="button" className="is-primary" onClick={() => void submit()}>Add to Knowledge Base</Button></DialogFooter>
      </>}
    </DialogContent>
    <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="r22-brand-cancel-dialog"><AlertDialogHeader><AlertDialogTitle>Discard this knowledge draft?</AlertDialogTitle><AlertDialogDescription>The source type, text, URL, file name and visibility will be cleared.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { removeFixtureSession(KNOWLEDGE_DRAFT_KEY); setCancelOpen(false); onOpenChange(false); }}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </Dialog>;
}

type AudienceSourceTab = "file" | "paste" | "url" | "kb";

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
  const [sourceTab, setSourceTab] = useState<AudienceSourceTab>("file");
  const [sourceText, setSourceText] = useState("");
  const [docs, setDocs] = useState<string[]>([]);
  const [stories, setStories] = useState<string[]>([]);
  const [triggers, setTriggers] = useState(["Looks for a thoughtful weekend gift"]);
  const [requirements, setRequirements] = useState(["Gift-ready after work"]);
  const [indicators, setIndicators] = useState(["Weekend orders"]);
  const [characteristics, setCharacteristics] = useState([{ key: "Shopping window", value: "Friday evening" }]);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"editing" | "processing" | "success">("editing");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(!fixture);

  useEffect(() => {
    if (!open) { setDraftReady(!fixture); return; }
    setCancelOpen(false);
    const stored = fixture ? readFixtureSession(AUDIENCE_DRAFT_KEY) : null;
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { version?: number; step?: number; name?: string; description?: string; scope?: "workspace" | "private"; sourceTab?: AudienceSourceTab; sourceText?: string; docs?: string[]; stories?: string[]; triggers?: string[]; requirements?: string[]; indicators?: string[]; characteristics?: Array<{ key: string; value: string }>; error?: string };
        if (draft.version !== 1) throw new Error("stale draft");
        setStep(Math.min(3, Math.max(0, draft.step ?? 0))); setName(draft.name ?? ""); setDescription(draft.description ?? ""); setScope(draft.scope ?? "workspace"); setSourceTab(draft.sourceTab ?? "file"); setSourceText(draft.sourceText ?? ""); setDocs(draft.docs ?? []); setStories(draft.stories ?? []); setTriggers(draft.triggers ?? [""]); setRequirements(draft.requirements ?? [""]); setIndicators(draft.indicators ?? [""]); setCharacteristics(draft.characteristics ?? []); setError(draft.error ?? ""); setStatus("editing"); setDraftReady(true); return;
      } catch { removeFixtureSession(AUDIENCE_DRAFT_KEY); }
    }
    setStep(0); setName(""); setDescription(""); setScope("workspace"); setSourceTab("file"); setSourceText(""); setDocs([]); setStories([]); setTriggers(["Looks for a thoughtful weekend gift"]); setRequirements(["Gift-ready after work"]); setIndicators(["Weekend orders"]); setCharacteristics([{ key: "Shopping window", value: "Friday evening" }]); setError(""); setStatus("editing"); setDraftReady(true);
  }, [fixture, open]);

  useEffect(() => {
    if (!fixture || !open || !draftReady || status !== "editing") return;
    writeFixtureSession(AUDIENCE_DRAFT_KEY, JSON.stringify({ version: 1, step, name, description, scope, sourceTab, sourceText, docs, stories, triggers, requirements, indicators, characteristics, error }));
  }, [characteristics, description, docs, draftReady, error, fixture, indicators, name, open, requirements, scope, sourceTab, sourceText, status, step, stories, triggers]);

  const addSource = () => {
    const value = sourceTab === "file" ? (sourceText || `${step === 1 ? "audience" : "customer-story"}-source.pdf`) : sourceTab === "kb" ? "Brand story · Knowledge Base" : sourceText.trim();
    if (!value) return setError("Add or select one source first.");
    (step === 1 ? setDocs : setStories)((current) => [...current, value]);
    setSourceText(""); setError("");
  };

  const next = async () => {
    if (step === 0 && (!name.trim() || !description.trim())) return setError("Add both a name and description.");
    if (step < 3) { setError(""); setStep((value) => value + 1); return; }
    const reviewComplete = [...triggers, ...requirements, ...indicators].every((item) => item.trim()) && characteristics.every((item) => item.key.trim() && item.value.trim());
    if (!reviewComplete) return setError("Complete every audience detail before generating.");
    if (!fixture && (docs.length || stories.length)) return setError("Reading audience sources is not switched on yet. Remove the attached sources or come back later; nothing was saved.");
    setError(""); setStatus("processing");
    const saveRow = async () => {
      const content = `${name.trim()}: ${description.trim()} Buying triggers: ${triggers.join("; ")}. Requirements: ${requirements.join("; ")}. Success: ${indicators.join("; ")}.`;
      if (fixture) return { id: fixtureMemoryId("audience", name), category: "audience", content, source: "user" as const, pinned: scope === "workspace", updatedAt: fixtureUpdatedAt() };
      const result = await addMemory({ category: "audience", content });
      if ("error" in result) { setStatus("editing"); setError(result.error); return null; }
      return { id: result.id, category: "audience", content, source: "user" as const, pinned: scope === "workspace", updatedAt: new Date() };
    };
    window.setTimeout(async () => {
      const row = await saveRow();
      if (!row) return;
      onSaved(row); removeFixtureSession(AUDIENCE_DRAFT_KEY); setStatus("success");
    }, fixture ? 620 : 0);
  };

  const dirty = step > 0 || Boolean(name.trim() || description.trim() || docs.length || stories.length);
  const requestClose = () => dirty ? setCancelOpen(true) : onOpenChange(false);
  const editableList = (label: string, values: string[], setValues: React.Dispatch<React.SetStateAction<string[]>>) => <section className="r22-audience-list"><h3>{label} <span>{values.length} / 8</span></h3>{values.map((value, index) => <div key={`${label}-${index}`}><Input unstyled value={value} aria-label={`${label} ${index + 1}`} onChange={(event) => setValues((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} /><Button unstyled type="button" onClick={() => setValues((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></div>)}<Button unstyled type="button" className="is-quiet" disabled={values.length >= 8} onClick={() => setValues((current) => [...current, ""])}>Add</Button></section>;

  return <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : requestClose()}><DialogContent className="r22-kb-flow r22-audience-flow" showCloseButton={false}>
    {status === "processing" ? <div className="r22-kb-processing" aria-live="polite"><Spinner aria-hidden="true" /><DialogTitle>Generating audience</DialogTitle><DialogDescription>Reviewing the details and approved source list. Nothing is saved until this finishes.</DialogDescription><Progress className="r22-kb-progress" aria-label="Working" /></div> : status === "success" ? <div className="r22-brand-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>Audience saved</DialogTitle><DialogDescription>{name} is now approved {scope} context.</DialogDescription><Button unstyled className="is-primary" type="button" onClick={() => onOpenChange(false)}>Done</Button></div> : <>
      <DialogHeader><DialogTitle>Add Audience</DialogTitle><DialogDescription>{["Basic information", "Audience documentation", "Customer stories", "Review"][step]}</DialogDescription></DialogHeader>
      <div className="r22-audience-steps" aria-label={`Step ${step + 1} of 4`}>{["Basic information", "Documentation", "Customer stories", "Review"].map((label, index) => <span className={index === step ? "is-current" : index < step ? "is-done" : ""} key={label}>{index + 1} {label}</span>)}</div>
      <div className="r22-audience-layout"><div className="r22-kb-fields">{step === 0 ? <>
        <label>Name<Input unstyled autoFocus value={name} maxLength={100} onChange={(event) => setName(event.target.value)} /><small>{name.length} / 100</small></label>
        <label>Description<Textarea unstyled rows={5} value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} /><small>{description.length} / 500</small></label>
        <fieldset><legend>Audience access</legend><RadioGroup unstyled value={scope} onValueChange={(value) => setScope(value as "workspace" | "private")}><label><RadioGroupItem unstyled value="workspace" />Anyone in this workspace</label><label><RadioGroupItem unstyled value="private" />Private to me</label></RadioGroup></fieldset>
      </> : step < 3 ? <>
        <h3>{step === 1 ? "Audience documentation" : "Customer stories"}</h3><p>Add sources you have permission to use. Every item keeps its provenance.</p>
        <Tabs unstyled value={sourceTab} onValueChange={(value) => { setSourceTab(value as AudienceSourceTab); setSourceText(""); }}><TabsList unstyled className="r22-brand-source-tabs"><TabsTrigger unstyled value="file">Upload files</TabsTrigger><TabsTrigger unstyled value="paste">Paste text</TabsTrigger><TabsTrigger unstyled value="url">Add URL</TabsTrigger><TabsTrigger unstyled value="kb">Knowledge Base</TabsTrigger></TabsList></Tabs>
        {sourceTab === "file" ? <label>Document<Input unstyled type="file" accept=".doc,.docx,.pdf,.txt" onChange={(event) => setSourceText(event.target.files?.[0]?.name ?? "")} /><small>{sourceText || "DOC, DOCX, PDF or TXT · max 40 MB"}</small></label> : sourceTab === "paste" ? <label>Approved text<Textarea unstyled rows={5} value={sourceText} onChange={(event) => setSourceText(event.target.value)} /></label> : sourceTab === "url" ? <label>URL<Input unstyled type="url" value={sourceText} onChange={(event) => setSourceText(event.target.value)} placeholder="https://example.com/customer-story" /></label> : <label className="r22-kb-check"><Checkbox unstyled checked={sourceText === "Brand story · Knowledge Base"} onCheckedChange={(checked) => setSourceText(checked ? "Brand story · Knowledge Base" : "")} />Brand story · Knowledge Base</label>}
        <Button unstyled className="is-quiet" type="button" onClick={addSource}>Add source</Button>
        <div className="r22-audience-sources">{(step === 1 ? docs : stories).map((item, index) => <div key={`${item}-${index}`}><span>{item}</span><Button unstyled type="button" onClick={() => (step === 1 ? setDocs : setStories)((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Delete</Button></div>)}</div>
      </> : <>{editableList("Buying triggers", triggers, setTriggers)}{editableList("Use case requirements", requirements, setRequirements)}{editableList("Key success indicators", indicators, setIndicators)}<section className="r22-audience-list"><h3>Additional characteristics <span>{characteristics.length} / 10</span></h3>{characteristics.map((item, index) => <div key={index}><Input unstyled aria-label={`Characteristic ${index + 1} key`} value={item.key} placeholder="Key" onChange={(event) => setCharacteristics((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, key: event.target.value } : entry))} /><b>=</b><Input unstyled aria-label={`Characteristic ${index + 1} value`} value={item.value} placeholder="Value" onChange={(event) => setCharacteristics((current) => current.map((entry, itemIndex) => itemIndex === index ? { ...entry, value: event.target.value } : entry))} /><Button unstyled type="button" onClick={() => setCharacteristics((current) => current.filter((_, itemIndex) => itemIndex !== index))}>Remove</Button></div>)}<Button unstyled className="is-quiet" type="button" disabled={characteristics.length >= 10} onClick={() => setCharacteristics((current) => [...current, { key: "", value: "" }])}>Add characteristic</Button></section></>}
        {error ? <p className="r22-brand-voice-error" role="alert">{error}</p> : null}</div><aside className="r22-audience-preview"><b>{name || "Audience"}</b><span>{scope === "workspace" ? "Workspace" : "Private"}</span><p>{description || "No description yet"}</p><small>Sources: {docs.length + stories.length || "No sources"}</small></aside></div>
      <DialogFooter><Button unstyled type="button" className="is-quiet" disabled={step === 0} onClick={() => { setError(""); setStep((value) => Math.max(0, value - 1)); }}>Back</Button><Button unstyled type="button" className="is-primary" onClick={() => void next()}>{step === 3 ? "Generate audience" : "Next"}</Button></DialogFooter>
    </>}
  </DialogContent><AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="r22-brand-cancel-dialog"><AlertDialogHeader><AlertDialogTitle>Discard this audience draft?</AlertDialogTitle><AlertDialogDescription>The audience details, sources and review fields will be cleared.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { removeFixtureSession(AUDIENCE_DRAFT_KEY); setCancelOpen(false); onOpenChange(false); }}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></Dialog>;
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
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const stored = fixture ? readFixtureSession(STYLE_DRAFT_KEY) : null;
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { version?: number; kind?: "never" | "promise"; phrase?: string; replacement?: string; reason?: string };
        if (draft.version === 1) { setKind(draft.kind ?? "never"); setPhrase(draft.phrase ?? ""); setReplacement(draft.replacement ?? ""); setReason(draft.reason ?? ""); setError(""); setSuccess(false); return; }
      } catch { removeFixtureSession(STYLE_DRAFT_KEY); }
    }
    setKind("never"); setPhrase(""); setReplacement(""); setReason(""); setError(""); setSuccess(false);
  }, [fixture, open]);

  useEffect(() => {
    if (!fixture || !open || success) return;
    writeFixtureSession(STYLE_DRAFT_KEY, JSON.stringify({ version: 1, kind, phrase, replacement, reason }));
  }, [fixture, kind, open, phrase, reason, replacement, success]);

  const save = async () => {
    if (!phrase.trim()) return setError(kind === "never" ? "Add the word or phrase Otto must avoid." : "Add the promise Otto must never make.");
    if (kind === "never" && !replacement.trim()) return setError("Add the approved replacement Otto should use instead.");
    if (!reason.trim()) return setError("Explain why this rule exists.");
    setError(""); setBusy(true);
    const content = kind === "never" ? `Never say “${phrase.trim()}”. Use “${replacement.trim()}” instead. Why: ${reason.trim()}` : `Never promise “${phrase.trim()}”. Why: ${reason.trim()}`;
    let row: MemoryRow;
    if (fixture) row = { id: fixtureMemoryId("style", phrase), category: "style", content, source: "user", pinned: true, updatedAt: fixtureUpdatedAt() };
    else {
      const result = await addMemory({ category: "style", content });
      if ("error" in result) { setBusy(false); setError(result.error); return; }
      row = { id: result.id, category: "style", content, source: "user", pinned: true, updatedAt: new Date() };
    }
    window.setTimeout(() => { onSaved(row); removeFixtureSession(STYLE_DRAFT_KEY); setBusy(false); setSuccess(true); }, fixture ? 420 : 0);
  };
  const dirty = Boolean(phrase.trim() || replacement.trim() || reason.trim());
  const requestClose = () => dirty && !success ? setCancelOpen(true) : onOpenChange(false);

  return <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(true) : requestClose()}><DialogContent className="r22-kb-flow r22-style-flow" showCloseButton={false}>{success ? <div className="r22-brand-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>Style rule saved</DialogTitle><DialogDescription>Otto checks this rule before work reaches review.</DialogDescription><Button unstyled className="is-primary" type="button" onClick={() => onOpenChange(false)}>Done</Button></div> : <>
    <DialogHeader><DialogTitle>Add Style Guide rule</DialogTitle><DialogDescription>The exact rule remains editable and workspace-scoped. Otto may add suggestions, but Otto cannot remove merchant rules.</DialogDescription></DialogHeader>
    <div className="r22-kb-fields"><fieldset><legend>Rule type</legend><RadioGroup unstyled value={kind} onValueChange={(value) => setKind(value as "never" | "promise")}><label><RadioGroupItem unstyled value="never" />Never say</label><label><RadioGroupItem unstyled value="promise" />Promise we never make</label></RadioGroup></fieldset>
      <label>{kind === "never" ? "Word or phrase" : "Promise"}<Input unstyled autoFocus value={phrase} onChange={(event) => setPhrase(event.target.value)} placeholder={kind === "never" ? "Cheap" : "Guaranteed results"} /></label>
      {kind === "never" ? <label>Use instead<Input unstyled value={replacement} onChange={(event) => setReplacement(event.target.value)} placeholder="Accessible" /></label> : null}
      <label>Why this matters<Textarea unstyled rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Keep claims specific and supported by the product details." /></label>
      <p className="r22-kb-permission">This rule applies to new Otto drafts. Existing published or scheduled work is not rewritten.</p>{error ? <p className="r22-brand-voice-error" role="alert">{error}</p> : null}</div>
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
  const [logoName, setLogoName] = useState("");
  const [colours, setColours] = useState(["#0D9488", "#D4A373"]);
  const [nextColour, setNextColour] = useState("#16171C");
  const [titleFont, setTitleFont] = useState("Fraunces");
  const [headingFont, setHeadingFont] = useState("Geist");
  const [bodyFont, setBodyFont] = useState("");
  const [guideline, setGuideline] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<"editing" | "processing" | "success">("editing");
  const [cancelOpen, setCancelOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const stored = fixture ? readFixtureSession(VISUAL_DRAFT_KEY) : null;
    if (stored) {
      try {
        const draft = JSON.parse(stored) as { version?: number; step?: number; name?: string; scope?: "workspace" | "private"; logoName?: string; colours?: string[]; nextColour?: string; titleFont?: string; headingFont?: string; bodyFont?: string; guideline?: string };
        if (draft.version === 1) { setStep(Math.min(2, Math.max(0, draft.step ?? 0))); setName(draft.name ?? ""); setScope(draft.scope ?? "workspace"); setLogoName(draft.logoName ?? ""); setColours(draft.colours ?? []); setNextColour(draft.nextColour ?? "#16171C"); setTitleFont(draft.titleFont ?? ""); setHeadingFont(draft.headingFont ?? ""); setBodyFont(draft.bodyFont ?? ""); setGuideline(draft.guideline ?? ""); setError(""); setStatus("editing"); return; }
      } catch { removeFixtureSession(VISUAL_DRAFT_KEY); }
    }
    setStep(0); setName(""); setScope("workspace"); setLogoName(""); setColours(["#0D9488", "#D4A373"]); setNextColour("#16171C"); setTitleFont("Fraunces"); setHeadingFont("Geist"); setBodyFont(""); setGuideline(""); setError(""); setStatus("editing");
  }, [fixture, open]);

  useEffect(() => {
    if (!fixture || !open || status !== "editing") return;
    writeFixtureSession(VISUAL_DRAFT_KEY, JSON.stringify({ version: 1, step, name, scope, logoName, colours, nextColour, titleFont, headingFont, bodyFont, guideline }));
  }, [bodyFont, colours, fixture, guideline, headingFont, logoName, name, nextColour, open, scope, status, step, titleFont]);

  const next = async () => {
    if (step === 0 && !name.trim()) return setError("Give this Visual Guideline a name.");
    if (step === 1 && (!colours.length || !guideline.trim())) return setError("Keep at least one colour and add a framing guideline.");
    if (step < 2) { setError(""); setStep((value) => value + 1); return; }
    if (!fixture && logoName) return setError("Reading a logo file is not switched on yet. Remove the selected file or come back later; nothing was saved.");
    const content = `${name.trim()}: Colours ${colours.join(", ")}. Fonts: ${[titleFont, headingFont, bodyFont].filter(Boolean).join(", ") || "not set"}. ${guideline.trim()}`;
    setError(""); setStatus("processing");
    const save = async () => {
      if (fixture) return { id: fixtureMemoryId("visual", name), category: "visual", content, source: "user" as const, pinned: scope === "workspace", updatedAt: fixtureUpdatedAt() };
      const result = await addMemory({ category: "visual", content });
      if ("error" in result) { setStatus("editing"); setError(result.error); return null; }
      return { id: result.id, category: "visual", content, source: "user" as const, pinned: scope === "workspace", updatedAt: new Date() };
    };
    window.setTimeout(async () => { const row = await save(); if (!row) return; onSaved(row); removeFixtureSession(VISUAL_DRAFT_KEY); setStatus("success"); }, fixture ? 540 : 0);
  };
  const dirty = step > 0 || Boolean(name.trim() || logoName || guideline.trim());
  const requestClose = () => dirty && status !== "success" ? setCancelOpen(true) : onOpenChange(false);

  return <Dialog open={open} onOpenChange={(nextOpen) => nextOpen ? onOpenChange(true) : requestClose()}><DialogContent className="r22-kb-flow r22-visual-flow" showCloseButton={false}>{status === "processing" ? <div className="r22-kb-processing" aria-live="polite"><Spinner aria-hidden="true" /><DialogTitle>Saving Visual Guideline</DialogTitle><DialogDescription>Keeping the declared colours, font slots, source and scope together.</DialogDescription><Progress className="r22-kb-progress" aria-label="Working" /></div> : status === "success" ? <div className="r22-brand-success" role="status"><ShieldCheck aria-hidden="true" /><DialogTitle>Visual Guideline saved</DialogTitle><DialogDescription>{name} is now approved {scope} context.</DialogDescription><Button unstyled className="is-primary" type="button" onClick={() => onOpenChange(false)}>Done</Button></div> : <>
    <DialogHeader><DialogTitle>Add Visual Guideline</DialogTitle><DialogDescription>{["Basic information", "Brand assets and rules", "Review"][step]}</DialogDescription></DialogHeader>
    <div className="r22-audience-steps is-three" aria-label={`Step ${step + 1} of 3`}>{["Basic information", "Assets and rules", "Review"].map((label, index) => <span className={index === step ? "is-current" : index < step ? "is-done" : ""} key={label}>{index + 1} {label}</span>)}</div>
    <div className="r22-kb-fields">{step === 0 ? <><label>Name<Input unstyled autoFocus maxLength={100} value={name} onChange={(event) => setName(event.target.value)} placeholder="Lilin product photography" /><small>{name.length} / 100</small></label><fieldset><legend>Guideline access</legend><RadioGroup unstyled value={scope} onValueChange={(value) => setScope(value as "workspace" | "private")}><label><RadioGroupItem unstyled value="workspace" />Anyone in this workspace</label><label><RadioGroupItem unstyled value="private" />Private to me</label></RadioGroup></fieldset></> : step === 1 ? <>
      <label className="r22-kb-file">Logo<Input unstyled type="file" accept=".png,.jpg,.jpeg,.svg,.webp" onChange={(event) => setLogoName(event.target.files?.[0]?.name ?? "")} /><span>{logoName || "Add a logo or drag and drop one"}</span></label>
      <section className="r22-visual-colours"><h3>Colours ({colours.length})</h3><div>{colours.map((colour, index) => <span key={`${colour}-${index}`}><i style={{ background: colour }} /><code>{colour}</code><Button unstyled type="button" aria-label={`Remove ${colour}`} onClick={() => setColours((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</Button></span>)}</div><label>Add colour<Input unstyled value={nextColour} onChange={(event) => setNextColour(event.target.value.toUpperCase())} /><Button unstyled type="button" className="is-quiet" onClick={() => { if (/^#[0-9A-F]{6}$/.test(nextColour) && !colours.includes(nextColour)) setColours((current) => [...current, nextColour]); else setError("Enter a unique six-digit hex colour, for example #0D9488."); }}>Keep</Button></label></section>
      <section className="r22-visual-fonts"><h3>Fonts ({[titleFont, headingFont, bodyFont].filter(Boolean).length} of 3 set)</h3><label>Title<Input unstyled value={titleFont} onChange={(event) => setTitleFont(event.target.value)} /></label><label>Heading<Input unstyled value={headingFont} onChange={(event) => setHeadingFont(event.target.value)} /></label><label>Body<Input unstyled value={bodyFont} onChange={(event) => setBodyFont(event.target.value)} placeholder="Not set" /></label></section>
      <label>Framing and image direction<Textarea unstyled rows={5} value={guideline} onChange={(event) => setGuideline(event.target.value)} placeholder="Natural morning light, close product detail, teal batik used as a supporting surface." /></label>
    </> : <div className="r22-visual-review"><b>{name}</b><span>{scope === "workspace" ? "Workspace" : "Private"}</span><dl><div><dt>Logo</dt><dd>{logoName || "Not supplied"}</dd></div><div><dt>Colours</dt><dd>{colours.join(", ")}</dd></div><div><dt>Fonts</dt><dd>{[titleFont, headingFont, bodyFont].filter(Boolean).join(", ") || "Not set"}</dd></div><div><dt>Direction</dt><dd>{guideline}</dd></div></dl></div>}{error ? <p className="r22-brand-voice-error" role="alert">{error}</p> : null}</div>
    <DialogFooter><Button unstyled type="button" className="is-quiet" disabled={step === 0} onClick={() => { setError(""); setStep((value) => Math.max(0, value - 1)); }}>Back</Button><Button unstyled type="button" className="is-primary" onClick={() => void next()}>{step === 2 ? "Save Visual Guideline" : "Next"}</Button></DialogFooter>
  </>}</DialogContent><AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}><AlertDialogContent className="r22-brand-cancel-dialog"><AlertDialogHeader><AlertDialogTitle>Discard this Visual Guideline draft?</AlertDialogTitle><AlertDialogDescription>The name, assets, colours, font slots and direction will be cleared.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { removeFixtureSession(VISUAL_DRAFT_KEY); setCancelOpen(false); onOpenChange(false); }}>Discard draft</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></Dialog>;
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
  const [reviewOpen, setReviewOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fixtureWorkspaceId, setFixtureWorkspaceId] = useState(fixture ? "" : "production");
  const card = CARDS.find((item) => item.id === pane);
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

  if (fixture && (fixtureState === "loading" || fixtureState === "error" || fixtureState === "permission" || fixtureState === "unknown")) return <main className="r22-iq" data-r22-otto-iq data-state={fixtureState}><header><div><h1>Otto IQ</h1><p>Merchant-controlled knowledge for Otto — every item has a source, owner and scope.</p></div></header><section className="r22-iq-start"><div><b>{fixtureState === "loading" ? "Loading workspace context…" : fixtureState === "permission" ? "Otto IQ is not available to this member" : fixtureState === "unknown" ? "Otto IQ read outcome is unknown" : "Otto IQ could not be loaded"}</b><p>{fixtureState === "loading" ? "Nothing is guessed while this loads." : fixtureState === "permission" ? "No context names, counts or sources are exposed without the required capability." : "Nothing is guessed in its place. Retry the same workspace read."}</p></div>{fixtureState === "error" || fixtureState === "unknown" ? <Button unstyled type="button" onClick={() => router.replace("/brand?fixture=r22")}>Retry</Button> : null}</section></main>;

  if (fixture && !fixtureWorkspaceId) return <main className="r22-iq" data-r22-otto-iq aria-busy="true"><header><div><h1>Otto IQ</h1><p>Loading workspace-owned context…</p></div></header></main>;

  const acceptSavedRow = (row: MemoryRow) => {
    setRows((current) => current.some((item) => item.id === row.id) ? current : [...current, row]);
    if (!fixture) return;
    const stored = readFixtureSession(OTTO_IQ_FIXTURE_SAVED_KEY);
    let saved: MemoryRow[] = [];
    try { saved = stored ? JSON.parse(stored) as MemoryRow[] : []; } catch { saved = []; }
    writeFixtureSession(OTTO_IQ_FIXTURE_SAVED_KEY, JSON.stringify([...saved.filter((item) => item.id !== row.id), row]));
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
      const stored = readFixtureSession(OTTO_IQ_FIXTURE_SAVED_KEY);
      if (stored) {
        try { writeFixtureSession(OTTO_IQ_FIXTURE_SAVED_KEY, JSON.stringify((JSON.parse(stored) as MemoryRow[]).filter((row) => row.id !== selected.id))); } catch { removeFixtureSession(OTTO_IQ_FIXTURE_SAVED_KEY); }
      }
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

  if (pane === "hub") {
    return (
      <main className="r22-iq" data-r22-otto-iq>
        <header>
          <div><h1>Otto IQ</h1><p>Merchant-controlled knowledge for Otto — every item has a source, owner and scope.</p></div>
          <Button unstyled type="button" className="is-quiet" onClick={() => otto?.openPanel()}>Ask Otto</Button>
        </header>
        {fixture && fixtureWorkspaceId === "batik-house" ? <section className="r22-iq-nudge"><span aria-hidden="true" /><b>Otto</b><p>Otto noticed 4 things worth remembering.</p><Button unstyled type="button" onClick={() => setReviewOpen(true)}>Review</Button></section> : null}
        <div className="r22-iq-grid">
          {CARDS.map((item) => {
            const count = rows.filter((row) => item.categories.some((category) => row.category.toLowerCase().includes(category))).length;
            return <Button unstyled type="button" data-kind={item.id} key={item.id} onClick={() => open(item.id)}><i aria-hidden="true" /><span><b>{item.title}</b><small>{item.description}</small><em>{fixture && fixtureWorkspaceId === "batik-house" ? FIXTURE_COUNTS[item.id] : count ? `${count} saved` : "Not set up yet"}</em></span></Button>;
          })}
        </div>
        {rows.length === 0 ? <Empty className="r22-iq-start"><EmptyHeader><EmptyTitle>Start here</EmptyTitle><EmptyDescription>Add approved brand context before Otto creates. Every saved item stays workspace-scoped and carries its source.</EmptyDescription></EmptyHeader><EmptyContent><Button unstyled type="button" onClick={() => open("voice")}>Open Brand Voice</Button></EmptyContent></Empty> : null}
        <p className="r22-iq-consent">Only you choose what is saved here. Pending suggestions stay separate until you accept them; nothing is shared with another workspace. <Button unstyled type="button" onClick={() => toast("Exporting and deleting everything is not switched on yet. Nothing was exported or deleted.")}>Export or delete everything Otto knows</Button></p>
        <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
          <DialogContent className="r22-iq-detail">
            <DialogHeader><DialogTitle>Review Otto suggestions</DialogTitle><DialogDescription>These four observations are pending. Nothing joins Otto IQ until you keep it.</DialogDescription></DialogHeader>
            <ul className="r22-iq-review-list"><li>Customers often mention gift-ready packaging.</li><li>Teal batik appears across the latest Raya work.</li><li>Morning market photos use calm natural light.</li><li>Candle-care copy avoids unverified claims.</li></ul>
            <DialogFooter><Button unstyled type="button" className="is-primary" onClick={() => setReviewOpen(false)}>Done reviewing</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </main>
    );
  }

  return (
    <main className="r22-iq" data-r22-otto-iq>
      <nav><Button unstyled type="button" onClick={() => open("hub")}>Otto IQ</Button><ChevronRight className="size-3" aria-hidden="true" /><span>{card?.title}</span></nav>
      <header><div><h1>{card?.title}</h1><p>{card?.description}</p></div><Button unstyled type="button" onClick={() => card?.id === "voice" ? setVoiceFlowOpen(true) : setAdding(true)}>Add {card?.title}</Button></header>
      <div className="r22-iq-toolbar"><label><span className="sr-only">Search {card?.title}</span><Input unstyled type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${card?.title}`} /></label><span>{visible.length} saved</span></div>
      {visible.length ? <div className="r22-iq-table"><div><b>{card?.title}</b><b>Source</b><b>Scope</b><b>Updated</b></div>{visible.map((row) => <Button unstyled type="button" key={row.id} onClick={() => openRow(row)}><span><b>{rowName(row)}</b><small>{row.content}</small></span><span>{row.source === "user" ? "You" : "Otto suggestion"}</span><span>Workspace</span><span>{new Date(row.updatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span></Button>)}</div> : <Empty className="r22-iq-empty"><EmptyHeader><EmptyMedia variant="icon"><Eye /></EmptyMedia><EmptyTitle>{query ? "No approved context matches" : "Start with approved context"}</EmptyTitle><EmptyDescription>{query ? "Try a different search. Nothing was hidden as deleted." : "Add text you own. Otto never goes looking for material anywhere else."}</EmptyDescription></EmptyHeader>{!query ? <EmptyContent><Button unstyled type="button" className="is-quiet" onClick={() => card?.id === "voice" ? setVoiceFlowOpen(true) : setAdding(true)}>Add {card?.title}</Button></EmptyContent> : null}</Empty>}

      <Dialog open={selected !== null} onOpenChange={(next) => { if (!next) setSelected(null); }}>
        <DialogContent className="r22-iq-detail">
          <DialogHeader><DialogTitle>{selected ? rowName(selected) : card?.title}</DialogTitle><DialogDescription>Source and scope stay visible while you edit this workspace-owned context.</DialogDescription></DialogHeader>
          <dl><div><dt>Source</dt><dd>{selected?.source === "user" ? "You" : "Otto suggestion"}</dd></div><div><dt>Scope</dt><dd>Workspace</dd></div></dl>
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
    </main>
  );
}
