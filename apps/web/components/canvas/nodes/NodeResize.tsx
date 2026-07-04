// apps/web/components/canvas/nodes/NodeResize.tsx
// Drag-to-resize handles for canvas cards (gb only; handles show when selected).
// Display-only: resizing changes the card's size on the board so the owner can
// see it bigger or smaller. It does NOT re-generate the asset — no money path.
import { NodeResizer } from "@xyflow/react";

export function NodeResize({ gb, selected, locked }: { gb?: boolean; selected?: boolean; locked?: boolean }) {
  if (!gb) return null;
  return <NodeResizer minWidth={140} minHeight={90} color="#EC5828" isVisible={!!selected && !locked} />;
}
