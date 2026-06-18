import { NextRequest, NextResponse } from "next/server";
import { storage, mimeOf, kindOf } from "@/lib/storage";
import { parseStorageKey } from "@artlio/core";
import { auth, allowed } from "@/auth";

/**
 * Dev file serving for LocalDiskStorage. R2 presigned GETs replace this in T4.
 * Range/206 support is required: Safari refuses to play <video> from servers
 * that ignore Range, and seeking needs it everywhere.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ key: string[] }> },
) {
  const session = await auth();
  if (!allowed(session?.user?.email)) {
    return NextResponse.redirect(new URL("/login", req.url), { status: 302 });
  }
  const { key } = await ctx.params; // Next 16: params are async
  const joined = key.join("/");
  try {
    const { ext } = parseStorageKey(joined); // rejects traversal/malformed keys
    // r2 driver: hand the client a short-lived presigned GET — R2 serves
    // Range/206 natively
    const presigned = await storage.presignedGet(joined);
    if (presigned) {
      // the signed URL must not linger in caches or leak via referrers
      return NextResponse.redirect(presigned, {
        status: 302,
        headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" },
      });
    }
    const bytes = await storage.get(joined);
    const total = bytes.byteLength;
    const headers: Record<string, string> = {
      "Content-Type": mimeOf(ext),
      "Cache-Control": "private, max-age=31536000, immutable", // content-addressed = immutable
      "Accept-Ranges": "bytes",
      "X-Content-Type-Options": "nosniff",
      // images/videos render inline; anything else downloads instead of executing
      ...(kindOf(ext) === "other" ? { "Content-Disposition": "attachment" } : {}),
    };

    const range = req.headers.get("range");
    const match = range?.match(/^bytes=(\d*)-(\d*)$/);
    if (match && (match[1] || match[2])) {
      const start = match[1] ? parseInt(match[1], 10) : total - parseInt(match[2], 10);
      const end = match[1] && match[2] ? Math.min(parseInt(match[2], 10), total - 1) : total - 1;
      if (Number.isNaN(start) || start < 0 || start > end || start >= total) {
        return new NextResponse(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${total}` },
        });
      }
      return new NextResponse(Buffer.from(bytes.subarray(start, end + 1)), {
        status: 206,
        headers: { ...headers, "Content-Range": `bytes ${start}-${end}/${total}` },
      });
    }

    return new NextResponse(Buffer.from(bytes), { headers });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
