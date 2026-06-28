import { createHash } from "crypto";
import type { AdOp } from "./meta-action-policy";

export type PlanStep = {
  index: number;
  op: AdOp;
  targetId: string;
  targetValue: Record<string, unknown>;
};

export type Approval = {
  paramHash: string;
  boundActor: string;
  expiresAt: string;
  consumedAt?: string;
};

/**
 * Deterministic JSON representation of steps.
 * Guarantees stability by:
 * 1. Recursively sorting object keys alphabetically
 * 2. Normalising numbers via Number(x) so 2000 and 2000.0 are identical
 */
export function canonicalizeSteps(steps: PlanStep[]): string {
  return JSON.stringify(normalise(steps));
}

function normalise(value: unknown): unknown {
  if (typeof value === "number") {
    return Number(value);
  }
  if (Array.isArray(value)) {
    return value.map(normalise);
  }
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as object).sort()) {
      sorted[key] = normalise((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function hashSteps(steps: PlanStep[]): string {
  return createHash("sha256").update(canonicalizeSteps(steps)).digest("hex");
}

export function buildApproval(
  steps: PlanStep[],
  actor: string,
  nowIso: string,
  ttlMs: number
): Approval {
  return {
    paramHash: hashSteps(steps),
    boundActor: actor,
    expiresAt: new Date(Date.parse(nowIso) + ttlMs).toISOString(),
  };
}

export function verifyApproval(
  a: Approval,
  steps: PlanStep[],
  actor: string,
  nowIso: string
): { ok: true } | { ok: false; reason: "hash" | "expired" | "consumed" | "actor" } {
  if (a.boundActor !== actor) return { ok: false, reason: "actor" };
  if (a.consumedAt !== undefined) return { ok: false, reason: "consumed" };
  if (nowIso > a.expiresAt) return { ok: false, reason: "expired" };
  if (hashSteps(steps) !== a.paramHash) return { ok: false, reason: "hash" };
  return { ok: true };
}
