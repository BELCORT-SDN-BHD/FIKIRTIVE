import Link from "next/link";

export const metadata = { title: "Data deletion · Fikirtive" };

/** Meta data-deletion 确认页:回调返回的 url 指到这里,用户凭 confirmation code
 *  核对请求已被处理(2026-07-04 法务盲区修复)。免登录(proxy 放行 /legal)。 */
export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  return (
    <main className="gb min-h-[100dvh] bg-background px-6 py-10 text-foreground">
      <article className="mx-auto max-w-[720px]">
        <Link href="/privacy" className="text-sm font-semibold text-muted-foreground underline underline-offset-4">
          Privacy Policy
        </Link>
        <h1 className="mt-8 text-[34px] font-bold tracking-[-0.02em]">Data deletion</h1>
        <section className="mt-6 space-y-4 text-[15px] leading-7 text-muted-foreground">
          {code ? (
            <p>
              This is your Meta data deletion reference. Confirmation code:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 text-[13px] text-foreground">{code}</code>. When Meta
              sends us a deletion request for your account, we remove the stored Meta connection and its access token
              from Fikirtive. If you believe a request was not honoured, email us with this code.
            </p>
          ) : (
            <p>
              When you remove Fikirtive from your Facebook settings, Meta notifies us and we delete the stored Meta
              connection and access token automatically. You receive a confirmation code from Meta that you can check
              on this page.
            </p>
          )}
          <p>
            To delete your whole Fikirtive account and workspace data, email{" "}
            <a href="mailto:tao@belcort.com" className="underline underline-offset-4">tao@belcort.com</a> — we respond
            within 14 days.
          </p>
        </section>
      </article>
    </main>
  );
}
