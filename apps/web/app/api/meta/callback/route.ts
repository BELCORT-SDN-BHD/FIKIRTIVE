import { NextRequest, NextResponse } from "next/server";
import { requireOwner, resolveUserPrincipal } from "@/lib/auth-guard";
import { runAsUser } from "@fikirtive/db/principal";
import { verifyState } from "@/lib/meta-oauth";
import { completeMetaConnect } from "@/lib/meta-actions";

export async function GET(req: NextRequest) {
  const base = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin;
  const gate = await requireOwner();
  if ("error" in gate) return NextResponse.redirect(new URL("/login", base));
  const principal = await resolveUserPrincipal(gate);

  return runAsUser(principal, async () => {
    const sp = new URL(req.url).searchParams;
    const code = sp.get("code");
    const state = sp.get("state");
    const back = new URL("/otto?view=connections", base);

    if (!code || !state) {
      back.searchParams.set("error", "missing");
      return NextResponse.redirect(back);
    }
    const verified = verifyState(state);
    if (!verified || verified.ownerId !== gate.ownerId) {
      back.searchParams.set("error", "state");
      return NextResponse.redirect(back);
    }
    const redirectUri = new URL("/api/meta/callback", base).href;
    const res = await completeMetaConnect(code, redirectUri);
    if ("error" in res) {
      back.searchParams.set("error", res.error);
      return NextResponse.redirect(back);
    }
    back.searchParams.set("connected", "meta");
    return NextResponse.redirect(back);
  });
}
