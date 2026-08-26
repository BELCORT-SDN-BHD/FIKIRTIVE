"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures read the browser-scoped workspace after hydration. */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import Link from "next/link";
import { ChevronRight, File, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { readR22WorkspaceDirectory } from "@/components/r22/r22-workspace-fixture";
import { ProjectStartDialog, type ProjectCreateOutcome } from "./ProjectStartDialog";
import "./r22-projects.css";

export type R22ProjectRow = {
  id: string;
  name: string;
  ownerLabel: string;
  modifiedLabel: string;
  visibility: string;
  briefLabel: string;
};

export function R22ProjectsView({ projects, fixture = false, fixtureState = "ready", fixtureCreateOutcome = "success" }: { projects: R22ProjectRow[]; fixture?: boolean; fixtureState?: "ready" | "loading" | "error" | "permission" | "empty" | "unknown"; fixtureCreateOutcome?: ProjectCreateOutcome }) {
  const [tab, setTab] = useState<"mine" | "shared" | "all">("mine");
  const [query, setQuery] = useState("");
  const [startOpen, setStartOpen] = useState(false);
  const [fixtureWorkspaceId, setFixtureWorkspaceId] = useState(fixture ? "" : "production");

  useEffect(() => {
    if (!fixture) return;
    setFixtureWorkspaceId(readR22WorkspaceDirectory().activeId);
  }, [fixture]);

  const visibleProjects = useMemo(() => {
    if (tab === "shared") return [];
    if (fixture && fixtureWorkspaceId !== "batik-house") return [];
    const normalized = query.trim().toLowerCase();
    return projects.filter((project) => !normalized || project.name.toLowerCase().includes(normalized));
  }, [fixture, fixtureWorkspaceId, projects, query, tab]);

  return (
    <div className="r22-projects" data-r22-projects>
      <p className="r22-projects-breadcrumb"><Link href={fixture ? "/?fixture=r22" : "/"}>Home</Link><span>/</span>Canvas</p>
      <h1>Canvas projects</h1>
      <p className="r22-projects-subtitle">Every brief, conversation and finished piece stays together in one project.</p>

      <Tabs unstyled value={tab} onValueChange={(value) => setTab(value as "mine" | "shared" | "all")}>
        <TabsList unstyled className="r22-projects-tabs" aria-label="Project filters">
          <TabsTrigger unstyled value="mine">My projects</TabsTrigger>
          <TabsTrigger unstyled value="shared">Shared with me</TabsTrigger>
          <TabsTrigger unstyled value="all">All projects</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="r22-projects-toolbar">
        <label><Search aria-hidden="true" /><Input unstyled value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" /></label>
        <Button unstyled type="button" data-r22-project-create disabled={fixture && fixtureState !== "ready" && fixtureState !== "empty"} onClick={() => setStartOpen(true)}><Plus data-icon="inline-start" aria-hidden="true" />Create project</Button>
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

      <ProjectStartDialog open={startOpen} onOpenChange={setStartOpen} fixture={fixture} fixtureCreateOutcome={fixtureCreateOutcome} />
    </div>
  );
}

export default R22ProjectsView;
