import Link from "next/link";

export const metadata = { title: "Terms · Fikirtive" };

export default function TermsPage() {
  return (
    <main className="gb min-h-[100dvh] bg-background px-6 py-10 text-foreground">
      <article className="mx-auto max-w-[720px]">
        <Link href="/login" className="text-sm font-semibold text-muted-foreground underline underline-offset-4">
          Back to sign in
        </Link>
        <h1 className="mt-8 text-[34px] font-bold tracking-[-0.02em]">Fikirtive Terms</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Fikirtive is an invite-only beta marketing workspace. These terms are a plain-language summary for beta users.
        </p>

        <section className="mt-8 space-y-4 text-[15px] leading-7 text-muted-foreground">
          <h2 className="text-lg font-semibold text-foreground">Using Fikirtive</h2>
          <p>
            You are responsible for the prompts, uploaded files, brand material, campaign decisions, and external
            accounts you connect. Only upload content you own or have permission to use.
          </p>
          <p>
            Otto can draft marketing ideas and prepare generation or ad actions, but you remain responsible for
            reviewing outputs before publishing or spending on external platforms.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Credits and paid actions</h2>
          <p>
            Fikirtive shows credit costs before paid generation actions. Credits are reserved before work starts and
            settled or refunded by the credit ledger when the job finishes or fails.
          </p>
          <p>
            Credit purchases, Stripe checkout, Meta ads, and other third-party services may also be governed by those
            providers&apos; terms, fees, and platform rules.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Beta availability</h2>
          <p>
            The product is still changing. Features, prices, provider availability, and limits may change as the beta
            continues. If something looks wrong, stop using the affected feature and contact the Fikirtive team through
            your invite thread.
          </p>

          <h2 className="pt-4 text-lg font-semibold text-foreground">Who you are dealing with</h2>
          <p>
            Fikirtive is operated by Belcort Sdn. Bhd. (Malaysia). These beta terms are governed by the laws of
            Malaysia. Questions:{" "}
            <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a>. See also our{" "}
            <Link href="/privacy" className="underline underline-offset-4">Privacy Policy</Link>.
          </p>
        </section>
      </article>
    </main>
  );
}
