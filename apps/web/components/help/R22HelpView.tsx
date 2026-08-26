"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures restore browser-scoped drafts after hydration. */
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

import Link from "next/link";
import { ArrowLeft, BookOpen, CheckCircle2, CircleAlert, Clock3, ExternalLink, LifeBuoy, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { supportMailto } from "@/lib/exits";
import { scopedR22FixtureKey } from "@/components/r22/r22-workspace-fixture";
import "./r22-help.css";

type HelpArticle = { id: string; title: string; summary: string; category: string };
type HelpState = "ready" | "loading" | "error" | "permission" | "unknown" | "unavailable";
type SupportPhase = "draft" | "review" | "submitting" | "error" | "unknown" | "queued" | "waiting" | "closed";
type SupportOutcome = "success" | "error" | "unknown";
const FIXTURE_STATE_KEY = "fikirtive.r22.help.state.v1";

const FIXTURE_ARTICLES: HelpArticle[] = [
  { id: "canvas", title: "Create and return to a Canvas project", summary: "Start a project, generate media and return to the same project from Library.", category: "Canvas" },
  { id: "approval", title: "Review work before it publishes", summary: "Understand approval decisions and what remains scheduled.", category: "Publishing" },
  { id: "connection", title: "Reconnect a publishing channel", summary: "Check Meta access and reconnect without changing unrelated workspace settings.", category: "Connections" },
];

export function R22HelpView({ fixture = false, state = fixture ? "ready" : "unavailable", initialArticleId, supportOutcome = "success", initialSupportPhase }: { fixture?: boolean; state?: HelpState; initialArticleId?: string; supportOutcome?: SupportOutcome; initialSupportPhase?: Exclude<SupportPhase, "draft" | "submitting" | "error" | "unknown"> }) {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(() => FIXTURE_ARTICLES.find((article) => article.id === initialArticleId) ?? null);
  const [includeRoute, setIncludeRoute] = useState(false);
  const [includeWorkspace, setIncludeWorkspace] = useState(false);
  const [supportSubject, setSupportSubject] = useState(initialSupportPhase ? "Publishing approval did not update" : "");
  const [supportMessage, setSupportMessage] = useState(initialSupportPhase ? "The approved post is still shown as waiting in Schedule." : "");
  const [supportPhase, setSupportPhase] = useState<SupportPhase>(initialSupportPhase ?? "draft");
  const [supportError, setSupportError] = useState("");
  const [supportFailedOnce, setSupportFailedOnce] = useState(false);
  const [supportActionId] = useState("fixture-support-1");
  const [restored, setRestored] = useState(!fixture);
  const visible = useMemo(() => {
    const articles = fixture && state === "ready" ? FIXTURE_ARTICLES : [];
    const term = query.trim().toLowerCase();
    return term ? articles.filter((article) => `${article.title} ${article.summary} ${article.category}`.toLowerCase().includes(term)) : articles;
  }, [fixture, query, state]);
  const context = [includeRoute ? `Page: ${pathname}` : "", includeWorkspace ? "Please include my current workspace." : ""].filter(Boolean).join("\n");
  const mailto = `${supportMailto("Fikirtive support request")}${context ? `&body=${encodeURIComponent(`I need help with:\n\n${context}`)}` : ""}`;

  useEffect(() => {
    if (!fixture) return;
    try {
      const raw = window.sessionStorage.getItem(scopedR22FixtureKey(FIXTURE_STATE_KEY));
      if (raw) {
        const saved = JSON.parse(raw) as { query?: string; includeRoute?: boolean; includeWorkspace?: boolean; supportSubject?: string; supportMessage?: string; supportPhase?: SupportPhase };
        if (typeof saved.query === "string") setQuery(saved.query);
        if (typeof saved.includeRoute === "boolean") setIncludeRoute(saved.includeRoute);
        if (typeof saved.includeWorkspace === "boolean") setIncludeWorkspace(saved.includeWorkspace);
        if (initialSupportPhase) {
          setSupportSubject("Publishing approval did not update");
          setSupportMessage("The approved post is still shown as waiting in Schedule.");
          setSupportPhase(initialSupportPhase);
        } else {
          if (typeof saved.supportSubject === "string") setSupportSubject(saved.supportSubject);
          if (typeof saved.supportMessage === "string") setSupportMessage(saved.supportMessage);
          if (["draft", "review", "error", "unknown", "queued", "waiting", "closed"].includes(saved.supportPhase ?? "")) setSupportPhase(saved.supportPhase!);
        }
      }
    } catch {
      // Ignore malformed fixture-only recovery data.
    }
    setRestored(true);
  }, [fixture, initialSupportPhase]);

  useEffect(() => {
    if (!fixture || !restored) return;
    try {
      window.sessionStorage.setItem(scopedR22FixtureKey(FIXTURE_STATE_KEY), JSON.stringify({ query, includeRoute, includeWorkspace, supportSubject, supportMessage, supportPhase }));
    } catch {
      // A blocked storage API must not break Help.
    }
  }, [fixture, restored, query, includeRoute, includeWorkspace, supportMessage, supportPhase, supportSubject]);

  function reviewSupportRequest() {
    if (!supportSubject.trim()) return setSupportError("Add a short subject.");
    if (supportMessage.trim().length < 20) return setSupportError("Add at least 20 characters so support can understand the problem.");
    setSupportError("");
    setSupportPhase("review");
  }

  function submitSupportRequest() {
    if (!fixture || supportPhase === "submitting") return;
    setSupportError("");
    setSupportPhase("submitting");
    window.setTimeout(() => {
      if (supportOutcome === "error" && !supportFailedOnce) {
        setSupportFailedOnce(true);
        setSupportPhase("error");
        return;
      }
      if (supportOutcome === "unknown" && !supportFailedOnce) {
        setSupportFailedOnce(true);
        setSupportPhase("unknown");
        return;
      }
      setSupportPhase("queued");
    }, 420);
  }

  function checkSupportStatus() {
    setSupportPhase((current) => current === "queued" ? "waiting" : current === "waiting" ? "closed" : "queued");
  }

  function openArticle(article: HelpArticle) {
    setSelectedArticle(article);
    if (fixture) router.replace(`/help?fixture=r22&article=${encodeURIComponent(article.id)}`, { scroll: false });
  }

  function closeArticle() {
    setSelectedArticle(null);
    if (fixture) router.replace("/help?fixture=r22", { scroll: false });
  }

  return <main className="r22-help" data-r22-help data-fixture={fixture || undefined}>
    <header><p>Support</p><h1>How can we help?</h1><span>Find a verified answer or prepare a request for a person.</span></header>
    <label className="r22-help-search"><Search aria-hidden="true" /><Input unstyled value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product help" disabled={!fixture || state !== "ready"} /><kbd>⌘K</kbd></label>
    <div className="r22-help-grid">
      <section className="r22-help-articles" aria-labelledby="help-articles-heading">
        <div className="r22-help-heading"><BookOpen aria-hidden="true" /><div><h2 id="help-articles-heading">Product help</h2><p>Task guidance tied to the current product.</p></div></div>
        {state !== "ready" ? <div className="r22-help-unavailable" role={state === "error" ? "alert" : "status"}><b>{state === "loading" ? "Loading help…" : state === "error" ? "Product help could not be loaded" : state === "permission" ? "Product help is not available to this member" : state === "unknown" ? "We could not tell whether help loaded" : "Help articles are not switched on yet"}</b><p>{state === "loading" ? "Nothing is guessed while this loads." : state === "error" ? "The help articles could not be read. No policy page was shown in their place." : state === "permission" ? "Ask an admin in this workspace for access, or contact support below without attaching your workspace." : state === "unknown" ? "It may still finish. Nothing is guessed in its place — try again." : "Fikirtive will not pass policy pages off as help. Contact support below while real help articles are being connected."}</p>{state === "error" || state === "unknown" ? <Link href={fixture ? "/help?fixture=r22" : "/help"}>Retry</Link> : null}</div> : selectedArticle ? <article className="r22-help-article-detail"><Button unstyled type="button" onClick={closeArticle}><ArrowLeft data-icon="inline-start" aria-hidden="true" /> Back to results</Button><small>{selectedArticle.category}</small><h3>{selectedArticle.title}</h3><p>{selectedArticle.summary}</p><p>This is a sample article for this preview. Real help articles are not switched on yet.</p></article> : visible.length ? <ul>{visible.map((article) => <li key={article.id}><Button unstyled type="button" onClick={() => openArticle(article)}><small>{article.category}</small><b>{article.title}</b><span>{article.summary}</span></Button></li>)}</ul> : <div className="r22-help-unavailable"><b>No matching article</b><p>Try a broader task name or contact support.</p></div>}
      </section>
      <section className="r22-help-contact" aria-labelledby="help-contact-heading">
        <div className="r22-help-heading"><LifeBuoy aria-hidden="true" /><div><h2 id="help-contact-heading">Contact support</h2><p>{fixture ? "Review every field and status before anything leaves Fikirtive." : "Review what leaves Fikirtive before opening your email app."}</p></div></div>
        {fixture ? <>
          {supportPhase === "draft" ? <div className="r22-help-support-form">
            <label>Subject<Input unstyled value={supportSubject} onChange={(event) => { setSupportSubject(event.target.value); setSupportError(""); }} placeholder="What do you need help with?" /></label>
            <label>What happened?<Textarea unstyled value={supportMessage} onChange={(event) => { setSupportMessage(event.target.value); setSupportError(""); }} placeholder="Tell support what you expected and what happened instead." /></label>
            <fieldset><legend>Optional context</legend><label><Checkbox checked={includeRoute} onCheckedChange={(checked) => setIncludeRoute(checked === true)} /><span><b>Current page</b><small>Include this route, without form contents.</small></span></label><label><Checkbox checked={includeWorkspace} onCheckedChange={(checked) => setIncludeWorkspace(checked === true)} /><span><b>Workspace</b><small>Tell support which workspace you are in.</small></span></label></fieldset>
            <p className="r22-help-boundary">Nothing from your chats, files or browser is attached. Nothing is sent until you confirm on the next step.</p>
            {supportError ? <p className="r22-help-support-error" role="alert">{supportError}</p> : null}
            <Button unstyled className="r22-help-support-primary" type="button" onClick={reviewSupportRequest}>Review request</Button>
          </div> : supportPhase === "review" || supportPhase === "submitting" ? <div className="r22-help-support-review">
            <small>Review before submitting</small><b>{supportSubject}</b><p>{supportMessage}</p>
            <dl><div><dt>Current page</dt><dd>{includeRoute ? pathname : "Not included"}</dd></div><div><dt>Workspace</dt><dd>{includeWorkspace ? "Re-authorize before sharing" : "Not included"}</dd></div><div><dt>Conversation, files, logs</dt><dd>Not included</dd></div></dl>
            <div><Button unstyled type="button" disabled={supportPhase === "submitting"} onClick={() => setSupportPhase("draft")}>Back</Button><Button unstyled className="r22-help-support-primary" type="button" disabled={supportPhase === "submitting"} onClick={submitSupportRequest}>{supportPhase === "submitting" ? "Submitting…" : "Submit request"}</Button></div>
          </div> : <div className={`r22-help-support-status is-${supportPhase}`} role={supportPhase === "error" ? "alert" : "status"}>
            {supportPhase === "error" ? <CircleAlert aria-hidden="true" /> : supportPhase === "closed" ? <CheckCircle2 aria-hidden="true" /> : <Clock3 aria-hidden="true" />}
            <small>{supportActionId}</small>
            <b>{supportPhase === "error" ? "Request was not submitted" : supportPhase === "unknown" ? "We could not tell whether it was sent" : supportPhase === "queued" ? "Request queued" : supportPhase === "waiting" ? "Waiting for a support reply" : "Request closed"}</b>
            <p>{supportPhase === "error" ? "The fixture transport failed before a receipt was confirmed. Retry keeps the same request ID." : supportPhase === "unknown" ? "Do not submit again. Check this same request ID so a delayed receipt cannot create a duplicate." : supportPhase === "queued" ? "A fixture receipt was confirmed. Queued is not the same as a human reply." : supportPhase === "waiting" ? "The request is open and waiting for a person. No response is being fabricated." : "This fixture request was closed after its status was checked."}</p>
            {supportPhase === "error" ? <Button unstyled className="r22-help-support-primary" type="button" onClick={submitSupportRequest}>Retry same request</Button> : supportPhase === "unknown" ? <Button unstyled className="r22-help-support-primary" type="button" onClick={checkSupportStatus}>Check request status</Button> : supportPhase === "queued" ? <Button unstyled className="r22-help-support-primary" type="button" onClick={checkSupportStatus}>Refresh request status</Button> : supportPhase === "waiting" ? <Button unstyled className="r22-help-support-primary" type="button" onClick={checkSupportStatus}>Close fixture request</Button> : <Button unstyled type="button" onClick={() => { setSupportPhase("draft"); setSupportSubject(""); setSupportMessage(""); }}>Start another request</Button>}
          </div>}
          <a className="r22-help-email-exit" href={mailto}>Use the real email exit instead <ExternalLink aria-hidden="true" /></a>
        </> : <><fieldset><legend>Optional context</legend><label><Checkbox checked={includeRoute} onCheckedChange={(checked) => setIncludeRoute(checked === true)} /><span><b>Current page</b><small>Include this route, without form contents.</small></span></label><label><Checkbox checked={includeWorkspace} onCheckedChange={(checked) => setIncludeWorkspace(checked === true)} /><span><b>Workspace</b><small>Tell support which workspace you are in.</small></span></label></fieldset><p className="r22-help-boundary">Nothing from your chats, files or browser is attached. Opening your email app does not send anything.</p><a href={mailto}>Review email request <ExternalLink aria-hidden="true" /></a></>}
      </section>
    </div>
    <footer><span>Other exits</span><Link href={fixture ? "/settings/connections?fixture=r22" : "/settings/connections"}>Connection settings</Link><Link href="/terms">Terms and privacy information</Link></footer>
  </main>;
}

export default R22HelpView;
