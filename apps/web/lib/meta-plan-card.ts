import { classifyMoneyClass, type AdOp, type AutonomyMode } from "./meta-action-policy";
import { buildApproval, type Approval } from "./meta-approval";
import type { MetaAdObject } from "./meta-objects";

export type ProposeMetaActionInput = {
  planTitle: string;
  steps: Array<{
    op: "pause" | "resume" | "set_budget" | "reschedule";
    targetId: string;
    intent: { dailyBudgetMinor?: number; startTime?: string; endTime?: string };
  }>;
};

export type MetaActionStep = {
  index: number;
  op: AdOp;
  targetId: string;
  targetName: string;
  currentValue: Record<string, unknown>;
  targetValue: Record<string, unknown>;
  moneyClass: "safe" | "spend";
  evidence?: string;
};

export type MetaActionCardPayload = {
  planTitle: string;
  steps: MetaActionStep[];
  totalSpendImpactDisplay: string;
  autoEligible: boolean;
  approval: Approval;
};

function resolveOp(
  inputOp: ProposeMetaActionInput["steps"][number]["op"],
  intent: ProposeMetaActionInput["steps"][number]["intent"],
  obj: MetaAdObject
): AdOp {
  if (inputOp === "set_budget") {
    const newBudget = intent.dailyBudgetMinor ?? 0;
    const currentBudget = obj.dailyBudgetMinor ?? 0;
    return newBudget > currentBudget ? "budget_up" : "budget_down";
  }
  // pause | resume | reschedule map directly
  return inputOp as AdOp;
}

function buildTargetValue(
  inputOp: ProposeMetaActionInput["steps"][number]["op"],
  intent: ProposeMetaActionInput["steps"][number]["intent"]
): Record<string, unknown> {
  if (inputOp === "set_budget") {
    return { dailyBudgetMinor: intent.dailyBudgetMinor };
  }
  if (inputOp === "reschedule") {
    const v: Record<string, unknown> = {};
    if (intent.startTime !== undefined) v.startTime = intent.startTime;
    if (intent.endTime !== undefined) v.endTime = intent.endTime;
    return v;
  }
  return {};
}

function buildEvidence(op: AdOp, obj: MetaAdObject): string {
  if (op === "budget_up" || op === "budget_down") {
    return `${obj.name}: ${obj.currency} ${((obj.dailyBudgetMinor ?? 0) / 100).toFixed(2)}/day`;
  }
  if (op === "pause" || op === "resume") {
    return `${obj.name}: currently ${obj.status}`;
  }
  if (op === "reschedule") {
    return `${obj.name}: start ${obj.startTime ?? "unset"}, end ${obj.endTime ?? "unset"}`;
  }
  return obj.name;
}

export function buildMetaPlanCard(
  input: ProposeMetaActionInput,
  currentObjects: MetaAdObject[],
  mode: AutonomyMode,
  actor: string,
  nowIso: string
): MetaActionCardPayload {
  const steps: MetaActionStep[] = input.steps.map((s, i) => {
    const obj = currentObjects.find((o) => o.id === s.targetId);
    if (!obj) {
      throw new Error(`unknown target: ${s.targetId}`);
    }

    const currentValue: Record<string, unknown> = {
      status: obj.status,
      dailyBudgetMinor: obj.dailyBudgetMinor,
      startTime: obj.startTime,
      endTime: obj.endTime,
      currency: obj.currency,
    };

    const resolvedOp = resolveOp(s.op, s.intent, obj);
    const targetValue = buildTargetValue(s.op, s.intent);
    const moneyClass = classifyMoneyClass(resolvedOp);
    const evidence = buildEvidence(resolvedOp, obj);

    return {
      index: i,
      op: resolvedOp,
      targetId: s.targetId,
      targetName: obj.name,
      currentValue,
      targetValue,
      moneyClass,
      evidence,
    };
  });

  // Collect spend steps and sum deltas per currency (never sum across different currencies)
  const spendSteps = steps.filter((s) => s.moneyClass === "spend" && s.op === "budget_up");

  let totalSpendImpactDisplay: string;
  if (spendSteps.length === 0) {
    // No spend steps — display a zero in the first step's currency if available, else neutral text.
    const firstCurrency = steps[0]?.currentValue?.currency as string | undefined;
    if (firstCurrency) {
      totalSpendImpactDisplay = new Intl.NumberFormat(undefined, { style: "currency", currency: firstCurrency }).format(0) + "/day";
    } else {
      totalSpendImpactDisplay = "no added spend";
    }
  } else {
    // Group deltas by currency
    const byCurrency = new Map<string, number>();
    for (const step of spendSteps) {
      const currency = (step.currentValue.currency as string | undefined) ?? "USD";
      const newBudget = (step.targetValue.dailyBudgetMinor as number | undefined) ?? 0;
      const oldBudget = (step.currentValue.dailyBudgetMinor as number | undefined) ?? 0;
      byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + (newBudget - oldBudget));
    }
    if (byCurrency.size === 1) {
      // All spend steps share one currency — show a single formatted total
      const [[currency, deltaMinor]] = [...byCurrency.entries()];
      const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency });
      totalSpendImpactDisplay = `+${fmt.format(deltaMinor / 100)}/day`;
    } else {
      // Multi-currency plan (rare in v1) — list each currency's subtotal separately
      totalSpendImpactDisplay = [...byCurrency.entries()]
        .map(([currency, deltaMinor]) => {
          const fmt = new Intl.NumberFormat(undefined, { style: "currency", currency });
          return `+${fmt.format(deltaMinor / 100)}/day`;
        })
        .join(", ");
    }
  }

  const autoEligible = mode === "AUTO" && steps.every((s) => s.moneyClass === "safe");

  const planSteps = steps.map((s) => ({
    index: s.index,
    op: s.op,
    targetId: s.targetId,
    targetValue: s.targetValue,
  }));
  const approval = buildApproval(planSteps, actor, nowIso, 10 * 60 * 1000);

  return {
    planTitle: input.planTitle,
    steps,
    totalSpendImpactDisplay,
    autoEligible,
    approval,
  };
}
