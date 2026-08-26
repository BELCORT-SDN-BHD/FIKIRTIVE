"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectNative } from "@/components/ui/native-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, File, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { createProject } from "@/lib/actions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import "./r22-projects.css";

export type R22ProjectRow = {
  id: string;
  name: string;
  ownerLabel: string;
  modifiedLabel: string;
  visibility: string;
  briefLabel: string;
};

const PROJECT_DRAFT_KEY = "r22:projects:create:draft:v1";

type ProjectDraft = {
  version: 1;
  title: string;
  goal: string;
  voice: string;
  audience: string;
  language: string;
  format: string;
  context: string;
};

function readProjectDraft(): ProjectDraft | null {
  try {
    const stored = window.sessionStorage.getItem(scopedR22FixtureKey(PROJECT_DRAFT_KEY));
    if (!stored) return null;
    const draft = JSON.parse(stored) as ProjectDraft;
    return draft.version === 1 ? draft : null;
  } catch { return null; }
}

function writeProjectDraft(draft: ProjectDraft | null) {
  try {
    const key = scopedR22FixtureKey(PROJECT_DRAFT_KEY);
    if (draft) window.sessionStorage.setItem(key, JSON.stringify(draft));
    else window.sessionStorage.removeItem(key);
  } catch { /* The create flow still works if refresh recovery is unavailable. */ }
}

export function R22ProjectsView({ projects, fixture = false, fixtureState = "ready", fixtureCreateOutcome = "success" }: { projects: R22ProjectRow[]; fixture?: boolean; fixtureState?: "ready" | "loading" | "error" | "permission" | "empty" | "unknown"; fixtureCreateOutcome?: "success" | "error" | "permission" | "unknown" }) {
  const router = useRouter();
  const [tab, setTab] = useState<"mine" | "shared" | "all">("mine");
  const [query, setQuery] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [voice, setVoice] = useState("Harvest warm");
  const [audience, setAudience] = useState("Returning customers");
  const [language, setLanguage] = useState("English");
  const [format, setFormat] = useState("9:16 Story / Reel");
  const [context, setContext] = useState("");
  const [error, setError] = useState("");
  const [draftReady, setDraftReady] = useState(!fixture);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [fixtureWorkspaceId, setFixtureWorkspaceId] = useState(fixture ? "" : "production");
  const [fixturePending, setFixturePending] = useState(false);
  const [fixtureFailedOnce, setFixtureFailedOnce] = useState(false);

  const draft = useMemo<ProjectDraft>(() => ({ version: 1, title, goal, voice, audience, language, format, context }), [audience, context, format, goal, language, title, voice]);
  const dirty = Boolean(title.trim() || goal.trim() || context.trim() || voice !== "Harvest warm" || audience !== "Returning customers" || language !== "English" || format !== "9:16 Story / Reel");

  useEffect(() => {
    if (!fixture) return;
    setFixtureWorkspaceId(readR22WorkspaceDirectory().activeId);
    const saved = readProjectDraft();
    if (saved) {
      setTitle(saved.title); setGoal(saved.goal); setVoice(saved.voice); setAudience(saved.audience);
      setLanguage(saved.language); setFormat(saved.format); setContext(saved.context); setModalOpen(true);
    }
    setDraftReady(true);
  }, [fixture]);

  useEffect(() => {
    if (!fixture || !draftReady || !modalOpen) return;
    writeProjectDraft(draft);
  }, [draft, draftReady, fixture, modalOpen]);

  const visibleProjects = useMemo(() => {
    if (tab === "shared") return [];
    if (fixture && fixtureWorkspaceId !== "batik-house") return [];
    const normalized = query.trim().toLowerCase();
    return projects.filter((project) => !normalized || project.name.toLowerCase().includes(normalized));
  }, [fixture, fixtureWorkspaceId, projects, query, tab]);

  const closeModal = () => {
    if (pending) return;
    if (dirty) {
      setCancelOpen(true);
      return;
    }
    setModalOpen(false);
    setError("");
  };

  const discardDraft = () => {
    writeProjectDraft(null);
    setCancelOpen(false);
    setModalOpen(false);
    setTitle(""); setGoal(""); setVoice("Harvest warm"); setAudience("Returning customers");
    setLanguage("English"); setFormat("9:16 Story / Reel"); setContext(""); setError("");
  };

  const create = () => {
    const cleanTitle = title.trim();
    if (!cleanTitle || pending) return;
    setError("");
    if (fixture) {
      setFixturePending(true);
      window.setTimeout(() => {
        setFixturePending(false);
        if (fixtureCreateOutcome === "permission") {
          setError("Your workspace permission does not allow project creation. Nothing was created.");
          return;
        }
        if ((fixtureCreateOutcome === "error" || fixtureCreateOutcome === "unknown") && !fixtureFailedOnce) {
          setFixtureFailedOnce(true);
          setError(fixtureCreateOutcome === "unknown" ? "Project creation outcome is unknown. Check this same draft before starting another." : "Project creation could not be confirmed. The draft is still here; retry safely.");
          return;
        }
        writeProjectDraft(null);
        const params = new URLSearchParams({ project: "fixture-raya", fixture: "r22" });
        if (goal.trim()) params.set("prompt", goal.trim());
        router.push(`/create/canvas?${params.toString()}`);
      }, 360);
      return;
    }
    startTransition(async () => {
      const result = await createProject(cleanTitle);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const draft = new URLSearchParams({ project: result.id });
      if (goal.trim()) draft.set("draftGoal", goal.trim());
      router.push(`/create/canvas?${draft.toString()}`);
    });
  };

  return (
    <Dialog open={modalOpen} onOpenChange={(open) => { if (open) setModalOpen(true); else closeModal(); }}>
    <div className="r22-projects" data-r22-projects>
      <p className="r22-projects-breadcrumb"><Link href={fixture ? "/?fixture=r22" : "/"}>Home</Link><span>/</span>Canvas</p>
      <h1>Canvas projects</h1>
      <p className="r22-projects-subtitle">Every creation workspace, brief and output stays together in one project.</p>

      <Tabs unstyled value={tab} onValueChange={(value) => setTab(value as "mine" | "shared" | "all")}>
        <TabsList unstyled className="r22-projects-tabs" aria-label="Project filters">
          <TabsTrigger unstyled value="mine">My projects</TabsTrigger>
          <TabsTrigger unstyled value="shared">Shared with me</TabsTrigger>
          <TabsTrigger unstyled value="all">All projects</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="r22-projects-toolbar">
        <label><Search aria-hidden="true" /><Input unstyled value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" /></label>
        <DialogTrigger asChild><Button unstyled type="button" disabled={fixture && fixtureState !== "ready" && fixtureState !== "empty"}><Plus data-icon="inline-start" aria-hidden="true" />Create project</Button></DialogTrigger>
      </div>

      <div className="r22-projects-table" role="table" aria-label="Canvas projects" aria-busy={fixtureState === "loading"}>
        <div className="r22-projects-row r22-projects-head" role="row">
          <span>Name</span><span>Owner</span><span>Last modified</span><span>Visibility</span><span />
        </div>
        {fixtureState === "loading" ? <div className="r22-projects-empty" role="status">Loading authorized projects…</div> : fixtureState === "error" ? <div className="r22-projects-empty" role="alert">Projects could not be loaded. Nothing is guessed in its place. <Link href="/create?fixture=r22">Retry</Link></div> : fixtureState === "unknown" ? <div className="r22-projects-empty" role="status">Project read outcome is unknown. Nothing is guessed in its place. <Link href="/create?fixture=r22">Retry</Link></div> : fixtureState === "permission" ? <div className="r22-projects-empty" role="alert">You do not have permission to view projects in this workspace. <Link href="/?fixture=r22">Back to Home</Link></div> : visibleProjects.map((project) => (
          <Link className="r22-projects-row" role="row" key={project.id} href={fixture ? `/create/canvas?project=${encodeURIComponent(project.id)}&fixture=r22` : `/create/canvas?project=${encodeURIComponent(project.id)}`}>
            <span className="r22-projects-name"><i><File aria-hidden="true" /></i><span><b>{project.name}</b><small>{project.briefLabel}</small></span></span>
            <span>{project.ownerLabel}</span><span>{project.modifiedLabel}</span><span>{project.visibility}</span><span><ChevronRight aria-hidden="true" /></span>
          </Link>
        ))}
        {fixtureState !== "loading" && fixtureState !== "error" && fixtureState !== "permission" && fixtureState !== "unknown" && !visibleProjects.length && <div className="r22-projects-empty">{tab === "shared" ? "No projects have been shared with you." : fixtureState === "empty" ? "No projects yet. Create one when you are ready." : "No projects match this search."}</div>}
      </div>

      <DialogContent className="r22-projects-modal">
            <DialogHeader><DialogTitle>Create project</DialogTitle><DialogDescription>Give Otto a stable brief before opening the creation canvas.</DialogDescription></DialogHeader>
            <div className="r22-projects-form">
              <label className="is-wide"><span>Project title</span><Input unstyled autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Raya gift set launch" /></label>
              <label className="is-wide"><span>Goal</span><Textarea unstyled rows={3} value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Create a launch set for Instagram Stories and feed." /></label>
              <label><span>Brand voice</span><SelectNative unstyled value={voice} onChange={(event) => setVoice(event.target.value)}><option>Harvest warm</option><option>Everyday</option><option>Not selected</option></SelectNative></label>
              <label><span>Audience</span><SelectNative unstyled value={audience} onChange={(event) => setAudience(event.target.value)}><option>Returning customers</option><option>Weekend gift buyers</option><option>Not selected</option></SelectNative></label>
              <label><span>Language</span><SelectNative unstyled value={language} onChange={(event) => setLanguage(event.target.value)}><option>English</option><option>Bahasa Malaysia</option><option>Chinese</option></SelectNative></label>
              <label><span>Default format</span><SelectNative unstyled value={format} onChange={(event) => setFormat(event.target.value)}><option>9:16 Story / Reel</option><option>1:1 Feed</option><option>16:9 Wide</option></SelectNative></label>
              <label className="is-wide"><span>Context</span><Input unstyled value={context} onChange={(event) => setContext(event.target.value)} placeholder="Paste a campaign link or add a note" /></label>
              {!fixture && <p className="r22-projects-contract">The current backend saves the project title. Goal, voice, audience, language, format and context remain a frontend draft until the brief contract is connected.</p>}
              {error && <p className="r22-projects-error" role="alert">{error}</p>}
            </div>
            <footer><Button unstyled type="button" disabled={pending || fixturePending} onClick={closeModal}>Cancel</Button><Button unstyled type="button" disabled={!title.trim() || pending || fixturePending} onClick={create}>{pending || fixturePending ? "Creating…" : error && fixtureCreateOutcome === "unknown" ? "Check project status" : error && fixtureCreateOutcome === "error" ? "Retry creation" : "Create and open canvas"}</Button></footer>
      </DialogContent>
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="r22-projects-cancel-dialog">
          <AlertDialogHeader><AlertDialogTitle>Discard this project draft?</AlertDialogTitle><AlertDialogDescription>Your title, goal, audience and creation defaults will be removed from this fixture.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={discardDraft}>Discard draft</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
    </Dialog>
  );
}

export default R22ProjectsView;
