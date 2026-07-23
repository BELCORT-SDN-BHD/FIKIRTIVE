export type PackAlertTone = "neutral" | "info" | "success" | "warning" | "danger";

export type BytePlusPackEnv = {
  capacityUsd?: string;
  usedUsd?: string;
  alertPct?: string;
};

export type BytePlusPackSignal = {
  status: string;
  count: number;
  detail: string;
  tone: PackAlertTone;
};

function parsePositiveNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseNonNegativeNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function buildBytePlusPackSignal(args: {
  estimatedUsedUsd: number;
  env?: BytePlusPackEnv;
}): BytePlusPackSignal {
  const env = args.env ?? {};
  const capacityUsd = parsePositiveNumber(env.capacityUsd);
  const thresholdPct = parsePositiveNumber(env.alertPct) ?? 20;
  const usedOverrideUsd = parseNonNegativeNumber(env.usedUsd);
  const estimatedUsedUsd = Math.max(0, Number.isFinite(args.estimatedUsedUsd) ? args.estimatedUsedUsd : 0);

  if (capacityUsd === null) {
    return {
      status: "configure alert",
      count: Math.round(estimatedUsedUsd * 100),
      detail:
        "Configure the generation capacity and remaining-usage alert before launch; capacity expiry shifts video cost to on-demand pricing.",
      tone: "warning",
    };
  }

  const usedUsd = usedOverrideUsd ?? estimatedUsedUsd;
  const remainingUsd = capacityUsd - usedUsd;
  const remainingPct = Math.max(0, (remainingUsd / capacityUsd) * 100);
  const source = usedOverrideUsd === null ? "estimated from frozen spend snapshots" : "from the configured usage override";

  if (remainingUsd <= 0) {
    return {
      status: "depleted",
      count: 0,
      detail: `Generation capacity is exhausted (${source}); renew before more video traffic uses on-demand pricing.`,
      tone: "danger",
    };
  }

  if (remainingPct <= thresholdPct) {
    return {
      status: "renew soon",
      count: Math.round(remainingUsd * 100),
      detail: `$${remainingUsd.toFixed(2)} remaining (${remainingPct.toFixed(0)}%) ${source}; threshold is ${thresholdPct.toFixed(0)}%.`,
      tone: "warning",
    };
  }

  return {
    status: "covered",
    count: Math.round(remainingUsd * 100),
    detail: `$${remainingUsd.toFixed(2)} remaining (${remainingPct.toFixed(0)}%) ${source}; alert threshold is ${thresholdPct.toFixed(0)}%.`,
    tone: "success",
  };
}
