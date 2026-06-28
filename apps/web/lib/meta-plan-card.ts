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

/** The real outcome of an AUTO-mode auto-run, persisted on the card so the UI reflects what
 *  actually happened (FIX D) — not a blanket "handling automatically". `ran:false` = the auto-run
 *  was refused/declined and the card is still a PENDING proposal the user can approve manually. */
export type AutoOutcome = {
  ran: boolean;
  state?: "done" | "partial" | "failed";
  reason?: string;
};

export type MetaActionCardPayload = {
  planTitle: string;
  steps: MetaActionStep[];
  totalSpendImpactDisplay: string;
  autoEligible: boolean;
  approval: Approval;
  autoOutcome?: AutoOutcome;
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

/** A valid ISO-4217 code is exactly 3 ASCII letters. Anything else (e.g. "" from a node that
 *  never carried currency) would make Intl.NumberFormat throw — so we treat it as "no currency". */
function isValidCurrency(code: string | undefined): code is string {
  return typeof code === "string" && /^[A-Za-z]{3}$/.test(code);
}

/** Format a minor-unit amount for display. If the currency code is a valid 3-letter ISO code use
 *  currency style; otherwise fall back to the plain major-unit number (never throw). */
function formatMoney(minor: number, currency: string | undefined): string {
  const major = minor / 100;
  if (isValidCurrency(currency)) {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(major);
  }
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(major);
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

    // Backstop (FIX A): a set_budget step may NEVER reach here without a positive intent amount
    // AND a positive current daily budget. Otherwise resolveOp/buildTargetValue would produce a
    // money-SAFE budget_down with a {}/0 targetValue — silently auto-zeroing the budget. The
    // propose flow rejects these upstream; this throw guarantees they can never become a card.
    if (s.op === "set_budget") {
      const amount = s.intent.dailyBudgetMinor;
      if (typeof amount !== "number" || !(amount > 0)) {
        throw new Error(`set_budget requires a positive daily budget amount (target ${s.targetId})`);
      }
      if (typeof obj.dailyBudgetMinor !== "number" || !(obj.dailyBudgetMinor > 0)) {
        throw new Error(`cannot set a daily budget on ${s.targetId}: it has no daily budget`);
      }
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

  // Spend-impact steps that ADD daily spend:
  //  - budget_up: the delta (new − old) is the added daily spend.
  //  - resume (FIX E): resuming a paused budgeted object restarts its CURRENT daily budget, so
  //    its whole current daily budget is added spend. (budget_down/pause reduce or hold — excluded.)
  const spendSteps = steps.filter(
    (s) => (s.moneyClass === "spend" && s.op === "budget_up") || s.op === "resume",
  );

  let totalSpendImpactDisplay: string;
  if (spendSteps.length === 0) {
    // No spend steps — display a zero in the first step's currency if available, else neutral text.
    const firstCurrency = steps[0]?.currentValue?.currency as string | undefined;
    if (isValidCurrency(firstCurrency)) {
      totalSpendImpactDisplay = formatMoney(0, firstCurrency) + "/day";
    } else {
      totalSpendImpactDisplay = "no added spend";
    }
  } else {
    // Group added-spend deltas by currency (never sum across different currencies)
    const byCurrency = new Map<string, number>();
    for (const step of spendSteps) {
      const currency = (step.currentValue.currency as string | undefined) ?? "";
      let addedMinor: number;
      if (step.op === "resume") {
        // Resuming restarts the object's current daily budget (0 if it has none — e.g. lifetime).
        addedMinor = (step.currentValue.dailyBudgetMinor as number | undefined) ?? 0;
      } else {
        const newBudget = (step.targetValue.dailyBudgetMinor as number | undefined) ?? 0;
        const oldBudget = (step.currentValue.dailyBudgetMinor as number | undefined) ?? 0;
        addedMinor = newBudget - oldBudget;
      }
      byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + addedMinor);
    }
    const parts = [...byCurrency.entries()].map(
      ([currency, deltaMinor]) => `+${formatMoney(deltaMinor, currency)}/day`,
    );
    totalSpendImpactDisplay = parts.join(", ");
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
