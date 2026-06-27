import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth-guard";
import { signState, buildAuthorizeUrl } from "@/lib/meta-oauth";

export async function GET(req: NextRequest) {
  const base = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin;
  const gate = await requireOwner();
  if ("error" in gate) return NextResponse.redirect(new URL("/login", base));
  const appId = process.env.META_APP_ID;
  if (!appId)
    return NextResponse.redirect(
      new URL("/otto?view=connections&error=not_configured", base),
    );
  const redirectUri = new URL("/api/meta/callback", base).href;
  return NextResponse.redirect(
    buildAuthorizeUrl(appId, redirectUri, signState(gate.ownerId)),
  );
}
