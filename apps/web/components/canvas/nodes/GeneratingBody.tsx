// apps/web/components/canvas/nodes/GeneratingBody.tsx
// In-node "generating" state. Under the Grok-bright skin (gb) it shows OTTO
// making the asset + an indeterminate progress bar + the honest money line
// ("billed only when it finishes" — no fabricated credit number). The legacy
// skin keeps the plain centered text so the old look is untouched (strangler).
import type { TerminalCardStatus } from "@/lib/canvas-card-status";
import { terminalCardCopy } from "@/lib/canvas-terminal-copy";
import type { GenFailureReason } from "@fikirtive/core/gen-failure";
import { Button } from "@/components/ui/button";
function OttoCloud() {
  return (
    <svg width="30" height="27" viewBox="0 0 120 110" aria-hidden>
      <g fill="currentColor">
        <ellipse cx="60" cy="64" rx="43" ry="22" />
        <circle cx="37" cy="52" r="18" />
        <circle cx="61" cy="40" r="24" />
        <circle cx="85" cy="53" r="17" />
      </g>
      <ellipse cx="56" cy="49" rx="3.6" ry="4.6" fill="#2B1308" />
      <ellipse cx="71" cy="49" rx="3.6" ry="4.6" fill="#2B1308" />
    </svg>
  );
}

function RefreshButton({ onRefresh }: { onRefresh?: () => void }) {
  if (!onRefresh) return null;
  return (
    // #840 车4:迁到 ui/Button。这一枚键的样子整个写在下面那份 inline style 里,而 inline
    // 赢过任何表里的规则 —— 所以 ghost 变体的底色/文字色/hover 一条都落不到屏幕上,外观
    // 逐像素不变。落到屏幕上的只有 style 没写的那两样:focus-visible 的键盘焦点环与按下时
    // 的 active:scale —— 正是围栏立法要买的东西(手搓件各自重实现 focus ring 是 #739/#813
    // 那批无障碍缺陷的出处)。
    <Button
      type="button"
      variant="ghost"
      className="nodrag nopan"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onRefresh(); }}
      style={{
        border: "1px solid color-mix(in srgb, currentColor 18%, transparent)",
        borderRadius: 999,
        background: "color-mix(in srgb, var(--background) 86%, transparent)",
        color: "inherit",
        fontSize: 11.5,
        fontWeight: 650,
        lineHeight: 1,
        padding: "7px 10px",
        marginTop: 2,
        cursor: "pointer",
      }}
    >
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
  return (
    <div style={{ display: "grid", placeItems: "center", height: "100%", padding: 12, textAlign: "center", gap: 6 }}>
      <div style={{ fontSize: 20, opacity: 0.5 }} aria-hidden>{copy.icon}</div>
      <div style={{ fontSize: 12.5, fontWeight: 600, opacity: 0.8 }}>{copy.title}</div>
      <div style={{ fontSize: 11.5, opacity: 0.55, lineHeight: 1.4 }}>{copy.detail}</div>
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
      <div style={{ display: "grid", placeItems: "center", height: "100%", opacity: 0.6, gap: 8 }}>
        <span>{queued ? "In the queue…" : kind === "video" ? "Rendering…" : "Generating…"}</span>
        <RefreshButton onRefresh={onRefresh} />
      </div>
    );
  }
  return (
    <div className="cv-gen">
      <span className="cv-gen-otto">
        <OttoCloud /> {queued ? "In the queue — Otto starts shortly" : "Otto is making this"}
      </span>
      <div className="cv-gen-bar" />
      <div className="cv-gen-meta">billed only when it finishes</div>
      <RefreshButton onRefresh={onRefresh} />
    </div>
  );
}
