import { redirect } from "next/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { getMyProfileNames } from "@/lib/profile-names";
import { getMetaConnection } from "@/lib/meta-actions";
import { R22Onboarding, type R22OnboardingChannelState, type R22OnboardingFixtureOutcome, type R22OnboardingStep } from "@/components/onboarding/R22Onboarding";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up your workspace · Fikirtive" };

const STEPS = new Set<R22OnboardingStep>(["workspace", "brand", "channel", "routine", "post"]);

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const requested = first(sp.step);
  const step = requested && STEPS.has(requested as R22OnboardingStep) ? requested as R22OnboardingStep : "workspace";
  const fixture = process.env.NODE_ENV !== "production" && first(sp.fixture) === "r22";
  const requestedOutcome = first(sp.outcome);
  const fixtureOutcome: R22OnboardingFixtureOutcome = requestedOutcome === "error" || requestedOutcome === "permission" ? requestedOutcome : "success";

  if (fixture) return <R22Onboarding key={step} initialStep={step} initialWorkspaceName="Harvest Candle Co" initialChannelState="disconnected" fixture fixtureOutcome={fixtureOutcome} fixtureInitialBlank={first(sp.state) === "blank"} />;

  const owner = await requireOwner();
  if ("error" in owner) redirect(`/login?from=${encodeURIComponent(`/onboarding?step=${step}`)}`);
  const [profile, meta] = await Promise.all([
    getMyProfileNames().catch(() => ({ error: "Workspace details could not be read." } as const)),
    getMetaConnection().catch(() => ({ error: "Connection status could not be read." } as const)),
  ]);
  let channelState: R22OnboardingChannelState = "unknown";
  if (!("error" in meta)) {
    if (!meta.connected) channelState = "disconnected";
    else if (meta.needsReconnect || meta.status === "expired") channelState = "needs_reconnect";
    else if (meta.transientError) channelState = "transient";
    else channelState = "connected";
  }
  return (
    <R22Onboarding
      key={step}
      initialStep={step}
      initialWorkspaceName={"error" in profile ? "" : profile.workspaceName}
      initialWorkspaceError={"error" in profile ? profile.error : undefined}
      initialChannelState={channelState}
    />
  );
}
