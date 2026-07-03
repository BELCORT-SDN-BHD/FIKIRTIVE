import type { MetaExpertiseKB, MetaKnowledgeDomain } from "./meta-expertise.types.js";

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

export type { MetaExpertiseKB, MetaKnowledgeDomain, MetaCitation, MetaBenchmark, MetaKnowledgeEntry } from "./meta-expertise.types.js";
