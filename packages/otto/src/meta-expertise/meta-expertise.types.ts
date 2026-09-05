export type MetaKnowledgeDomain =
  | "objectives"   // campaign objectives & when to use each
  | "bidding"      // bid strategies, budget, learning
  | "targeting"    // audiences, targeting
  | "creative"     // creative & copy best practices
  | "measurement"  // metrics meaning, attribution, ROAS, benchmarks
  | "algorithm"    // delivery / learning-phase mechanics
  | "diagnosis";   // symptom → likely cause → expert action

export type MetaCitation = { url: string; title: string; retrievedAt: string };

export type MetaBenchmark = {
  metric: string;      // "CTR" | "CPC" | "ROAS" | "frequency" | ...
  objective?: string;  // "traffic" | "conversions" | "awareness" | ...
  industry?: string;   // "ecommerce" | "retail" | ... (optional)
  range: string;       // human-readable, e.g. "0.9%–1.6% (median ~1.2%)"
  note?: string;
};

export type MetaKnowledgeEntry = {
  id: string;                  // stable kebab id, unique
  domain: MetaKnowledgeDomain;
  claim: string;               // distilled expert principle/fact (NOT copied verbatim)
  detail?: string;
  benchmark?: MetaBenchmark;
  appliesWhen?: string;        // condition under which the claim applies
  sourceCert?: string;         // which Blueprint cert/domain it came from
  citations: MetaCitation[];   // MUST be non-empty
};

export type MetaExpertiseKB = {
  version: string;             // build date, e.g. "2026-07-03"
  entries: MetaKnowledgeEntry[];
  sources: MetaCitation[];     // master source list
};
