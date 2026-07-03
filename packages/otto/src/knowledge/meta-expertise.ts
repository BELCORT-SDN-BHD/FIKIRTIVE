import type { MetaExpertiseKB, MetaKnowledgeDomain, MetaKnowledgeEntry } from "./meta-expertise.types.js";

const DOMAINS: ReadonlySet<MetaKnowledgeDomain> = new Set([
  "objectives", "bidding", "targeting", "creative", "measurement", "algorithm", "diagnosis",
]);

/** Returns a list of problems; empty array = valid. The citation check is the
 *  anti-fabrication floor: every knowledge entry must trace to a real source. */
export function validateKnowledgeBase(kb: MetaExpertiseKB): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of kb.entries) {
    if (!e.claim || !e.claim.trim()) errors.push(`entry ${e.id}: empty claim`);
    if (!DOMAINS.has(e.domain)) errors.push(`entry ${e.id}: invalid domain ${e.domain}`);
    if (e.citations.length === 0) errors.push(`entry ${e.id}: no citation (fabrication risk)`);
    if (seen.has(e.id)) errors.push(`duplicate entry id ${e.id}`);
    seen.add(e.id);
    for (const c of e.citations) {
      if (!/^https?:\/\//.test(c.url)) errors.push(`entry ${e.id}: citation url not http(s): ${c.url}`);
    }
  }
  return errors;
}

const eq = (a: string | undefined, b: string | undefined) =>
  (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

export function queryMetaKnowledge(
  kb: MetaExpertiseKB,
  filter: { domain?: MetaKnowledgeDomain; metric?: string; objective?: string },
): MetaKnowledgeEntry[] {
  return kb.entries.filter((e) => {
    if (filter.domain && e.domain !== filter.domain) return false;
    if (filter.metric && !eq(e.benchmark?.metric, filter.metric)) return false;
    if (filter.objective && !eq(e.benchmark?.objective, filter.objective)) return false;
    return true;
  });
}

/** Best-match benchmark: objective+industry > objective-only > metric-only. null if no metric match. */
export function getBenchmark(
  kb: MetaExpertiseKB,
  q: { metric: string; objective?: string; industry?: string },
): MetaKnowledgeEntry | null {
  const byMetric = kb.entries.filter((e) => e.benchmark && eq(e.benchmark.metric, q.metric));
  if (byMetric.length === 0) return null;
  const score = (e: MetaKnowledgeEntry) => {
    let s = 0;
    if (q.objective && eq(e.benchmark?.objective, q.objective)) s += 2;
    if (q.industry && eq(e.benchmark?.industry, q.industry)) s += 1;
    return s;
  };
  return byMetric.slice().sort((a, b) => score(b) - score(a))[0] ?? null;
}

export type { MetaExpertiseKB, MetaKnowledgeDomain, MetaCitation, MetaBenchmark, MetaKnowledgeEntry } from "./meta-expertise.types.js";
