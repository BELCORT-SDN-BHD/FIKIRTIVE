import type { ChatThreadDTO } from "@/lib/types";

export type OttoNavProjectMeta = { id: string; name: string };

export type OttoNavEntry =
  | { kind: "project"; project: OttoNavProjectMeta; threads: ChatThreadDTO[]; defaultThread?: ChatThreadDTO }
  | { kind: "thread"; project: OttoNavProjectMeta; thread: ChatThreadDTO };

function visibleThreadsForProject(
  projectThreads: ChatThreadDTO[],
  projectId: string,
  activeProjectId: string,
  activeThreadId: string | null,
  threadLimit: number,
) {
  const visibleThreads = projectThreads.slice(0, threadLimit);
  const activeThread = projectId === activeProjectId && activeThreadId
    ? projectThreads.find((t) => t.id === activeThreadId)
    : undefined;
  if (activeThread && !visibleThreads.some((t) => t.id === activeThread.id)) {
    if (visibleThreads.length >= threadLimit) visibleThreads[visibleThreads.length - 1] = activeThread;
    else visibleThreads.push(activeThread);
  }
  return visibleThreads;
}

export function buildOttoNavEntries({
  projects,
  sidebarThreads,
  activeProjectId,
  activeThreadId,
  projectLimit,
  threadLimit,
}: {
  projects: OttoNavProjectMeta[];
  sidebarThreads: ChatThreadDTO[];
  activeProjectId: string;
  activeThreadId: string | null;
  projectLimit: number;
  threadLimit: number;
}): OttoNavEntry[] {
  const threadsByProject = new Map<string, ChatThreadDTO[]>();
  for (const t of sidebarThreads) {
    const arr = threadsByProject.get(t.projectId) ?? [];
    arr.push(t);
    threadsByProject.set(t.projectId, arr);
  }

  const projectIndex = new Map(projects.map((p, index) => [p.id, index]));
  const projectLastActivity = new Map<string, number>();
  for (const t of sidebarThreads) {
    const ts = Date.parse(t.updatedAt) || 0;
    projectLastActivity.set(t.projectId, Math.max(projectLastActivity.get(t.projectId) ?? 0, ts));
  }

  const visibleProjects = [...projects].sort((a, b) => {
    if (a.id === activeProjectId && b.id !== activeProjectId) return -1;
    if (b.id === activeProjectId && a.id !== activeProjectId) return 1;
    const activity = (projectLastActivity.get(b.id) ?? 0) - (projectLastActivity.get(a.id) ?? 0);
    if (activity !== 0) return activity;
    return (projectIndex.get(a.id) ?? 0) - (projectIndex.get(b.id) ?? 0);
  }).slice(0, projectLimit);

  const activeProject = projects.find((p) => p.id === activeProjectId);
  if (activeProject && !visibleProjects.some((p) => p.id === activeProject.id)) {
    if (visibleProjects.length >= projectLimit) visibleProjects[visibleProjects.length - 1] = activeProject;
    else visibleProjects.push(activeProject);
  }

  return visibleProjects.map((project) => {
    const projectThreads = threadsByProject.get(project.id) ?? [];
    const threads = visibleThreadsForProject(projectThreads, project.id, activeProjectId, activeThreadId, threadLimit);
    return { kind: "project" as const, project, threads };
  });
}
