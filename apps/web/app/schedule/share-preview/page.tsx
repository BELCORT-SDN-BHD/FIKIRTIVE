import { headers } from "next/headers";
import { publishSurfaceCopy } from "@fikirtive/core/schedule-draft";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { loadSharePreview, type SharePreviewPost } from "@/lib/share-preview-view";

/**
 * The page a share-preview link actually opens (B0-28).
 *
 * `sharePostPreview` has been minting `${BETTER_AUTH_URL}/schedule/share-preview?t=<token>` since
 * B0-28, and Otto has been handing that link to merchants to forward to clients. This route did
 * not exist, so every one of those links opened a 404 on somebody else's screen. Nothing about
 * the link's shape changes here — the address the minter already prints is the address this file
 * answers, so links minted before it shipped work the moment it does.
 *
 * ── IT IS OUTSIDE THE AUTH WALL, AND THAT IS THE POINT ───────────────────────────────────────
 * `proxy.ts` excludes exactly `schedule/share-preview` (bounded, like /verify-email and
 * /api/ops/dlq): a client with no account must be able to open it. The link's HMAC plus its live
 * mint row is the ONLY authorization, and `lib/share-preview-view.ts` is the only way this page
 * can reach data.
 *
 * DO NOT add an `app/schedule/layout.tsx` that gates its children (W2 builds the merchant
 * calendar at `/schedule`). A layout above this page runs for this page too, and an auth gate up
 * there would send every reviewer to /login — the exact dead end this file exists to remove.
 * `lib/__tests__/share-preview-page.test.ts` fails if such a layout appears.
 *
 * ── READ-ONLY, AND HONEST ABOUT WHAT IT IS ──────────────────────────────────────────────────
 * There is nothing to press: no approve, no edit, no sign-in, no link back into the workspace. It
 * shows one post's caption, media, first comment and the slot the merchant picked, and it says in
 * the merchant's own authority copy (`publishSurfaceCopy`) that publishing is not switched on —
 * because a date on a screen reads as a promise to whoever is looking at it, and this screen is
 * read by the one person who has no other way to find out.
 */

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Shared post preview · Fikirtive",
  // A link a merchant mails to one client is not a page for search engines to keep.
  robots: { index: false, follow: false },
};

export default async function SharePreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ t?: string | string[] }>;
}) {
  const { t } = await searchParams;
  // A repeated `?t=` arrives as an array; fail closed rather than picking one for the caller.
  const view = typeof t === "string" ? await loadSharePreview(t, await headers()) : ({ state: "unavailable" } as const);

  return (
    <main className="gb flex min-h-dvh w-full flex-col items-center bg-background px-4 py-10 sm:px-6">
      <div className="flex w-full max-w-[560px] flex-col gap-6">
        {view.state === "post" ? <PostPreview post={view} /> : <Notice state={view.state} />}
      </div>
    </main>
  );
}

/** Every refusal wears one of these two, and "unavailable" covers every reason at once —
 *  expired, revoked, deleted, never existed, not yours. A reader cannot tell them apart, which
 *  is deliberate: the alternative tells anyone sweeping links which posts are real. */
function Notice({ state }: { state: "unavailable" | "busy" }) {
  const busy = state === "busy";
  return (
    <Card className="items-center gap-3 text-center">
      <h1 className="text-lg font-semibold text-foreground">
        {busy ? "Too many requests right now" : "This preview isn't available"}
      </h1>
      <p className="max-w-[40ch] text-sm leading-5 text-muted-foreground">
        {busy
          ? "This link has been opened a lot from your network in the last hour. Wait a little and refresh the page."
          : "The link may have expired, or the person who shared it may have turned it off. Ask them for a new link."}
      </p>
    </Card>
  );
}

function PostPreview({ post }: { post: SharePreviewPost }) {
  const copy = publishSurfaceCopy();
  return (
    <>
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">Shared post preview</h1>
        <p className="text-sm leading-5 text-muted-foreground">
          You&rsquo;re looking at one post, shared with you to read. Nothing here can be changed from this
          page, and no account is needed to see it.
        </p>
      </header>

      <Card className="gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{post.channelLabel}</Badge>
          <Badge variant="info">Read-only</Badge>
        </div>

        {post.media.length > 0 && (
          <div className="flex flex-col gap-2">
            {post.media.map((item, index) =>
              item.kind === "video" ? (
                <video
                  key={item.src}
                  src={item.src}
                  controls
                  playsInline
                  className="w-full rounded-[14px] border border-border bg-secondary"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- signed, short-lived proxy URL; the Next image loader would need this private host allow-listed
                <img
                  key={item.src}
                  src={item.src}
                  alt={post.media.length > 1 ? `Image ${index + 1} of ${post.media.length}` : "Post image"}
                  width={item.width ?? undefined}
                  height={item.height ?? undefined}
                  className="w-full rounded-[14px] border border-border bg-secondary object-cover"
                />
              ),
            )}
          </div>
        )}

        {post.mediaWithheld && (
          <p className="text-sm leading-5 text-muted-foreground">
            The images on this post can&rsquo;t be shown here. Everything else is exactly as it was written.
          </p>
        )}

        {post.caption.length > 0 && (
          <p className="text-[15px] leading-[22px] whitespace-pre-wrap text-foreground">{post.caption}</p>
        )}

        {post.firstComment && (
          <>
            <Separator />
            <p className="text-sm leading-5 whitespace-pre-wrap text-muted-foreground">
              First comment: {post.firstComment}
            </p>
          </>
        )}

        <Separator />
        <p className="text-sm leading-5 text-muted-foreground">
          Scheduled for {formatSlot(post.scheduledAtMs, post.scheduledTz)}.
        </p>
      </Card>

      {/* The publishing truth, from the ONE authority every publish surface reads
          (@fikirtive/core/schedule-draft). A reviewer reads a date and hears a promise; these are
          the two sentences that say what the date does and does not mean. */}
      <Card className="gap-2 bg-secondary shadow-none">
        <p className="text-sm leading-5 text-foreground">{copy.fact}</p>
        <p className="text-sm leading-5 text-muted-foreground">{copy.real}</p>
      </Card>

      <p className="text-xs leading-4 text-muted-foreground">
        This link stops working on {formatSlot(post.linkExpiresAtMs, post.scheduledTz)}, or sooner if the
        person who shared it turns it off.
      </p>
    </>
  );
}

/**
 * The slot in the zone the merchant picked it in, so a reviewer in another country reads the
 * merchant's Tuesday rather than their own. An unusable zone string falls back to UTC and SAYS
 * UTC — a time with the wrong zone silently attached is worse than one that names a zone the
 * reader did not expect.
 */
function formatSlot(epochMs: number, timeZone: string): string {
  const options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  };
  try {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone }).format(new Date(epochMs));
  } catch {
    return new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(new Date(epochMs));
  }
}
