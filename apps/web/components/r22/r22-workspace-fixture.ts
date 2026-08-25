export type R22FixtureWorkspace = {
  id: string;
  name: string;
  role: "Admin" | "Editor" | "Approver";
};

export type R22FixtureWorkspaceDirectory = {
  activeId: string;
  workspaces: R22FixtureWorkspace[];
};

const DIRECTORY_KEY = "r22:workspace-directory:v1";
export const R22_WORKSPACE_FIXTURE_EVENT = "r22:workspace-fixture-change";

export const DEFAULT_R22_WORKSPACE_DIRECTORY: R22FixtureWorkspaceDirectory = {
  activeId: "batik-house",
  workspaces: [
    { id: "batik-house", name: "Batik House", role: "Admin" },
    { id: "nadi-studio", name: "Nadi Studio", role: "Admin" },
  ],
};

function validDirectory(value: unknown): value is R22FixtureWorkspaceDirectory {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<R22FixtureWorkspaceDirectory>;
  return typeof candidate.activeId === "string"
    && Array.isArray(candidate.workspaces)
    && candidate.workspaces.some((workspace) => workspace?.id === candidate.activeId);
}

export function readR22WorkspaceDirectory(): R22FixtureWorkspaceDirectory {
  try {
    const stored = window.sessionStorage.getItem(DIRECTORY_KEY);
    if (!stored) return DEFAULT_R22_WORKSPACE_DIRECTORY;
    const parsed = JSON.parse(stored) as unknown;
    return validDirectory(parsed) ? parsed : DEFAULT_R22_WORKSPACE_DIRECTORY;
  } catch {
    return DEFAULT_R22_WORKSPACE_DIRECTORY;
  }
}

export function writeR22WorkspaceDirectory(directory: R22FixtureWorkspaceDirectory): void {
  try { window.sessionStorage.setItem(DIRECTORY_KEY, JSON.stringify(directory)); } catch { /* The visual fixture still works without storage. */ }
  window.dispatchEvent(new CustomEvent(R22_WORKSPACE_FIXTURE_EVENT, { detail: directory }));
}

export function renameActiveR22FixtureWorkspace(name: string): R22FixtureWorkspaceDirectory {
  const directory = readR22WorkspaceDirectory();
  const next = {
    ...directory,
    workspaces: directory.workspaces.map((workspace) =>
      workspace.id === directory.activeId ? { ...workspace, name: name.trim() } : workspace,
    ),
  };
  writeR22WorkspaceDirectory(next);
  return next;
}

export function slugifyR22Workspace(name: string): string {
  const slug = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "workspace";
}

export function scopedR22FixtureKey(key: string): string {
  return `${key}:${readR22WorkspaceDirectory().activeId}`;
}
