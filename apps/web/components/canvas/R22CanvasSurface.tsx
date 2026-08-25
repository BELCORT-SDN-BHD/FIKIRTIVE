"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Frame,
  Hand,
  ImagePlus,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Star,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CANVAS_HREF, CREATE_NAV_HREF } from "@fikirtive/core/navigation";
import type { EntityDTO } from "@/lib/types";
import { canvasHref } from "./canvas-href";
import { listCanvasNodes, type CanvasNodeDTO } from "@/lib/canvas-actions";
import type { ImmersiveCanvasRuntimeContext } from "./NorthstarCanvasWorkspace";
import { freshCanvasActionId, useCanvasGen, type CanvasGenProgress } from "./useCanvasGen";
import type { CanvasGenCostQuote } from "@/lib/canvas-gen-costs";
import { readR22WorkspaceDirectory, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import "./r22-canvas.css";

type CanvasTool = "select" | "box" | "hand" | "image" | "star" | "arrange";

type CanvasQuestion = { header: string; question: string; help: string; multi: boolean; required: boolean; options: Array<{ label: string; description: string; recommended?: boolean }> };
type CanvasQuestionFlow = { title: string; reason: string; cost: number; questions: CanvasQuestion[] };
type PendingCanvasQuestion = { taskId: string; inputRequestId: string; taskVersion: number; flow: CanvasQuestionFlow; prompt: string; index: number; selected: string[]; answers: string[] };
type DecisionEvent = { kind: "input_requested" | "answer" | "resumed" | "cancelled"; label: string; detail: string };
type DecisionRecord = { taskId: string; inputRequestId: string; taskVersion: number; status: "waiting" | "answered" | "cancelled"; title: string; detail: string; events: DecisionEvent[] };
type FixtureCanvasJob = { id: string; prompt: string; status: "queued" | "running" | "completed" | "failed" };

const CANVAS_QUESTION_FLOWS: Record<"creative" | "scope", CanvasQuestionFlow> = {
  creative: {
    title: "Creative direction",
    reason: "Two valid creative directions would produce materially different work.",
    cost: 3,
    questions: [
      { header: "Lead product", question: "Which product should lead this Raya concept?", help: "Otto found two valid products in your references. Choose one so the hero stays specific.", multi: false, required: true, options: [{ label: "Teal batik candle", description: "Use the strongest Raya visual cue", recommended: true }, { label: "Pandan gift set", description: "Lead with gifting and product value" }, { label: "Use both", description: "Create a paired-product hero" }] },
      { header: "Deliverables", question: "Which formats should Otto prepare?", help: "Choose one or more. Each selected format stays in this project.", multi: true, required: true, options: [{ label: "Instagram Story", description: "9:16 vertical concept", recommended: true }, { label: "Feed post", description: "1:1 single-image concept" }, { label: "Carousel", description: "4:5 multi-slide concept" }] },
    ],
  },
  scope: {
    title: "Execution scope",
    reason: "The requested output can be delivered in several channels and sizes.",
    cost: 3,
    questions: [
      { header: "Channels", question: "Where will this version be used?", help: "Choose every destination Otto should prepare in this run.", multi: true, required: true, options: [{ label: "Instagram", description: "Story and feed-ready outputs", recommended: true }, { label: "Facebook", description: "Feed-safe copy and crop" }, { label: "Email", description: "Hero image and campaign copy" }] },
      { header: "Timing", question: "When should the campaign be ready for review?", help: "This sets the review target, not an automatic publish time.", multi: false, required: true, options: [{ label: "Tomorrow morning", description: "Prepare a complete review set", recommended: true }, { label: "Today", description: "Prioritise a fast first pass" }, { label: "This week", description: "Allow more exploration and variants" }] },
    ],
  },
};

function fixtureQuestionFlow(prompt: string): CanvasQuestionFlow | null {
  if (!/premium|luxury|make it better|more polished|surprise me|audience|offer|goal|outcome|reference|source|conflict|channel|format|schedule|when|deliverable/i.test(prompt)) return null;
  return /channel|format|schedule|when|deliverable/i.test(prompt) ? CANVAS_QUESTION_FLOWS.scope : CANVAS_QUESTION_FLOWS.creative;
}

const TOOL_BUTTONS: Array<{
  id: CanvasTool;
  label: string;
  icon: typeof MousePointer2;
}> = [
  { id: "select", label: "Select", icon: MousePointer2 },
  { id: "box", label: "Box select", icon: Frame },
  { id: "hand", label: "Pan", icon: Hand },
  { id: "image", label: "Add image", icon: ImagePlus },
  { id: "star", label: "Star selected", icon: Star },
  { id: "arrange", label: "Arrange canvas", icon: LayoutGrid },
];

function OttoMark() {
  return <Image className="r22-otto-mark" src="/brand/r22-otto-thinking.svg" width={120} height={110} alt="" />;
}

function FixtureWorld() {
  return (
    <div className="r22-canvas-world" aria-label="R22 high-fidelity visual fixture">
      <article className="r22-canvas-object r22-canvas-sticky">
        <span>Sticky · free</span>
        <p>Teal + gold table set. Try one flat-lay, one lifestyle shot.</p>
      </article>

      <article className="r22-canvas-object r22-canvas-research">
        <b>Extracted from your page</b>
        <code>harvestcandle.co / raya-collection</code>
        <p>“Four scents inspired by Raya mornings — teal batik, gold thread, warm oud, and pandan light.”</p>
      </article>

      <section className="r22-canvas-object r22-canvas-batch" aria-label="Batch of four images">
        <span className="r22-canvas-batch-tag">Batch · 4 images · 12 cr</span>
        <div className="r22-canvas-batch-row">
          <Button unstyled className="r22-canvas-art r22-canvas-art-one" type="button" aria-label="Image 1">
            <Image src="/fixtures/r22-canvas/art-1.jpg" fill sizes="128px" alt="Raya concept 1" priority />
          </Button>
          <Button unstyled className="r22-canvas-art r22-canvas-art-two" type="button" aria-label="Image 2">
            <Image src="/fixtures/r22-canvas/art-2.jpg" fill sizes="128px" alt="Raya concept 2" priority />
          </Button>
          <Button unstyled className="r22-canvas-art r22-canvas-art-three" type="button" aria-label="Image 3">
            <Image src="/fixtures/r22-canvas/art-3.jpg" fill sizes="128px" alt="Raya concept 3" priority />
          </Button>
          <Button unstyled className="r22-canvas-art r22-canvas-art-four" type="button" aria-label="Image 4">
            <Image src="/fixtures/r22-canvas/art-4.jpg" fill sizes="128px" alt="Raya concept 4" priority />
          </Button>
        </div>
      </section>
    </div>
  );
}

function EmptyWorld({ loading = false, error }: { loading?: boolean; error?: string | null }) {
  return (
    <div className="r22-canvas-world">
      <section className="r22-canvas-empty" aria-live="polite" role={error ? "alert" : undefined}>
        <b>{error ? "Canvas could not be loaded" : loading ? "Loading canvas…" : "No canvas items yet"}</b>
        <p>{error || (loading ? "Reading this project's saved items." : "Describe what to make below. Generated media will appear here after the paid action is accepted.")}</p>
      </section>
    </div>
  );
}

function LiveWorld({ nodes, loading, error, zoom }: { nodes: CanvasNodeDTO[]; loading: boolean; error: string | null; zoom: number }) {
  if (loading || error || nodes.length === 0) return <EmptyWorld loading={loading} error={error} />;
  return (
    <div className="r22-canvas-world" style={{ transform: `translate(-560px, -260px) scale(${zoom / 100})` }}>
      {nodes.map((node) => (
        <article
          className={`r22-canvas-live-node is-${node.type} is-${node.status}`}
          key={node.id}
          style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
          tabIndex={0}
          aria-label={`${node.type} canvas item${node.prompt ? `: ${node.prompt}` : ""}`}
        >
          {node.url ? <img src={node.url} alt={node.prompt || "Generated canvas media"} /> : null}
          {node.type === "text" ? <p>{node.text || "Empty note"}</p> : null}
          {!node.url && node.type !== "text" ? (
            <div className="r22-canvas-live-state">
              {node.status === "queued" || node.status === "generating" ? <span className="r22-canvas-mini-spinner" aria-hidden="true" /> : null}
              <b>{node.status === "failed" ? "Generation failed" : node.status === "cancelled" ? "Generation canceled" : node.status === "timeout" ? "Still working" : "Generating"}</b>
              <p>{node.prompt || "Canvas generation"}</p>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function R22CanvasSurface({
  runtimeContext,
  entities,
}: {
  runtimeContext: ImmersiveCanvasRuntimeContext;
  entities: EntityDTO[];
}) {
  const fixture = runtimeContext.visualFixture === "r22";
  const fixtureRouteState = runtimeContext.fixtureRouteState ?? "ready";
  const fixtureSendOutcome = runtimeContext.fixtureSendOutcome ?? "success";
  const searchParams = useSearchParams();
  const activeProject = useMemo(
    () => runtimeContext.projects.find((project) => project.id === runtimeContext.activeProjectId),
    [runtimeContext.activeProjectId, runtimeContext.projects],
  );
  const [ottoOpen, setOttoOpen] = useState(true);
  const [conversationOpen, setConversationOpen] = useState(true);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [ratioOpen, setRatioOpen] = useState(false);
  const [ratio, setRatio] = useState("9:16");
  const [tool, setTool] = useState<CanvasTool>("select");
  const [zoom, setZoom] = useState(100);
  const [message, setMessage] = useState(runtimeContext.initialPrompt ?? "");
  const [notice, setNotice] = useState("");
  const [fixtureMessages, setFixtureMessages] = useState<string[]>([]);
  const [pendingQuestion, setPendingQuestion] = useState<PendingCanvasQuestion | null>(null);
  const [otherAnswer, setOtherAnswer] = useState("");
  const [decisionRecord, setDecisionRecord] = useState<DecisionRecord | null>(null);
  const [decisionOpen, setDecisionOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [liveNodes, setLiveNodes] = useState<CanvasNodeDTO[]>([]);
  const [nodesLoading, setNodesLoading] = useState(!fixture);
  const [nodesError, setNodesError] = useState<string | null>(null);
  const [costQuote, setCostQuote] = useState<CanvasGenCostQuote | null>(null);
  const [ratioOptions, setRatioOptions] = useState<string[]>(fixture ? ["9:16", "1:1", "16:9"] : []);
  const [generationProgress, setGenerationProgress] = useState<CanvasGenProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fixtureRestored, setFixtureRestored] = useState(!fixture);
  const [fixtureWorkspaceId, setFixtureWorkspaceId] = useState(fixture ? "" : "production");
  const [fixtureJob, setFixtureJob] = useState<FixtureCanvasJob | null>(null);
  const [fixtureSendFailedOnce, setFixtureSendFailedOnce] = useState(false);
  const fixtureTimersRef = useRef<number[]>([]);
  const actionRef = useRef<{ material: string; actionId: string } | null>(null);
  const answeredRequestsRef = useRef(new Set<string>());
  const fixtureStorageKey = fixture ? scopedR22FixtureKey(`r22:canvas:${runtimeContext.activeProjectId}:${runtimeContext.activeThreadId ?? "new"}`) : "";

  const refreshNodes = useCallback(async () => {
    if (fixture) return;
    const rows = await listCanvasNodes(runtimeContext.activeProjectId).catch(() => ({ error: "load-failed" } as const));
    if ("error" in rows) {
      setNodesError("Canvas items could not be loaded.");
      setNotice("Canvas items could not be loaded. No empty state was inferred.");
    } else {
      setNodesError(null);
      setLiveNodes(rows);
    }
    setNodesLoading(false);
  }, [fixture, runtimeContext.activeProjectId]);

  // `useSearchParams()` 在没有 Suspense 边界的渲染里给得出 null(Next 的类型没说,运行时
  // 会)。两处都拿它拼地址,少一处护栏就是少一处 TypeError,所以两处写法一致。
  const projectHref = useCallback((projectId: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("project", projectId);
    next.delete("thread");
    return `${CANVAS_HREF}?${next.toString()}`;
  }, [searchParams]);

  const threadHref = useCallback((threadId: string) => {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    next.set("project", runtimeContext.activeProjectId);
    next.set("thread", threadId);
    return `${CANVAS_HREF}?${next.toString()}`;
  }, [runtimeContext.activeProjectId, searchParams]);

  const onNewNode = useCallback((node: { id: string; type: "image" | "video"; pos: { x: number; y: number; w: number; h: number }; status: string; url?: string; prompt: string; generationId?: string; genJobId?: string }) => {
    setLiveNodes((current) => [...current, {
      id: node.id, type: node.type, x: node.pos.x, y: node.pos.y, w: node.pos.w, h: node.pos.h,
      text: null, prompt: node.prompt, generationId: node.generationId ?? null, genJobId: node.genJobId ?? null,
      status: node.status as CanvasNodeDTO["status"], failureReason: "unexplained", batchIndex: null,
      batchSize: null, layoutAnchorNodeId: null, madeFromNodeId: null, threadId: runtimeContext.activeThreadId,
      url: node.url ?? null, mediaWidth: null, mediaHeight: null, origin: null, lineage: null,
    }]);
  }, [runtimeContext.activeThreadId]);

  const onResolve = useCallback((nodeId: string, url: string | null, status: string, generationId?: string) => {
    setLiveNodes((current) => current.map((node) => node.id === nodeId ? { ...node, url, status: status as CanvasNodeDTO["status"], generationId: generationId ?? node.generationId } : node));
    setGenerationProgress(null);
  }, []);

  const onProgress = useCallback((progress: CanvasGenProgress) => setGenerationProgress(progress), []);
  const { generateImage, quoteCosts, imageShapes } = useCanvasGen(
    runtimeContext.activeProjectId,
    onNewNode,
    onResolve,
    runtimeContext.activeThreadId,
    setNotice,
    undefined,
    onProgress,
    refreshNodes,
    (nodeId) => setLiveNodes((current) => current.filter((node) => node.id !== nodeId)),
  );

  useEffect(() => {
    queueMicrotask(() => void refreshNodes());
  }, [refreshNodes]);
  useEffect(() => {
    if (!fixture) return;
    setFixtureWorkspaceId(readR22WorkspaceDirectory().activeId);
    const stored = window.sessionStorage.getItem(fixtureStorageKey);
    if (stored) {
      try {
        const restored = JSON.parse(stored) as { version?: number; messages?: string[]; pending?: PendingCanvasQuestion | null; other?: string; decision?: DecisionRecord | null; job?: FixtureCanvasJob | null };
        if (restored.version !== 1) throw new Error("stale fixture state");
        setFixtureMessages(restored.messages ?? []);
        setPendingQuestion(restored.pending ?? null);
        setOtherAnswer(restored.other ?? "");
        setDecisionRecord(restored.decision ?? null);
        setFixtureJob(restored.job ?? null);
        if (restored.job?.status === "queued" || restored.job?.status === "running") {
          window.setTimeout(() => startFixtureJob(restored.job!.prompt, restored.job!.id), 0);
        }
        if (restored.decision?.status === "answered") answeredRequestsRef.current.add(restored.decision.inputRequestId);
      } catch {
        window.sessionStorage.removeItem(fixtureStorageKey);
      }
    }
    setFixtureRestored(true);
  }, [fixture, fixtureStorageKey]);
  useEffect(() => {
    if (!fixture || !fixtureRestored) return;
    window.sessionStorage.setItem(fixtureStorageKey, JSON.stringify({ version: 1, messages: fixtureMessages, pending: pendingQuestion, other: otherAnswer, decision: decisionRecord, job: fixtureJob }));
  }, [decisionRecord, fixture, fixtureJob, fixtureMessages, fixtureRestored, fixtureStorageKey, otherAnswer, pendingQuestion]);
  useEffect(() => () => { fixtureTimersRef.current.forEach((timer) => window.clearTimeout(timer)); }, []);
  useEffect(() => {
    if (fixture) return;
    void quoteCosts(1).then(setCostQuote).catch(() => setCostQuote(null));
    void imageShapes().then((shapes) => {
      setRatioOptions(shapes.options);
      setRatio((current) => shapes.options.includes(current) ? current : shapes.defaultAspect);
    }).catch(() => setRatioOptions([]));
  }, [fixture, imageShapes, quoteCosts]);

  function startFixtureJob(prompt: string, receiptId?: string) {
    const id = receiptId ?? fixtureJob?.id ?? `fixture-action-${fixtureMessages.length}`;
    setSubmitting(true);
    setFixtureJob({ id, prompt, status: "queued" });
    setNotice("Queued from one local fixture receipt. No provider or credit ledger was called.");
    fixtureTimersRef.current.push(window.setTimeout(() => {
      setFixtureJob({ id, prompt, status: "running" });
      setNotice("Fixture generation is running from the same local receipt.");
    }, 320));
    fixtureTimersRef.current.push(window.setTimeout(() => {
      setSubmitting(false);
      setFixtureJob({ id, prompt, status: "completed" });
      setNotice("Fixture generation completed once. Production success still requires a durable backend receipt.");
    }, 920));
  }

  function retryFixtureSend() {
    if (!fixtureJob || fixtureJob.status !== "failed" || submitting) return;
    startFixtureJob(fixtureJob.prompt);
  }

  const submitMessage = async () => {
    const next = message.trim();
    if (!next) return;
    if (fixture) {
      if (fixtureRouteState !== "ready") {
        setNotice("This project is not available. Return to Projects before sending anything.");
        return;
      }
      setFixtureMessages((current) => [...current, next]);
      const flow = fixtureQuestionFlow(next);
      if (flow) {
        const taskId = `fixture-task-${fixtureMessages.length + 1}`;
        const inputRequestId = `${taskId}:input:1`;
        const taskVersion = 1;
        setPendingQuestion({ taskId, inputRequestId, taskVersion, flow, prompt: next, index: 0, selected: [], answers: [] });
        setDecisionRecord({
          taskId,
          inputRequestId,
          taskVersion,
          status: "waiting",
          title: `${flow.title} · ${flow.questions.length} questions`,
          detail: `Why Otto paused: ${flow.reason}`,
          events: [{ kind: "input_requested", label: "Input requested", detail: `${flow.questions.length} required decisions · 0 cr while waiting` }],
        });
        setOttoOpen(true);
        setConversationOpen(true);
        setNotice("Otto paused — no credits used while waiting for your answer.");
      } else {
        if (fixtureSendOutcome === "permission") {
          setFixtureJob({ id: `fixture-action-${fixtureMessages.length + 1}`, prompt: next, status: "failed" });
          setNotice("Your workspace permission does not allow this generation. Nothing ran and no credits were used.");
        } else if (fixtureSendOutcome === "credits") {
          setFixtureJob({ id: `fixture-action-${fixtureMessages.length + 1}`, prompt: next, status: "failed" });
          setNotice("Insufficient credits. Nothing ran; add credits before retrying this exact request.");
        } else if ((fixtureSendOutcome === "error" || fixtureSendOutcome === "unknown") && !fixtureSendFailedOnce) {
          const id = `fixture-action-${fixtureMessages.length + 1}`;
          setSubmitting(true);
          window.setTimeout(() => {
            setSubmitting(false);
            setFixtureSendFailedOnce(true);
            setFixtureJob({ id, prompt: next, status: "failed" });
            setNotice(fixtureSendOutcome === "unknown" ? "Generation outcome is unknown. Check this same receipt before starting another; no charge or success is assumed." : "The fixture provider did not confirm this job. Nothing was charged; retry reuses the same request.");
          }, 360);
        } else startFixtureJob(next);
      }
      setMessage("");
      return;
    }
    if (!costQuote || !ratioOptions.length) {
      setNotice("Wait for the exact generation cost and available ratio before sending.");
      return;
    }
    if (submitting) return;
    const material = JSON.stringify({ projectId: runtimeContext.activeProjectId, threadId: runtimeContext.activeThreadId, prompt: next, ratio });
    if (actionRef.current?.material !== material) actionRef.current = { material, actionId: freshCanvasActionId() };
    setSubmitting(true);
    setNotice("");
    const accepted = await generateImage(next, { x: 1020, y: 520, w: 320, h: 320 }, [], {}, 1, { actionId: actionRef.current.actionId, aspectRatio: ratio });
    setSubmitting(false);
    if (!accepted) return;
    actionRef.current = null;
    setMessage("");
    setNotice("Generation accepted. The canvas card will update from the durable job state.");
  };

  const currentQuestion = pendingQuestion?.flow.questions[pendingQuestion.index];
  const currentAnswer = pendingQuestion ? [...pendingQuestion.selected, ...(otherAnswer.trim() ? [otherAnswer.trim()] : [])].join(", ") : "";

  function toggleQuestionOption(label: string) {
    if (!pendingQuestion || !currentQuestion) return;
    setOtherAnswer("");
    setPendingQuestion((current) => current ? { ...current, selected: currentQuestion.multi ? (current.selected.includes(label) ? current.selected.filter((item) => item !== label) : [...current.selected, label]) : [label] } : current);
  }

  function continueQuestion() {
    if (!pendingQuestion || !currentQuestion || !currentAnswer) return;
    const answers = [...pendingQuestion.answers, currentAnswer];
    if (pendingQuestion.index < pendingQuestion.flow.questions.length - 1) {
      setPendingQuestion({ ...pendingQuestion, index: pendingQuestion.index + 1, selected: [], answers });
      setOtherAnswer("");
      setDecisionRecord((current) => current ? { ...current, title: `${pendingQuestion.flow.title} · ${pendingQuestion.index + 2} of ${pendingQuestion.flow.questions.length}`, events: [...current.events, { kind: "answer", label: currentQuestion.header, detail: currentAnswer }] } : current);
      return;
    }
    if (answeredRequestsRef.current.has(pendingQuestion.inputRequestId)) {
      setNotice("This answer was already accepted. The original receipt was reused; no duplicate task or spend was created.");
      return;
    }
    answeredRequestsRef.current.add(pendingQuestion.inputRequestId);
    const detail = pendingQuestion.flow.questions.map((question, index) => `${question.question} ${answers[index]}`).join(" · ");
    setDecisionRecord((current) => current ? { ...current, status: "answered", title: `${pendingQuestion.flow.title} · ${answers.length} answers saved`, detail: `Why Otto paused: ${pendingQuestion.flow.reason} · ${detail}`, events: [...current.events, { kind: "answer", label: currentQuestion.header, detail: currentAnswer }, { kind: "resumed", label: "Task resumed", detail: `Receipt ${pendingQuestion.inputRequestId} · version ${pendingQuestion.taskVersion} · no paid action run in fixture` }] } : current);
    setPendingQuestion(null);
    setOtherAnswer("");
    setNotice("Decision saved in Conversation. Fixture task resumed; no paid action was run.");
  }

  function cancelQuestion() {
    if (!pendingQuestion) return;
    setDecisionRecord((current) => current ? { ...current, status: "cancelled", title: `${pendingQuestion.flow.title} · task cancelled`, detail: "No answer was used. No credits were spent.", events: [...current.events, { kind: "cancelled", label: "Task cancelled", detail: `Request ${pendingQuestion.inputRequestId} cannot be submitted again` }] } : current);
    setPendingQuestion(null);
    setOtherAnswer("");
    setNotice("Task cancelled — no credits were used.");
  }

  return (
    <section
      className="r22-canvas-surface"
      data-r22-canvas-surface
      data-fixture={fixture ? "r22" : "live"}
      aria-label="Canvas workspace"
    >
      <header className="r22-canvas-topbar" data-r22-canvas-topbar>
        <Link className="r22-canvas-icon-button" href={fixture ? `${CREATE_NAV_HREF}?fixture=r22` : CREATE_NAV_HREF} aria-label="Back to Canvas projects">
          <ArrowLeft aria-hidden="true" />
        </Link>
        <div className="r22-canvas-project-switcher">
          <Button unstyled
            type="button"
            className="r22-canvas-project-button"
            disabled={fixture && fixtureRouteState !== "ready"}
            aria-expanded={projectMenuOpen}
            onClick={() => setProjectMenuOpen((open) => !open)}
          >
            <span>{fixture ? fixtureRouteState === "loading" ? "Loading project…" : fixtureRouteState !== "ready" ? "Project unavailable" : !fixtureWorkspaceId ? "Loading project…" : fixtureWorkspaceId === "batik-house" ? "Raya launch" : "New workspace project" : (activeProject?.name ?? "Current project")}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
          {projectMenuOpen && (!fixture || fixtureRouteState === "ready") && (
            <div className="r22-canvas-project-menu">
              {runtimeContext.projects.map((project) => (
                <Link
                  key={project.id}
                  href={projectHref(project.id)}
                  onClick={() => setProjectMenuOpen(false)}
                >
                  {project.name}
                </Link>
              ))}
            </div>
          )}
        </div>
        <span className="r22-canvas-saved">
          {fixture ? fixtureRouteState === "ready" ? "Saved just now" : fixtureRouteState === "loading" ? "Checking project…" : "Project unavailable" : nodesLoading ? "Loading project…" : nodesError ? "Project unavailable" : "Loaded from project"}
        </span>
        <span className="r22-canvas-topbar-spacer" />
        {fixture && <span className="r22-canvas-sample-note">Prototype · sample data</span>}
        <Button unstyled type="button" className="r22-canvas-quiet-button" disabled={fixture && fixtureRouteState !== "ready"} onClick={() => setNotice("Sharing is not connected yet.")}>Share</Button>
        <Button unstyled type="button" className="r22-canvas-quiet-button" disabled={fixture && fixtureRouteState !== "ready"} onClick={() => setNotice("Export is not connected yet.")}>Export</Button>
      </header>

      <div className="r22-canvas-stage" data-r22-canvas-stage>
        {fixture && fixtureRouteState !== "ready" ? <EmptyWorld loading={fixtureRouteState === "loading"} error={fixtureRouteState === "error" ? "Project data could not be loaded." : fixtureRouteState === "permission" ? "You do not have permission to open this project." : fixtureRouteState === "unknown" ? "Project read outcome is unknown. No board or empty state was inferred." : "This project no longer exists in the current workspace."} /> : fixture ? !fixtureRestored || !fixtureWorkspaceId ? <EmptyWorld loading /> : fixtureWorkspaceId === "batik-house" ? <FixtureWorld /> : <EmptyWorld /> : <LiveWorld nodes={liveNodes} loading={nodesLoading} error={nodesError} zoom={zoom} />}
        {fixture && fixtureRouteState !== "ready" && fixtureRouteState !== "loading" ? <div className="r22-canvas-route-actions"><Link href={`${CREATE_NAV_HREF}?fixture=r22`}>Back to projects</Link>{fixtureRouteState === "error" || fixtureRouteState === "unknown" ? <Link href={`${canvasHref("fixture-raya")}&fixture=r22`}>Retry</Link> : null}</div> : null}
        {!fixture && nodesError ? <Button unstyled type="button" className="r22-canvas-live-retry" onClick={() => { setNodesLoading(true); void refreshNodes(); }}>Retry canvas</Button> : null}
        {fixtureJob ? <div className={`r22-canvas-job is-${fixtureJob.status}`} role="status"><span>{fixtureJob.status}</span><b>{fixtureJob.prompt}</b><small>Receipt {fixtureJob.id} · {fixtureJob.status === "completed" ? "fixture result saved" : fixtureJob.status === "failed" ? "0 cr · no confirmed job" : "same local action"}</small></div> : null}

        <aside
          className={`r22-canvas-otto${ottoOpen ? "" : " is-collapsed"}`}
          data-r22-canvas-otto
        >
          <Button unstyled type="button" className="r22-canvas-otto-head" aria-expanded={ottoOpen} onClick={() => setOttoOpen((open) => !open)}>
            <OttoMark />
            <b>Otto</b>
            <span>{fixture && fixtureRouteState !== "ready" ? "unavailable" : pendingQuestion ? "needs input" : fixtureJob?.status === "queued" || fixtureJob?.status === "running" ? "working" : fixtureJob?.status === "failed" ? "needs attention" : fixture ? "idle" : submitting || generationProgress ? "working" : costQuote && ratioOptions.length && !nodesError ? "ready" : "checking"}</span>
            <ChevronDown aria-hidden="true" />
          </Button>
          {ottoOpen && (
            <div className="r22-canvas-otto-body">
              {fixture && fixtureRouteState !== "ready" ? <p>Project access must be restored before Otto can read or run anything.</p> : pendingQuestion ? <><p>Paused — I need {pendingQuestion.flow.questions.length} decisions before I continue.</p><ul><li><span className="is-done"><Check aria-hidden="true" /></span>Checked the project brief and Otto IQ</li><li><span>?</span>Waiting for your answer</li></ul></> : fixtureJob ? <><p>{fixtureJob.status === "completed" ? "The fixture job completed once." : fixtureJob.status === "failed" ? "The request did not produce a confirmed job." : "The fixture job is progressing from one local receipt."}</p><ul><li><span className={fixtureJob.status !== "failed" ? "is-done" : ""}>{fixtureJob.status !== "failed" ? <Check aria-hidden="true" /> : "!"}</span>{fixtureJob.status === "failed" ? "No charge or provider success recorded" : `Receipt ${fixtureJob.id}`}</li></ul></> : fixture ? (
                <>
                  <p>All 4 images are done. Star the keepers, or ask for variants.</p>
                  <ul>
                    <li><span className="is-done"><Check aria-hidden="true" /></span>Reading your brand memory</li>
                    <li><span className="is-done"><Check aria-hidden="true" /></span>Image 1 &amp; 2 ready</li>
                    <li><span className="is-done"><Check aria-hidden="true" /></span>Image 3 &amp; 4 ready</li>
                  </ul>
                </>
              ) : (
                <p>{submitting || generationProgress
                  ? "The generation job is running from this project's durable action receipt."
                  : costQuote && ratioOptions.length && !nodesError
                    ? "Otto is ready. The exact price and model availability were checked before this paid action can start."
                    : "Checking this project's canvas, model availability, and exact price. No paid action can start yet."}</p>
              )}
            </div>
          )}
        </aside>

        {pendingQuestion && currentQuestion ? <Card className="r22-canvas-input-card" role="region" aria-labelledby="r22CanvasInputTitle">
          <div className="r22-canvas-input-kicker"><i /><span>{currentQuestion.header} · {currentQuestion.required ? "Required" : "Optional"}</span><em>{pendingQuestion.index + 1} of {pendingQuestion.flow.questions.length}</em></div>
          <h3 id="r22CanvasInputTitle">{currentQuestion.question}</h3>
          <p>{currentQuestion.help}</p>
          {currentQuestion.multi ? <div className="r22-canvas-input-options" role="group" aria-label={currentQuestion.question}>{currentQuestion.options.map((option) => { const selected = pendingQuestion.selected.includes(option.label); return <label className={selected ? "is-selected" : ""} key={option.label}><Checkbox unstyled checked={selected} onCheckedChange={() => toggleQuestionOption(option.label)} /><span><b>{option.label}{option.recommended ? <em>Recommended</em> : null}</b><small>{option.description}</small></span></label>; })}</div> : <RadioGroup unstyled className="r22-canvas-input-options" aria-label={currentQuestion.question} value={pendingQuestion.selected[0] ?? ""} onValueChange={toggleQuestionOption}>{currentQuestion.options.map((option) => { const selected = pendingQuestion.selected.includes(option.label); return <label className={selected ? "is-selected" : ""} key={option.label}><RadioGroupItem unstyled value={option.label} /><span><b>{option.label}{option.recommended ? <em>Recommended</em> : null}</b><small>{option.description}</small></span></label>; })}</RadioGroup>}
          <Input unstyled className="r22-canvas-input-other" value={otherAnswer} onChange={(event) => { setOtherAnswer(event.target.value); if (!currentQuestion.multi) setPendingQuestion((current) => current ? { ...current, selected: [] } : current); }} placeholder="Something else…" aria-label="Other answer" />
          <footer><span>Paused · 0 cr now · up to {pendingQuestion.flow.cost} cr after review</span><Button unstyled type="button" onClick={cancelQuestion}>Cancel task</Button><Button unstyled type="button" className="is-primary" disabled={!currentAnswer} onClick={continueQuestion}>{pendingQuestion.index < pendingQuestion.flow.questions.length - 1 ? "Next" : "Continue task"}</Button></footer>
        </Card> : null}

        <aside
          className={`r22-canvas-conversation${conversationOpen ? "" : " is-collapsed"}${historyExpanded ? " is-expanded" : ""}`}
          data-r22-canvas-conversation
        >
          <div className="r22-canvas-conversation-head"><Button unstyled type="button" aria-expanded={conversationOpen} onClick={() => setConversationOpen((open) => !open)}>Conversation <span>· {fixture ? fixtureRouteState === "ready" ? 1 + fixtureMessages.length + (decisionRecord ? 1 : 0) + (fixtureJob ? 1 : 0) : 0 : runtimeContext.threads.length}</span>{pendingQuestion ? <em>Waiting</em> : null}<ChevronDown aria-hidden="true" /></Button>{conversationOpen ? <Button unstyled type="button" aria-label={historyExpanded ? "Close full conversation" : "Expand conversation"} onClick={() => setHistoryExpanded((open) => !open)}>{historyExpanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}</Button> : null}</div>
          {conversationOpen && (
            <ul className="r22-canvas-conversation-list">
              {fixture && fixtureRouteState !== "ready" ? <li className="from-otto">Project conversation is unavailable until access is restored.</li> : fixture ? (
                <>
                  <li className="from-otto">Project brief loaded. Ask me what to create.</li>
                  {fixtureMessages.map((item, index) => <li className="from-me" key={`${item}:${index}`}>{item}</li>)}
                  {fixtureJob ? <li className="from-otto">Generation {fixtureJob.status} · {fixtureJob.status === "failed" ? "no credits used" : fixtureJob.id}</li> : null}
                  {decisionRecord ? <li key="fixture-decision" className={`r22-canvas-decision is-${decisionRecord.status}${decisionOpen ? " is-open" : ""}`}><Button unstyled type="button" onClick={() => setDecisionOpen((open) => !open)}><span>Decision</span><em>{decisionRecord.status === "waiting" ? "Waiting" : decisionRecord.status === "answered" ? "Answered" : "Cancelled"}</em></Button><b>{decisionRecord.title}</b>{decisionOpen ? <div className="r22-canvas-decision-detail"><p><strong>Why Otto paused</strong><br />{decisionRecord.detail}</p><ol>{decisionRecord.events.map((event, index) => <li key={`${event.kind}:${index}`}><span>{event.label}</span><small>{event.detail}</small></li>)}</ol></div> : null}</li> : null}
                </>
              ) : (
                runtimeContext.threads.length ? runtimeContext.threads.map((thread) => <li className={thread.id === runtimeContext.activeThreadId ? "from-otto is-active" : "from-otto"} key={thread.id}><Link href={threadHref(thread.id)}>{thread.title}</Link></li>) : <li className="from-otto">No project conversation exists yet. Use the composer to create the first durable canvas action.</li>
              )}
            </ul>
          )}
        </aside>

        <form
          className="r22-canvas-composer"
          data-r22-canvas-composer
          onSubmit={(event) => {
            event.preventDefault();
            void submitMessage();
          }}
        >
          <Textarea unstyled
            rows={1}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void submitMessage();
              }
            }}
            placeholder="Ask Otto, or describe what to make…"
            aria-label="Describe what to make"
          />
          <div className="r22-canvas-composer-row">
            <Button unstyled type="button" className="r22-canvas-plus" aria-label="Attach" aria-expanded={attachOpen} onClick={() => setAttachOpen((open) => !open)}>
              <Plus aria-hidden="true" />
            </Button>
            {attachOpen && (
              <div className="r22-canvas-popover r22-canvas-attach-menu">
                <Button unstyled type="button" onClick={() => setNotice(`Library references available: ${entities.length}`)}>From Library</Button>
                <Button unstyled type="button" onClick={() => setNotice("Upload is not connected yet.")}>Upload a file</Button>
                <Button unstyled type="button" onClick={() => setNotice("Link attachment is not connected yet.")}>Paste a link</Button>
              </div>
            )}
            <span />
            <Button unstyled type="button" className="r22-canvas-ratio" aria-expanded={ratioOpen} onClick={() => setRatioOpen((open) => !open)}>{ratio}</Button>
            {ratioOpen && ratioOptions.length > 0 && (
              <div className="r22-canvas-popover r22-canvas-ratio-menu">
                {ratioOptions.map((value) => (
                  <Button unstyled type="button" key={value} onClick={() => { setRatio(value); setRatioOpen(false); }}>{value}</Button>
                ))}
              </div>
            )}
            <span className="r22-canvas-price">{fixture ? "3 cr" : costQuote ? `${costQuote.imageCredits} cr` : "Checking cost…"}</span>
            <Button unstyled type="submit" className="r22-canvas-send" aria-label="Send" disabled={submitting || (fixture && fixtureRouteState !== "ready") || (!fixture && (!costQuote || !ratioOptions.length))}>
              <ArrowUp aria-hidden="true" />
            </Button>
          </div>
        </form>

        <div className="r22-canvas-tools" data-r22-canvas-tools role="toolbar" aria-label="Canvas tools">
          {TOOL_BUTTONS.map(({ id, label, icon: Icon }) => (
            <Button unstyled type="button" key={id} className={tool === id ? "is-active" : ""} aria-label={label} aria-pressed={tool === id} onClick={() => setTool(id)}>
              <Icon aria-hidden="true" />
            </Button>
          ))}
        </div>

        <div className="r22-canvas-zoom" data-r22-canvas-zoom>
          <Button unstyled type="button" aria-label="Undo" onClick={() => setNotice("Nothing to undo.")}><Undo2 aria-hidden="true" /></Button>
          <Button unstyled type="button" aria-label="Redo" onClick={() => setNotice("Nothing to redo.")}><Redo2 aria-hidden="true" /></Button>
          <Button unstyled type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(25, value - 10))}><Minus aria-hidden="true" /></Button>
          <Button unstyled type="button" className="r22-canvas-zoom-label" aria-label="Reset zoom" onClick={() => setZoom(100)}>{zoom}%</Button>
          <Button unstyled type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(200, value + 10))}><Plus aria-hidden="true" /></Button>
        </div>

        <div className={`r22-canvas-notice${notice ? " is-visible" : ""}`} aria-live="polite"><span>{notice}</span>{fixtureJob?.status === "failed" && (fixtureSendOutcome === "error" || fixtureSendOutcome === "unknown") ? <Button unstyled type="button" disabled={submitting} onClick={retryFixtureSend}>{submitting ? "Retrying…" : fixtureSendOutcome === "unknown" ? "Check receipt" : "Retry"}</Button> : null}</div>
      </div>
    </section>
  );
}

export default R22CanvasSurface;
