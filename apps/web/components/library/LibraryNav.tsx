"use client";

/**
 * LibraryNav.tsx —— 内容区左边那条薄导航(照 Runway Assets 的骨架)。
 *
 * 它是**页内**的二级导航,不是 app 侧栏 —— `R22DashboardShell` 那七格一个都没动。分出来一个
 * 文件是为了让工作台本体只管「选中了什么、对它做什么」,而不是同时管一堆链接。
 */

import { FolderPlus } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { LibraryPack, LibrarySection } from "./library-fixture";

export function LibraryNav({
  section,
  counts,
  projects,
  packs,
  packCounts,
  onSection,
  onNewPack,
}: {
  section: LibrarySection;
  counts: { all: number; starred: number; made: number; uploads: number };
  /** 自动从东西本身长出来的项目列表(`libraryProjects`)。零手动整理,所以没有增删按钮。 */
  projects: Array<{ id: string; name: string; count: number }>;
  packs: LibraryPack[];
  packCounts: Record<string, number>;
  onSection: (section: LibrarySection) => void;
  onNewPack: () => void;
}) {
  const primary: Array<{ id: LibrarySection; label: string; count: number }> = [
    { id: "all", label: "All", count: counts.all },
    { id: "starred", label: "Starred", count: counts.starred },
    // 生成物与上传物并列 —— 商家脑子里这就是两堆东西,不是一堆东西的两个属性。
    { id: "made", label: "Made by Otto", count: counts.made },
    { id: "uploads", label: "Uploads", count: counts.uploads },
  ];

  return (
    <nav className="r22-lib-nav" aria-label="Library sections">
      <ul>
        {primary.map((entry) => (
          <li key={entry.id}>
            <Button unstyled type="button" aria-current={section === entry.id} onClick={() => onSection(entry.id)}>
              <span>{entry.label}</span>
              <em>{entry.count}</em>
            </Button>
          </li>
        ))}
      </ul>

      {projects.length ? (
        <>
          <p className="r22-lib-nav-h">Projects</p>
          <ul>
            {projects.map((project) => (
              <li key={project.id}>
                <Button unstyled type="button" aria-current={section === `project:${project.id}`} onClick={() => onSection(`project:${project.id}`)}>
                  <span>{project.name}</span>
                  <em>{project.count}</em>
                </Button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <p className="r22-lib-nav-h">Asset packs</p>
      <ul>
        {packs.map((pack) => (
          <li key={pack.id}>
            <Button unstyled type="button" aria-current={section === `pack:${pack.id}`} onClick={() => onSection(`pack:${pack.id}`)}>
              <span>{pack.name}</span>
              <em>{packCounts[pack.id] ?? 0}</em>
            </Button>
          </li>
        ))}
      </ul>
      <Button unstyled type="button" className="r22-lib-nav-new" onClick={onNewPack}><FolderPlus aria-hidden="true" />New pack</Button>
    </nav>
  );
}

export default LibraryNav;
