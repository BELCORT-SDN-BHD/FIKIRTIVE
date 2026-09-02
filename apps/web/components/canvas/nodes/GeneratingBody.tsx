// apps/web/components/canvas/nodes/GeneratingBody.tsx
// In-node "generating" state. Under the Grok-bright skin (gb) it shows OTTO
// making the asset + an honest unknown-duration spinner + the money line
// ("billed only when it finishes" — no fabricated percentage). The legacy
// skin keeps the plain centered text so the old look is untouched (strangler).
import type { TerminalCardStatus } from "@/lib/canvas-card-status";
import { terminalCardCopy } from "@/lib/canvas-terminal-copy";
import type { GenFailureReason } from "@fikirtive/core/gen-failure";
import { BanIcon, CircleHelpIcon, Clock3Icon, ImageOffIcon, RefreshCwIcon, TriangleAlertIcon } from "lucide-react";

import { OttoAvatar } from "@/components/otto/OttoAvatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

const TERMINAL_ICONS = {
  failed: TriangleAlertIcon,
  cancelled: BanIcon,
  timeout: Clock3Icon,
  missing: ImageOffIcon,
  unknown: CircleHelpIcon,
} satisfies Record<TerminalCardStatus, typeof TriangleAlertIcon>;

function RefreshButton({ onRefresh }: { onRefresh?: () => void }) {
  if (!onRefresh) return null;
  return (
    // A compact recovery action inside a 320px card. `size="xs"` owns its geometry;
    // `nodrag nopan` keeps clicking it from moving the React Flow node underneath.
    <Button
      type="button"
      variant="outline"
      size="xs"
      className="nodrag nopan"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onRefresh(); }}
    >
      <RefreshCwIcon data-icon="inline-start" aria-hidden="true" />
      Check again
    </Button>
  );
}

/** ONE FACE PER RESTING STATE — a card that has stopped being made says which ending it reached,
 *  and (since #827) WHY, when its own state records a reason.
 *
 *  The words themselves live in `@/lib/canvas-terminal-copy`: a `Record` over the terminal faces,
 *  so a new resting face cannot ship without copy, and a plain module so the board's durable read
 *  and this component can be proved against the SAME function. Without this whole family, a card
 *  that stopped showed GeneratingBody for ever (F21).
 *
 *  `reason` is REQUIRED, not optional. An optional explanation is one every caller may forget and
 *  no compiler will ask about, which is the shape of the bug #827 fixed one layer up; every card
 *  has a reason, and for almost all of them it is `unexplained` — the honest name that reads
 *  exactly as this card always has. */
export function FailedBody({
  status,
  reason,
  onRefresh,
}: { status: TerminalCardStatus; reason: GenFailureReason; onRefresh?: () => void }) {
  const copy = terminalCardCopy(status, reason);
  const Icon = TERMINAL_ICONS[status];
  return (
    <div className="cv-node-state" data-state={status}>
      <span className="cv-node-state-icon" aria-hidden><Icon /></span>
      <div className="cv-node-state-title">{copy.title}</div>
      <div className="cv-node-state-detail">{copy.detail}</div>
      {copy.offersRefresh && <RefreshButton onRefresh={onRefresh} />}
    </div>
  );
}

/** The card while work really is happening — and only then (#602 T3).
 *
 *  `queued` and `generating` are two different claims and the card must not confuse them: knowing
 *  a job exists is not knowing it started, and "Otto is making this" about a job still waiting in
 *  line is an assertion with nothing behind it. The queued face says the true thing instead. */
export function GeneratingBody({
  gb,
  kind,
  queued,
  onRefresh,
}: { gb?: boolean; kind: "image" | "video"; queued?: boolean; onRefresh?: () => void }) {
  if (!gb) {
    return (
      <div className="cv-node-state" role="status" aria-live="polite">
        <Spinner aria-hidden="true" />
        <span className="cv-node-state-title">{queued ? "In the queue…" : kind === "video" ? "Rendering…" : "Generating…"}</span>
        <RefreshButton onRefresh={onRefresh} />
      </div>
    );
  }
  return (
    <div className="cv-gen" role="status" aria-live="polite">
      <span className="cv-gen-otto">
        <OttoAvatar size={30} mood={queued ? "waiting" : "thinking"} />
        {queued ? "In the queue…" : kind === "video" ? "Rendering…" : "Generating…"}
      </span>
      <span className="cv-gen-progress">
        <Spinner aria-hidden="true" />
        {queued ? "Otto starts automatically when a worker is ready" : "Otto is making this — you can keep working"}
      </span>
      <Badge variant="outline">Billed only when it finishes</Badge>
      <RefreshButton onRefresh={onRefresh} />
    </div>
  );
}
