// Pure, deterministic policy. The ONLY place "auto vs ask" is decided. Consulted by trusted
// server code (the executor), never by the LLM. Founder-readable rule table (priority ③).
export type AdOp = "pause" | "resume" | "budget_up" | "budget_down" | "reschedule";
export type MoneyClass = "safe" | "spend";
export type AutonomyMode = "ASK" | "AUTO";
export type Decision = "auto" | "ask";

const SAFE_OPS: ReadonlySet<AdOp> = new Set<AdOp>(["pause", "budget_down"]);

/** Money-class from the (server-resolved) op. Unknown → spend (fail-safe). */
export function classifyMoneyClass(op: AdOp): MoneyClass {
  return SAFE_OPS.has(op) ? "safe" : "spend";
}

/** auto ONLY for AUTO mode + a money-safe op. Everything else asks. Unknown mode → ask. */
export function policyDecision(mode: AutonomyMode, moneyClass: MoneyClass): Decision {
  return mode === "AUTO" && moneyClass === "safe" ? "auto" : "ask";
}
