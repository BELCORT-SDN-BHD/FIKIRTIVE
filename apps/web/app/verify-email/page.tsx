import { VerifyEmailLanding } from "./VerifyEmailLanding";

export const dynamic = "force-dynamic";
export const metadata = { title: "Signing you in… · Fikirtive" };

/** #940 — see VerifyEmailLanding for why this page exists. */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; callbackURL?: string }>;
}) {
  const { token, callbackURL } = await searchParams;
  return <VerifyEmailLanding token={token} callbackURL={callbackURL} />;
}
