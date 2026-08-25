"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectNative } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { updateWorkspaceName } from "@/lib/profile-actions";
import { addMemory } from "@/lib/memory-actions";
import { createProject } from "@/lib/actions";
import { readR22WorkspaceDirectory, renameActiveR22FixtureWorkspace, scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import "./r22-onboarding.css";

export type R22OnboardingStep = "workspace" | "brand" | "channel" | "routine" | "post";
export type R22OnboardingChannelState = "unknown" | "disconnected" | "needs_reconnect" | "transient" | "connected";
export type R22OnboardingFixtureOutcome = "success" | "error" | "permission";

const ORDER: R22OnboardingStep[] = ["workspace", "brand", "channel", "routine", "post"];
const STEP_LABEL: Record<R22OnboardingStep, string> = { workspace: "Name your workspace", brand: "Teach Otto your brand", channel: "Connect Instagram", routine: "Set up a routine", post: "Generate your first post" };
const ONBOARDING_DRAFT_KEY = "r22:onboarding:draft:v1";
const BRAND_FACT_COPY: Record<string, { label: string; value: string; source: string }> = {
  logo: { label: "Logo", value: "Wordmark, warm cream on brown", source: "/about" },
  colors: { label: "Colors", value: "Teal, gold and clay", source: "/" },
  fonts: { label: "Fonts", value: "One serif for headings, one sans for body", source: "/" },
  products: { label: "Products", value: "12 products · soy candles, wax melts", source: "/shop" },
  voice: { label: "Voice", value: "Warm, plain, never pushy", source: "/about" },
};

type OnboardingDraft = {
  version: 1;
  workspaceName: string;
  brandUrl: string;
  brandManual: boolean;
  brandPhase?: "link" | "reading" | "result" | "failure" | "manual";
  brandContext: string;
  logoLetter?: string;
  brandColors?: string[];
  brandFacts?: string[];
  channelState: R22OnboardingChannelState;
  prompt: string;
  postPhase?: "idle" | "generating" | "result" | "failure" | "approved";
  days: string[];
  postingTime: string;
  postingSlots?: string[];
  postsPerWeek?: number;
  timezone: string;
  weeklyCap: number;
  routineTopic: string;
  autoPublish: boolean;
  completedSteps?: R22OnboardingStep[];
};

function readOnboardingDraft(): OnboardingDraft | null {
  try {
    const stored = window.sessionStorage.getItem(scopedR22FixtureKey(ONBOARDING_DRAFT_KEY));
    if (!stored) return null;
    const draft = JSON.parse(stored) as OnboardingDraft;
    return draft.version === 1 ? draft : null;
  } catch {
    return null;
  }
}

function writeOnboardingDraft(draft: OnboardingDraft) {
  try { window.sessionStorage.setItem(scopedR22FixtureKey(ONBOARDING_DRAFT_KEY), JSON.stringify(draft)); } catch { /* Refresh recovery is optional when browser storage is locked. */ }
}

export function R22Onboarding({ initialStep, initialWorkspaceName, initialWorkspaceError, initialChannelState, fixture = false, fixtureOutcome = "success", fixtureInitialBlank = false }: { initialStep: R22OnboardingStep; initialWorkspaceName: string; initialWorkspaceError?: string; initialChannelState: R22OnboardingChannelState; fixture?: boolean; fixtureOutcome?: R22OnboardingFixtureOutcome; fixtureInitialBlank?: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(initialStep);
  const [workspaceName, setWorkspaceName] = useState(initialWorkspaceName);
  const [brandUrl, setBrandUrl] = useState("");
  const [brandManual, setBrandManual] = useState(false);
  const [brandPhase, setBrandPhase] = useState<"link" | "reading" | "result" | "failure" | "manual">("link");
  const [brandContext, setBrandContext] = useState("");
  const [logoLetter, setLogoLetter] = useState("");
  const [brandColors, setBrandColors] = useState<string[]>([]);
  const [brandFacts, setBrandFacts] = useState(["logo", "colors", "fonts", "products", "voice"]);
  const [brandReadFailedOnce, setBrandReadFailedOnce] = useState(false);
  const [channelState, setChannelState] = useState(initialChannelState);
  const [routineNotice, setRoutineNotice] = useState("");
  const [prompt, setPrompt] = useState("");
  const [postPhase, setPostPhase] = useState<"idle" | "generating" | "result" | "failure" | "approved">("idle");
  const [postFailedOnce, setPostFailedOnce] = useState(false);
  const postTimerRef = useRef<number | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState(["Mon", "Wed", "Fri"]);
  const [postingTime, setPostingTime] = useState("09:00");
  const [postingSlots, setPostingSlots] = useState(["09:00"]);
  const [postsPerWeek, setPostsPerWeek] = useState(3);
  const [timezone, setTimezone] = useState("Asia/Kuala_Lumpur");
  const [weeklyCap, setWeeklyCap] = useState(40);
  const [routineTopic, setRoutineTopic] = useState("");
  const [autoPublish, setAutoPublish] = useState(false);
  const [fixtureReady, setFixtureReady] = useState(!fixture);
  const [completedSteps, setCompletedSteps] = useState<R22OnboardingStep[]>([]);
  const [failedOnce, setFailedOnce] = useState<Partial<Record<R22OnboardingStep, boolean>>>({});
  const [retryAction, setRetryAction] = useState<R22OnboardingStep | null>(null);
  const index = ORDER.indexOf(step);
  useEffect(() => {
    if (!fixture) return;
    const draft = fixtureInitialBlank ? null : readOnboardingDraft();
    if (draft) {
      setWorkspaceName(draft.workspaceName);
      setBrandUrl(draft.brandUrl);
      setBrandManual(draft.brandManual);
      setBrandPhase(draft.brandPhase ?? (draft.brandManual ? "manual" : "link"));
      setBrandContext(draft.brandContext);
      setLogoLetter(draft.logoLetter ?? "");
      setBrandColors(draft.brandColors ?? []);
      setBrandFacts(draft.brandFacts ?? ["logo", "colors", "fonts", "products", "voice"]);
      setChannelState(draft.channelState);
      setPrompt(draft.prompt);
      setPostPhase(draft.postPhase ?? "idle");
      setDays(draft.days);
      setPostingTime(draft.postingTime);
      setPostingSlots(draft.postingSlots ?? [draft.postingTime]);
      setPostsPerWeek(draft.postsPerWeek ?? 3);
      setTimezone(draft.timezone);
      setWeeklyCap(draft.weeklyCap);
      setRoutineTopic(draft.routineTopic);
      setAutoPublish(draft.autoPublish);
      setCompletedSteps(draft.completedSteps ?? []);
    } else setWorkspaceName(fixtureInitialBlank ? "" : readR22WorkspaceDirectory().workspaces.find((workspace) => workspace.id === readR22WorkspaceDirectory().activeId)?.name ?? initialWorkspaceName);
    setFixtureReady(true);
  }, [fixture, fixtureInitialBlank]);

  useEffect(() => {
    if (!fixture || !fixtureReady) return;
    writeOnboardingDraft({
      version: 1,
      workspaceName,
      brandUrl,
      brandManual,
      brandPhase,
      brandContext,
      logoLetter,
      brandColors,
      brandFacts,
      channelState,
      prompt,
      postPhase,
      days,
      postingTime,
      postingSlots,
      postsPerWeek,
      timezone,
      weeklyCap,
      routineTopic,
      autoPublish,
      completedSteps,
    });
  }, [autoPublish, brandColors, brandContext, brandFacts, brandManual, brandPhase, brandUrl, channelState, completedSteps, days, fixture, fixtureReady, logoLetter, postPhase, postingSlots, postingTime, postsPerWeek, prompt, routineTopic, timezone, weeklyCap, workspaceName]);
  useEffect(() => () => { if (postTimerRef.current) window.clearTimeout(postTimerRef.current); }, []);

  function go(next: R22OnboardingStep) {
    setNotice("");
    setRoutineNotice("");
    setStep(next);
    router.push(`/onboarding?step=${next}${fixture ? `&fixture=r22${fixtureOutcome !== "success" ? `&outcome=${fixtureOutcome}` : ""}` : ""}`);
  }

  function markComplete(done: R22OnboardingStep) {
    setCompletedSteps((current) => current.includes(done) ? current : [...current, done]);
  }

  function runFixtureAction(action: R22OnboardingStep, onSuccess: () => void) {
    setBusy(true);
    setNotice("");
    setRoutineNotice("");
    window.setTimeout(() => {
      setBusy(false);
      if (fixtureOutcome === "permission") {
        const message = "Your current workspace permission does not allow this change. Nothing was saved or marked complete.";
        if (action === "routine") setRoutineNotice(message); else setNotice(message);
        setRetryAction(null);
        return;
      }
      if (fixtureOutcome === "error" && !failedOnce[action]) {
        setFailedOnce((current) => ({ ...current, [action]: true }));
        const message = "That change could not be confirmed. Nothing was saved or marked complete. Retry safely.";
        if (action === "routine") setRoutineNotice(message); else setNotice(message);
        setRetryAction(action);
        return;
      }
      setRetryAction(null);
      markComplete(action);
      onSuccess();
    }, 360);
  }

  async function saveWorkspace() {
    if (!workspaceName.trim() || busy) return setNotice("Enter a workspace name.");
    if (fixture) return runFixtureAction("workspace", () => {
      renameActiveR22FixtureWorkspace(workspaceName);
      go("brand");
    });
    setBusy(true);
    const result = await updateWorkspaceName(workspaceName);
    setBusy(false);
    if ("error" in result) return setNotice(result.error);
    setWorkspaceName(result.name);
    go("brand");
  }

  async function saveBrand() {
    if (!brandContext.trim() || busy) return setNotice("Add one clear brand fact before saving.");
    if (fixture) return runFixtureAction("brand", () => go("channel"));
    setBusy(true);
    const result = await addMemory({ category: "Brand identity", content: brandContext });
    setBusy(false);
    if ("error" in result) return setNotice(result.error);
    go("channel");
  }

  function readBrandPage() {
    if (!brandUrl.trim() || busy) return setNotice("Enter a shop link.");
    setNotice("");
    setBrandPhase("reading");
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      if (!fixture) {
        setBrandPhase("failure");
        setNotice("Website reading is not connected to the production backend. Nothing was read or saved.");
        return;
      }
      if (fixtureOutcome === "permission") {
        setBrandPhase("failure");
        setNotice("This workspace cannot read external pages. Nothing was read or saved.");
        return;
      }
      if (fixtureOutcome === "error" && !brandReadFailedOnce) {
        setBrandReadFailedOnce(true);
        setBrandPhase("failure");
        return;
      }
      setBrandFacts(["logo", "colors", "fonts", "products", "voice"]);
      setBrandPhase("result");
    }, 620);
  }

  function saveDetectedBrand() {
    if (!brandFacts.length || busy) return setNotice("Keep at least one brand fact, or add the brand by hand.");
    if (!fixture) return setNotice("Detected brand facts cannot be saved until the website-ingest backend is connected. Nothing was marked complete.");
    runFixtureAction("brand", () => go("channel"));
  }

  function openManualBrand() {
    setBrandManual(true);
    setBrandPhase("manual");
    setNotice("");
  }

  async function openCanvas() {
    if (!prompt.trim() || busy) return setNotice("Describe the first post before continuing.");
    if (fixture) {
      runFixtureAction("post", () => router.push(`/create/canvas?project=fixture-raya&fixture=r22&prompt=${encodeURIComponent(prompt.trim())}`));
      return;
    }
    setBusy(true);
    const result = await createProject(prompt.trim().slice(0, 80));
    setBusy(false);
    if ("error" in result) return setNotice(result.error);
    router.push(`/create/canvas?project=${encodeURIComponent(result.id)}&prompt=${encodeURIComponent(prompt.trim())}`);
  }

  function generateFirstPost() {
    if (!prompt.trim() || busy) return setNotice("Describe the first post before continuing.");
    setNotice("");
    setBusy(true);
    setPostPhase("generating");
    postTimerRef.current = window.setTimeout(() => {
      setBusy(false);
      postTimerRef.current = null;
      if (!fixture) {
        setPostPhase("failure");
        setNotice("First-post generation is not connected on this gate. Nothing was generated or charged; continue in Canvas to use the live generation contract.");
        return;
      }
      if (fixtureOutcome === "permission") {
        setPostPhase("failure");
        setNotice("Your workspace permission does not allow generation. Nothing was generated or charged.");
        return;
      }
      if (fixtureOutcome === "error" && !postFailedOnce) {
        setPostFailedOnce(true);
        setPostPhase("failure");
        return;
      }
      setPostPhase("result");
    }, 620);
  }

  function cancelFirstPost() {
    if (postTimerRef.current) window.clearTimeout(postTimerRef.current);
    postTimerRef.current = null;
    setBusy(false);
    setPostPhase("idle");
    setNotice("Drafting cancelled. No fixture credits were used.");
  }

  function approveFirstPost() {
    if (!fixture || busy) return;
    setPostPhase("approved");
    markComplete("post");
    setNotice("Fixture approval saved locally. No provider publish or credit ledger was called.");
  }

  function saveRoutine() {
    if (busy) return;
    const errors = [
      !days.length ? "Choose at least one routine day." : "",
      !postingSlots.length ? "Add at least one posting time." : "",
      !routineTopic.trim() ? "Describe what this routine should post about." : "",
      weeklyCap < 1 ? "Set a weekly credit cap of at least 1 cr." : "",
    ].filter(Boolean);
    if (errors.length) {
      setRoutineNotice(errors[0]!);
      return;
    }
    if (!fixture) {
      setRoutineNotice("Publishing-routine save is not connected to a matching backend contract yet. This review was not activated, saved, or charged.");
      return;
    }
    setRoutineNotice("");
    runFixtureAction("routine", () => go("post"));
  }

  function previewChannelConnection() {
    if (busy) return;
    runFixtureAction("channel", () => setChannelState("connected"));
  }

  const top = (
    <div className="r22-ob-top">
      <Button unstyled type="button" disabled={index === 0} onClick={() => go(ORDER[index - 1]!)}>Back</Button>
      <span>Step {index + 1} of 5{step === "routine" ? " · optional" : ""}{fixture && completedSteps.length ? ` · ${completedSteps.length} complete` : ""}</span>
      {index > 0 ? <Button unstyled type="button" onClick={() => step === "post" ? router.push(fixture ? "/?fixture=r22" : "/") : go(ORDER[Math.min(index + 1, 4)]!)}>Skip for now</Button> : <em>Required</em>}
    </div>
  );

  return (
    <main className="r22-ob-gate" data-step={step}>
      <div className="r22-ob-stage">
        <section className="r22-ob-form">
          <div className="r22-ob-progress"><span style={{ width: `${(index + 1) * 20}%` }} /></div>
          {top}
          <h1>{STEP_LABEL[step]}</h1>

          {step === "workspace" ? <>
            <p className="r22-ob-sub">A workspace holds one brand — its memory, its channels, and everything it publishes. You can rename it later.</p>
            {initialWorkspaceError ? <p className="r22-ob-error" role="alert">Workspace details could not be read: {initialWorkspaceError}. Reload before treating this workspace as unnamed.</p> : null}
            <label>Workspace name<Input unstyled autoFocus maxLength={80} value={workspaceName} onChange={(event) => { setWorkspaceName(event.target.value); setNotice(""); }} placeholder="Mei's Candles" disabled={!!initialWorkspaceError} /></label>
            <div className="r22-ob-note"><b>Otto works for one brand at a time</b><span>Whatever you teach it here never leaks into another workspace.</span></div>
            <Button unstyled className="r22-ob-primary" type="button" onClick={() => void saveWorkspace()} disabled={busy || !!initialWorkspaceError}>{busy ? "Saving…" : "Continue"}</Button>
          </> : null}

          {step === "brand" ? <>
            <p className="r22-ob-sub">Paste your shop link and Otto reads the public pages. No link is fine — you can add the same facts by hand.</p>
            {brandPhase === "link" ? <>
              <label>Shop link<Input unstyled autoFocus type="url" value={brandUrl} onChange={(event) => { setBrandUrl(event.target.value); setNotice(""); }} placeholder="yourshop.com" /></label>
              <p className="r22-ob-fine">We only read the public pages of your shop.</p>
              <div className="r22-ob-actions"><Button unstyled className="r22-ob-primary" type="button" disabled={!brandUrl.trim() || busy} onClick={readBrandPage}>Read my shop <span className="r22-ob-free">free</span></Button><Button unstyled className="r22-ob-secondary" type="button" onClick={openManualBrand}>Add it by hand</Button></div>
            </> : brandPhase === "reading" ? <div className="r22-ob-reading" aria-live="polite"><div><span className="r22-ob-spinner" /><b>Otto is reading {brandUrl.replace(/^https?:\/\//, "").split("/")[0] || "yourshop.com"}</b></div><ul>{["Logo","Colors","Fonts","Products","Voice"].map((item) => <li key={item}><i /><span>{item}</span><em>waiting</em></li>)}</ul><p className="r22-ob-fine">Reading is free. Nothing is saved until you say so.</p></div> : brandPhase === "result" ? <div className="r22-ob-result"><div className="r22-ob-result-head"><b>Otto read your shop</b><span>{brandFacts.length} facts found</span></div>{brandFacts.length ? <ul>{brandFacts.map((fact) => { const item = BRAND_FACT_COPY[fact]!; return <li key={fact}><b>{item.label}</b><span>{item.value}</span><em>{item.source}</em><Button unstyled type="button" aria-label={`Remove ${item.label.toLowerCase()}`} onClick={() => setBrandFacts((current) => current.filter((value) => value !== fact))}>Remove</Button></li>; })}</ul> : <p className="r22-ob-fine">You removed everything Otto found. Add the brand by hand instead, or read another page.</p>}<div className="r22-ob-actions"><Button unstyled className="r22-ob-primary" type="button" disabled={busy || !brandFacts.length} onClick={saveDetectedBrand}>{busy ? "Saving…" : "Save to brand memory"}</Button><Button unstyled className="r22-ob-secondary" type="button" onClick={openManualBrand}>Let me edit first</Button></div></div> : brandPhase === "failure" ? <div className="r22-ob-failure" role="alert"><b>We couldn’t read enough from that page</b><p>{notice || "The page loaded but there was no logo, no colour, and no product text on it. Adding the brand by hand takes about two minutes."}</p><div className="r22-ob-actions"><Button unstyled className="r22-ob-primary" type="button" onClick={() => { setBrandPhase("link"); setNotice(""); }}>Try another link</Button><Button unstyled className="r22-ob-secondary" type="button" onClick={openManualBrand}>Add it by hand</Button><Button unstyled className="r22-ob-secondary" type="button" onClick={() => go("channel")}>Start from blank</Button></div></div> : <>
              <div className="r22-ob-manual-head"><b>Add your brand by hand</b><Button unstyled type="button" onClick={() => { setBrandManual(false); setBrandPhase("link"); }}>Use a link instead</Button></div>
              <label>Logo letter<div className="r22-ob-logo-row"><span>{logoLetter.trim().slice(0,2).toUpperCase() || "?"}</span><Input unstyled autoFocus maxLength={2} value={logoLetter} onChange={(event) => setLogoLetter(event.target.value)} placeholder="MC" aria-label="Logo letter" /><small>Upload a real logo file once you are inside the app.</small></div></label>
              <span className="r22-ob-label">Brand colours</span>
              <ToggleGroup unstyled type="multiple" className="r22-ob-swatches" value={brandColors} onValueChange={setBrandColors} aria-label="Brand colours">{["Teal","Gold","Clay","Cream","Ink"].map((color) => <ToggleGroupItem unstyled key={color} value={color}><i className={`is-${color.toLowerCase()}`} />{color}</ToggleGroupItem>)}</ToggleGroup>
              <label>How your brand sounds, in one line<Input unstyled maxLength={120} value={brandContext} onChange={(event) => { setBrandContext(event.target.value); setNotice(""); }} placeholder="Warm and plain — never pushy, never shouty." /><small>{brandContext.length} / 120 · One line is enough. Otto reads it before every draft.</small></label>
              <Button unstyled className="r22-ob-primary" type="button" onClick={() => void saveBrand()} disabled={busy}>{busy ? "Saving…" : "Save to brand memory"}</Button>
            </>}
          </> : null}

          {step === "channel" ? <>
            <p className="r22-ob-sub">Approved posts go out on schedule once a channel is connected. Until then everything you make simply waits.</p>
            <ul className="r22-ob-perms"><li><span>Read your profile and media</span><em>required</em></li><li><span>Read and reply to comments</span><em>optional</em></li><li><span>Publish posts you approved</span><em>optional</em></li></ul>
            {channelState === "connected" || channelState === "transient" ? <div className="r22-ob-success"><Check aria-hidden="true" /><div><b>Instagram · Connected</b><p>{fixture ? "Granted in this visual fixture: read your profile and media, publish posts you approved. No provider authorization or connection was saved." : channelState === "transient" ? "The saved connection remains connected, but Instagram could not be reached for a fresh capability check." : "Granted: read your profile and media, publish posts you approved. Comments were not granted."}</p></div></div> : null}
            {channelState === "unknown" ? <p className="r22-ob-error" role="alert">Connection status could not be read. No disconnected state was inferred.</p> : null}
            {channelState === "disconnected" || channelState === "needs_reconnect" ? <><p className="r22-ob-fine">Instagram decides what it hands over. If publishing is turned off, FIKIRTIVE can only remind you to post by hand.</p>{fixture ? <Button unstyled type="button" className="r22-ob-primary" disabled={busy} onClick={previewChannelConnection}>{busy ? "Connecting Instagram…" : channelState === "needs_reconnect" ? "Reconnect Instagram" : "Connect Instagram"}</Button> : <a className="r22-ob-primary" href="/api/meta/authorize">{channelState === "needs_reconnect" ? "Reconnect Instagram" : "Connect Instagram"}</a>}</> : null}
            {channelState === "connected" || channelState === "transient" ? <Button unstyled className="r22-ob-primary" type="button" onClick={() => go("routine")}>Continue</Button> : null}
          </> : null}

          {step === "routine" ? <>
            <p className="r22-ob-sub">Otto only works inside a routine. Without one it never generates and never spends a credit — you would drive everything by hand.</p>
            <span className="r22-ob-label">Days</span>
            <ToggleGroup unstyled type="multiple" className="r22-ob-days" value={days} onValueChange={setDays} aria-label="Routine days">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day) => <ToggleGroupItem unstyled key={day} value={day} className={days.includes(day) ? "is-on" : ""}>{day}</ToggleGroupItem>)}</ToggleGroup>
            <span className="r22-ob-label">Posting times</span>
            <div className="r22-ob-time-row"><small>Add a time at</small><SelectNative unstyled aria-label="Hour" value={postingTime.slice(0,2)} onChange={(event) => setPostingTime(`${event.target.value}:${postingTime.slice(3)}`)}>{["08","09","10","11","12","13","17","19","20"].map((hour) => <option key={hour}>{hour}</option>)}</SelectNative><span>:</span><SelectNative unstyled aria-label="Minute" value={postingTime.slice(3)} onChange={(event) => setPostingTime(`${postingTime.slice(0,2)}:${event.target.value}`)}>{["00","15","30","45"].map((minute) => <option key={minute}>{minute}</option>)}</SelectNative><Button unstyled className="r22-ob-secondary" type="button" onClick={() => setPostingSlots((current) => current.includes(postingTime) ? current : [...current, postingTime].sort())}>Add time</Button><Button unstyled className="r22-ob-link" type="button" onClick={() => setPostingSlots([])}>Clear all times</Button></div>
            <div className="r22-ob-slot-chips">{postingSlots.map((slot) => <Button unstyled type="button" key={slot} onClick={() => setPostingSlots((current) => current.filter((value) => value !== slot))}>{slot} ×</Button>)}</div>
            {!postingSlots.length ? <p className="r22-ob-fine">No time yet. A routine with no posting time never runs, so add at least one.</p> : null}
            <div className="r22-ob-steppers"><div><span className="r22-ob-label">Posts a week</span><div><Button unstyled type="button" aria-label="One fewer post a week" onClick={() => setPostsPerWeek((value) => Math.max(1, value - 1))}>−</Button><b>{postsPerWeek}</b><Button unstyled type="button" aria-label="One more post a week" onClick={() => setPostsPerWeek((value) => Math.min(14, value + 1))}>+</Button></div></div><div><span className="r22-ob-label">Credits it may spend in a week</span><div><Button unstyled type="button" aria-label="Lower the weekly cap" onClick={() => setWeeklyCap((value) => Math.max(0, value - 5))}>−</Button><b>{weeklyCap} cr</b><Button unstyled type="button" aria-label="Raise the weekly cap" onClick={() => setWeeklyCap((value) => value + 5)}>+</Button></div></div></div>
            <p className="r22-ob-fine">Otto stops for the week the moment spending reaches the cap. Otto never asks for more.</p>
            <label>What it posts about<Input unstyled value={routineTopic} onChange={(event) => setRoutineTopic(event.target.value)} placeholder="Candle care tips and new scents" /></label>
            <div className="r22-ob-switch-row"><span><b>Auto-publish</b><small>{autoPublish ? "On — only where the live publishing capability permits it." : "Off — finished posts wait in Needs review until you approve them."}</small></span><Switch unstyled className="r22-ob-switch" thumbClassName="r22-ob-switch-thumb" checked={autoPublish} onCheckedChange={setAutoPublish} aria-label="Auto-publish" /></div>
            <Button unstyled className="r22-ob-primary" type="button" disabled={busy} onClick={saveRoutine}>{busy ? "Saving routine…" : "Save routine"}</Button>
            {routineNotice ? <p className="r22-ob-error" role="alert">{routineNotice}</p> : null}
          </> : null}

          {step === "post" ? <>
            <p className="r22-ob-sub">You ask, Otto drafts. Nothing is published from here — you decide what happens to it.</p>
            {postPhase === "idle" ? <><label>What should it be about<Input unstyled autoFocus maxLength={140} value={prompt} onChange={(event) => { setPrompt(event.target.value); setNotice(""); }} placeholder="A candle care tip for the new pandan scent" /></label><div className="r22-ob-starters">{["New scent just landed — soft pandan and coconut", "Raya gift sets, wrapped and ready", "We’re at the Sunday market this weekend"].map((starter, i) => <Button unstyled type="button" key={starter} onClick={() => setPrompt(starter)}>{["New arrival", "Festive promo", "In-store event"][i]}</Button>)}</div><Button unstyled className="r22-ob-primary" type="button" onClick={generateFirstPost} disabled={busy}>Generate post <span className="r22-ob-free">3 cr</span></Button></> : postPhase === "generating" ? <div className="r22-ob-reading" aria-live="polite"><div><span className="r22-ob-spinner" /><b>Otto is drafting your first post</b></div><p className="r22-ob-fine">One image and one caption. You can cancel and keep the 3 cr.</p><Button unstyled className="r22-ob-secondary" type="button" onClick={cancelFirstPost}>Cancel</Button></div> : postPhase === "result" || postPhase === "approved" ? <div className="r22-ob-approval"><div><b>First post · Instagram</b><span>3 cr spent · fixture only</span></div><p>Draft ready. Approving schedules it for its next slot — nothing will ask you a second time.</p>{postPhase === "result" ? <footer><Button unstyled className="r22-ob-primary" type="button" onClick={approveFirstPost}>Approve</Button><Button unstyled className="r22-ob-secondary" type="button" onClick={() => { setPostPhase("idle"); setNotice("Fixture draft skipped. Nothing was published."); }}>Skip</Button></footer> : <><p className="r22-ob-approved">Approved in this fixture · no provider publish was called.</p><Button unstyled className="r22-ob-primary" type="button" onClick={() => router.push("/?fixture=r22")}>Go to Home</Button></>}</div> : <div className="r22-ob-failure" role="alert"><b>The image didn’t come back</b><p>{notice || "The provider timed out before it sent anything back. Nothing was charged — the 3 cr never left your balance."}</p><div className="r22-ob-actions"><Button unstyled className="r22-ob-primary" type="button" onClick={generateFirstPost}>Try again</Button>{!fixture ? <Button unstyled className="r22-ob-secondary" type="button" onClick={() => void openCanvas()}>Continue in Canvas</Button> : null}<Button unstyled className="r22-ob-secondary" type="button" onClick={() => router.push(fixture ? "/?fixture=r22" : "/")}>Skip for now</Button></div></div>}
            <p className="r22-ob-honesty">No production success is shown without a confirmed generation receipt and exact credit settlement.</p>
          </> : null}

          <p className="r22-ob-error" role="alert" aria-live="polite">{notice}</p>
          {retryAction && retryAction !== "routine" ? <Button unstyled className="r22-ob-link" type="button" onClick={() => {
            if (retryAction === "workspace") void saveWorkspace();
            else if (retryAction === "brand") void saveBrand();
            else if (retryAction === "channel") previewChannelConnection();
            else if (retryAction === "post") void openCanvas();
          }}>Retry</Button> : null}
          {retryAction === "routine" ? <Button unstyled className="r22-ob-link" type="button" onClick={saveRoutine}>Retry</Button> : null}
        </section>

        <aside className="r22-ob-side" aria-label={step === "workspace" || step === "post" ? "Preview" : "Step preview"}>
          {step === "workspace" ? <div className="r22-ob-preview"><div className="r22-ob-preview-head">Preview</div><div className="r22-ob-preview-tile"><div><span>{(workspaceName.trim() || "?").slice(0,2).toUpperCase()}</span><b>{workspaceName.trim() || "Your workspace"}</b></div></div><p>Your workspace badge appears here once you give it a name. It sits at the top of every screen so you always know which brand you are working in.</p></div> : null}
          {step === "brand" ? <><div className="r22-ob-memory"><b>What Otto reads first</b><p>{brandContext || brandPhase === "result" ? "Logo, colours, products and a warm, plain voice — each with its page source." : "Nothing yet. Whatever you save here is the first thing Otto reads before it drafts anything."}</p><small>Working in {workspaceName.trim() || "your workspace"}</small></div><p className="r22-ob-side-note">Every saved fact keeps the page it came from, so you can always ask where a claim came from.</p></> : null}
          {step === "channel" ? <><div className="r22-ob-sky"><b>Nothing goes out on its own</b><p>Connecting only opens the door. A post leaves this app when you approve it, or when a routine you set up says so.</p></div><p className="r22-ob-side-note">{channelState === "connected" ? "Instagram is connected for this fixture preview only." : "No channel is connected yet, so anything you make will sit in Needs review until you connect one."}</p></> : null}
          {step === "routine" ? <><div className="r22-ob-timeline"><b>What happens next</b><ol><li><b>At each slot</b><span>Otto drafts one post on your topic, inside the weekly cap.</span></li><li><b>Then</b><span>It lands in Needs review and waits for you.</span></li><li><b>When you approve</b><span>It is scheduled. Approving is the scheduling — nothing asks you twice.</span></li></ol></div><div className="r22-ob-sky"><b>If you don’t get to it in time</b><p>A post still unapproved when its slot arrives is skipped, not published. We remind you two hours before.</p></div></> : null}
          {step === "post" ? <><div className="r22-ob-preview"><div className="r22-ob-preview-head">Preview</div><div className="r22-ob-post-preview">{postPhase === "result" || postPhase === "approved" ? <Image src="/fixtures/r22-canvas/art-1.jpg" fill sizes="296px" alt="Fixture first post preview" /> : <b>{postPhase === "generating" ? "Drafting…" : "Nothing drafted yet"}</b>}</div><p>{postPhase === "result" || postPhase === "approved" ? prompt : "Nothing drafted yet. What Otto makes shows up here before it goes anywhere."}</p></div><p className="r22-ob-side-note">Otto will not make anything else unless you ask. Set up a routine if you want Otto to keep going.</p></> : null}
        </aside>
      </div>
    </main>
  );
}

export default R22Onboarding;
