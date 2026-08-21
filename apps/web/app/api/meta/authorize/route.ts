import { NextRequest, NextResponse } from "next/server";
import { SHELL_ROUTES } from "@fikirtive/core/navigation";
import { requireOwner } from "@/lib/auth-guard";
import { signState, buildAuthorizeUrl } from "@/lib/meta-oauth";

export async function GET(req: NextRequest) {
  const base = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin;
  const gate = await requireOwner();
  if ("error" in gate) return NextResponse.redirect(new URL("/login", base));
  const appId = process.env.META_APP_ID;
  const configId = process.env.META_LOGIN_CONFIG_ID;
  if (!appId || !configId)
    return NextResponse.redirect(
      new URL(`${SHELL_ROUTES.connections}?error=not_configured`, base),
    );
  const redirectUri = new URL("/api/meta/callback", base).href;
  return NextResponse.redirect(
    buildAuthorizeUrl(appId, redirectUri, signState(gate.ownerId), configId),
  );
}
