"use client";
/* eslint-disable react-hooks/set-state-in-effect -- Non-production R22 fixtures read the browser-scoped workspace after hydration. */
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
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
        {/* 搜索框归位 `ui/input-group`(审计 A-12)—— 图标不再靠这一面自己那段绝对定位
            摆位,focus 环也由正典件统一出,五处搜索框从此长一个样。 */}
        <InputGroup className="r22-projects-search">
          <InputGroupAddon><Search aria-hidden="true" /></InputGroupAddon>
          <InputGroupInput aria-label="Search projects" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" />
        </InputGroup>
        <Button unstyled type="button" data-r22-project-create disabled={fixture && fixtureState !== "ready" && fixtureState !== "empty"} onClick={() => setStartOpen(true)}><Plus data-icon="inline-start" aria-hidden="true" />Create project</Button>
      </div>

      {/*
        项目列表归位 `ui/table`(审计 A-6)。此前这里是 `<div role="table">` 里一叠
        `role="row"` 的 `<a>` —— 没有 `role="cell"`,ARIA 表格是残的:屏幕阅读器报得出
        「行」,报不出「第几列、这一格是什么」。真 `<table>` 之后列头与格子自带关系,
        `Table` 自己那层 `overflow-x-auto` 也把横向溢出接管了。

        整行可点保留(商家按哪儿都进得去),键盘路径长在名字那一格的 `<Link>` 上 ——
        `<tr>` 不是可聚焦元素,把整行钉成一颗按钮反而会让 Tab 走进一个读不出名字的东西。
      */}
      <div className="r22-projects-table" aria-busy={fixtureState === "loading" || undefined}>
        <Table className="r22-projects-grid" aria-label="Canvas projects">
          <TableHeader>
            <TableRow className="r22-projects-row r22-projects-head">
              <TableHead>Name</TableHead><TableHead>Owner</TableHead><TableHead>Last modified</TableHead><TableHead>Visibility</TableHead><TableHead><span className="sr-only">Open project</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {fixtureState === "loading" || fixtureState === "error" || fixtureState === "unknown" || fixtureState === "permission" ? null : visibleProjects.map((project) => {
              const href = fixture ? `/create/canvas?project=${encodeURIComponent(project.id)}&fixture=r22` : `/create/canvas?project=${encodeURIComponent(project.id)}`;
              return (
                <TableRow className="r22-projects-row" data-r22-project-row={project.id} key={project.id} onClick={() => router.push(href)}>
                  <TableCell><span className="r22-projects-name"><i><File aria-hidden="true" /></i><span><Link href={href} onClick={(event) => event.stopPropagation()}><b>{project.name}</b></Link><small>{project.briefLabel}</small></span></span></TableCell>
                  <TableCell>{project.ownerLabel}</TableCell><TableCell>{project.modifiedLabel}</TableCell><TableCell>{project.visibility}</TableCell><TableCell><ChevronRight aria-hidden="true" /></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {fixtureState === "loading" ? <div className="r22-projects-empty" role="status">Loading your projects…</div> : fixtureState === "error" ? <div className="r22-projects-empty" role="alert">Projects could not be loaded. <Link href="/create?fixture=r22">Retry</Link></div> : fixtureState === "unknown" ? <div className="r22-projects-empty" role="status">We could not tell whether your projects loaded. <Link href="/create?fixture=r22">Retry</Link></div> : fixtureState === "permission" ? <div className="r22-projects-empty" role="alert">You do not have permission to view projects in this workspace. <Link href="/?fixture=r22">Back to Home</Link></div> : null}
        {fixtureState !== "loading" && fixtureState !== "error" && fixtureState !== "permission" && fixtureState !== "unknown" && !visibleProjects.length && (
          /* 空态归位 `ui/empty`(审计 A-5)。「Create one when you are ready」点名了一个
             动作,所以那颗键就长在这里 —— 它开的是工具排上同一个开局对话框,不是第二条
             建项目的路。另外两支(没人分享给你 / 搜索无结果)不点名动作,也就不长按钮。 */
          <Empty className="r22-projects-empty">
            <EmptyHeader>
              <EmptyDescription>{tab === "shared" ? "No projects have been shared with you." : fixtureState === "empty" ? "No projects yet. Create one when you are ready." : "No projects match this search."}</EmptyDescription>
            </EmptyHeader>
            {tab !== "shared" && fixtureState === "empty" ? (
              <EmptyContent>
                <Button unstyled type="button" className="r22-projects-empty-act" onClick={() => setStartOpen(true)}>Create project</Button>
              </EmptyContent>
            ) : null}
          </Empty>
        )}
      </div>

      <ProjectStartDialog open={startOpen} onOpenChange={setStartOpen} fixture={fixture} fixtureCreateOutcome={fixtureCreateOutcome} />
    </div>
  );
}

export default R22ProjectsView;
