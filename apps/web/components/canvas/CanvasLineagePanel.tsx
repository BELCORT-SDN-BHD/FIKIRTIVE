"use client";
/**
 * CanvasLineagePanel — 「这张卡的来龙去脉」,北极星画布上的血缘树(#605 T6 · spec #599 D8)。
 *
 * 商家点开任何一张卡,树上说的每一句都必须是落盘的事实:哪张卡做出了它、它做出了哪些卡、
 * 它和哪几张是一次生成出来的兄弟。四列之外的东西(坐标、卡片先后、板上还剩几张)一律不参与,
 * 形状由 `buildCanvasLineageTree` 一处决定,这里只负责画。
 *
 * 诚实优先于好看:
 *   · 读不出来 ⇒ 整棵树换成「Lineage unavailable」,一条关系都不画(fail-closed 先例)。
 *   · 来源没记下来 ⇒ 说没记下来,不改口叫「原创」。
 *   · 来源不在这块板上 ⇒ 直说,不画一条通往看不见的卡的线。
 *   · 批次序号没记 ⇒ 位置留空,不按顺序补。
 *
 * 引擎保密:这里只出现商家看得懂的东西(类型、提示词、批次位置),永远没有模型或供应商名字。
 */

import type { CanvasLineageTree, CanvasLineageTreeRow } from "@/lib/canvas-lineage-tree";

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: "0.04em",
  color: "var(--muted-foreground)",
  margin: 0,
};

const NOTE_STYLE: React.CSSProperties = {
  fontSize: 12,
  lineHeight: 1.45,
  color: "var(--muted-foreground)",
  margin: 0,
};

/** What the focused card records about its own source, in the merchant's words. */
const ORIGIN_NOTE: Record<CanvasLineageTree["origin"], string | null> = {
  "not-recorded": "No source recorded for this card.",
  "off-board": "Source is not on this board.",
  "on-board": null,
};

function LineageRow({
  row,
  indentFrom,
  onPick,
}: {
  row: CanvasLineageTreeRow;
  indentFrom: number;
  onPick: (id: string) => void;
}) {
  const said = row.prompt;
  return (
    <button
      type="button"
      data-lineage-row={row.id}
      aria-current={row.isFocus ? "true" : undefined}
      onClick={() => onPick(row.id)}
      className="cv-lineage-row"
      style={{ marginLeft: Math.max(0, row.depth - indentFrom) * 12 }}
    >
      <span className="cv-lineage-kind">{row.kind}</span>
      <span className="cv-lineage-said">{said || "No description kept"}</span>
      {row.letter && <span className="cv-lineage-letter">{row.letter}</span>}
      {!row.letter && row.batchPosition && (
        <span className="cv-lineage-pos">{row.batchPosition}</span>
      )}
    </button>
  );
}

export function CanvasLineagePanel({
  tree,
  unavailable,
  onPick,
  onClose,
}: {
  /** Null when no single card is picked — the tree is about ONE card. */
  tree: CanvasLineageTree | null;
  /** The board's history could not be read. Nothing is drawn while this is true. */
  unavailable: boolean;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const originNote = tree ? ORIGIN_NOTE[tree.origin] : null;
  return (
    <aside aria-label="Lineage" className="al-panel cv-lineage">
      <header className="cv-lineage-head">
        <h2 className="cv-lineage-title">Lineage</h2>
        <button
          type="button"
          className="al-btn al-btn-sm"
          aria-label="Close lineage"
          onClick={onClose}
        >
          Close
        </button>
      </header>

      {unavailable ? (
        // FAIL CLOSED. A board read that failed says nothing about today's relationships, and the
        // snapshot still on screen may already be wrong — so the tree stops talking rather than
        // keep telling a story it cannot stand behind.
        <div className="cv-lineage-empty">
          <p className="cv-lineage-strong">Lineage unavailable</p>
          <p style={NOTE_STYLE}>
            We couldn&apos;t read this board&apos;s history just now, so nothing is shown here. Your
            cards are untouched.
          </p>
        </div>
      ) : !tree ? (
        <div className="cv-lineage-empty">
          <p style={NOTE_STYLE}>Pick one card to see where it came from.</p>
        </div>
      ) : (
        <div className="cv-lineage-body">
          <section>
            <p style={LABEL_STYLE}>Made from</p>
            {originNote && <p style={NOTE_STYLE}>{originNote}</p>}
            <div className="cv-lineage-rows">
              {tree.chain.map((row) => (
                <LineageRow key={`chain-${row.id}`} row={row} indentFrom={0} onPick={onPick} />
              ))}
            </div>
          </section>

          {tree.batch && (
            <section>
              <p style={LABEL_STYLE}>Same batch · Batch of {tree.batch.size}</p>
              <p style={NOTE_STYLE}>
                One press made these together. Standing side by side is not the same as coming from
                one another.
              </p>
              <div className="cv-lineage-rows">
                {tree.batch.rows.map((row) => (
                  <LineageRow key={`batch-${row.id}`} row={row} indentFrom={0} onPick={onPick} />
                ))}
              </div>
            </section>
          )}

          {tree.descendants.length > 0 && (
            <section>
              <p style={LABEL_STYLE}>Made from this</p>
              <div className="cv-lineage-rows">
                {tree.descendants.map((row) => (
                  <LineageRow
                    key={`down-${row.id}`}
                    row={row}
                    indentFrom={tree.chain.length}
                    onPick={onPick}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}

export default CanvasLineagePanel;
