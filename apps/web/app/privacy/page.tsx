import Link from "next/link";

export const metadata = { title: "Privacy · Fikirtive" };

export default function PrivacyPage() {
  return (
    <main className="gb min-h-[100dvh] bg-background px-6 py-10 text-foreground">
      <article className="mx-auto max-w-[720px]">
        <Link href="/login" className="text-sm font-semibold text-muted-foreground underline underline-offset-4">
          Back to sign in
        </Link>
        <h1 className="mt-8 text-[34px] font-bold tracking-[-0.02em]">Fikirtive Privacy Policy</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This beta privacy notice explains the information Fikirtive uses to run your marketing workspace.
        </p>

        <section className="mt-8 space-y-4 text-[15px] leading-7 text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">Information we process</h2>
          <p>
            Fikirtive stores account details, uploaded assets, prompts, generated media, campaign metadata, credit
            ledger activity, and settings needed to operate Otto and the workspace.
          </p>
          <p>
            If you connect external services such as Meta or Stripe, Fikirtive stores the tokens, identifiers, checkout
            events, and status data required to provide those integrations.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">How we use it</h2>
          <p>
            We use this information to authenticate you, keep workspace data scoped to your account, meter credits,
            generate and store media, show account activity, and debug product issues during the beta.
          </p>
          <p>
            Fikirtive does not use your private workspace content to grant another customer access to your files or
            campaigns. Operators may inspect limited account metadata to support, secure, and audit the service.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Where your data lives</h2>
          <p>
            Fikirtive runs on hosted infrastructure and sub-processors: application hosting and database (Railway,
            Neon), file storage and networking (Cloudflare), payments (Stripe), email delivery (Resend), third-party AI
            infrastructure providers that process content to render Otto and generation results, and Meta for connected
            ad accounts. Each processes only the data needed for its role.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Your choices and PDPA rights</h2>
          <p>
            You can disconnect integrations from the Account area where supported. If you connected a Meta account,
            you can also request removal through Meta — see{" "}
            <Link href="/legal/data-deletion" className="underline underline-offset-4">data deletion</Link>.
          </p>
          <p>
            Fikirtive is operated by Belcort Sdn. Bhd. (Malaysia) and handles personal data in line with the Personal
            Data Protection Act 2010 (PDPA). For access, correction, deletion, or export requests during the beta,
            email <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a>.
          </p>
        </section>
      </article>
    </main>
  );
}
