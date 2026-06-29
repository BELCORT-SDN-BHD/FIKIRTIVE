// Pure core of the chat→canvas bridge — no DB, no I/O, so it is unit-testable.
// (Kept out of the "use server" action file, whose exports must all be async.)

export type GenResultMsg = {
  seq: number;
  genJobId: string | null;
  payload: unknown;
  text: string | null;
};

export type BridgeNode = {
  generationId: string;
  genJobId: string;
  kind: "image" | "video";
  prompt: string | null;
};

/**
 * Decide which canvas nodes to create for a thread's GEN_RESULT messages.
 *
 * Idempotent: a generation already in `have` (i.e. already on the canvas) is
 * skipped, and a generation is never planned twice within one pass. Results are
 * ordered by message seq so older results land left of newer ones. Pure — the
 * caller does the DB reads (jobGenIds) and the inserts.
 */
export function planBridgeNodes(
  genResults: GenResultMsg[],
  jobGenIds: Map<string, string[]>,
  have: Iterable<string | null>,
): BridgeNode[] {
  const seen = new Set<string | null>(have);
  const out: BridgeNode[] = [];
  for (const m of [...genResults].sort((a, b) => a.seq - b.seq)) {
    if (!m.genJobId) continue;
    const kind: "image" | "video" =
      (m.payload as { kind?: string } | null)?.kind === "video" ? "video" : "image";
    for (const gid of jobGenIds.get(m.genJobId) ?? []) {
      if (seen.has(gid)) continue;
      seen.add(gid);
      out.push({ generationId: gid, genJobId: m.genJobId, kind, prompt: m.text });
    }
  }
  return out;
}
