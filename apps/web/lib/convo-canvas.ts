// Pure helpers for the multi-convo canvas (G4c). No DB, no React — unit-tested in isolation.

export const UNATTRIBUTED_COLOR = "#9aa0a6"; // neutral grey for nodes with no convo

// A small, visually-distinct palette. A node's tint is a stable function of its threadId.
const PALETTE = ["#5b8def", "#e2725b", "#3aa675", "#b86fd1", "#e0a32e", "#2bb1c4", "#d65a8e", "#7a6ff0"];

export function convoColor(threadId: string | null): string {
  if (!threadId) return UNATTRIBUTED_COLOR;
  let hash = 0;
  for (let i = 0; i < threadId.length; i++) {
    hash = (hash * 31 + threadId.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

export function filterNodesByConvo<T extends { threadId: string | null }>(
  nodes: T[],
  activeThreadId: string | null,
  on: boolean,
): T[] {
  if (!on || !activeThreadId) return nodes;
  return nodes.filter((n) => n.threadId === activeThreadId);
}

export function convoTabModel(
  threads: { id: string; title: string }[],
  activeThreadId: string | null,
  activity: Set<string>,
): { id: string; title: string; active: boolean; working: boolean }[] {
  return threads.map((t) => ({
    id: t.id,
    title: t.title,
    active: t.id === activeThreadId,
    working: activity.has(t.id),
  }));
}
