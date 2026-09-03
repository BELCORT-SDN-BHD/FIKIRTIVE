import { NextRequest, NextResponse } from "next/server";
import { storage, mimeOf, kindOf } from "@/lib/storage";
import { parseStorageKey, keyOwnerMatches } from "@fikirtive/core";
import { prisma } from "@fikirtive/db";
import { auth } from "@/lib/better-auth/compat";
import { allowed } from "@/lib/allowlist";
import { requireOwner } from "@/lib/auth-guard";
import { DOWNLOAD_FLAG, DOWNLOAD_NAME, safeDownloadFileName } from "@/lib/download-url";

/**
 * 把驱动给的字节迭代器接成响应体 —— 整件东西不进内存,一段视频不再在服务器上摊开。
 * 浏览器中断下载时 `cancel` 会关掉底层流(local 是 fd,r2 是 S3 连接)。
 */
function toWebStream(source: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await iterator.next();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    async cancel(reason) {
      await iterator.return?.(reason);
    },
  });
}

/**
 * 同源附件下载(走查 P0-2)。内联播放那条老路一个字节没动 —— 这条只在 `?download=1` 时走。
 *
 * 为什么不是把预签名地址交给浏览器:`download` 属性跨源被忽略,商家会被导航去 R2 的裸文件
 * 而不是存下片子(详见 `lib/download-url.ts`)。所以字节由我们自己转发,R2 的地址不出这个进程。
 *
 * 租户两道:key 的 owner 命名空间已在调用处比对过;这里再要求这件素材在**当前 org 名下且未
 * 软删** —— 删掉的东西不该还能被一条旧链接拖下来。
 */
async function attachmentResponse(
  key: string,
  ownerId: string,
  contentHash: string,
  ext: string,
  requestedName: string | null,
): Promise<NextResponse> {
  const asset = await prisma.asset.findFirst({
    where: { ownerId, contentHash, deletedAt: null },
    select: { id: true },
  });
  if (!asset) return new NextResponse("Not found", { status: 404 });

  const named = safeDownloadFileName(requestedName, "");
  // 洗过的名字里可能一个点都没有(商家的提示词全是中文时就会这样),补上扩展名,
  // 否则存下来的是一个系统打不开的无后缀文件。
  const fileName = named.includes(".") ? named : `${named || contentHash.slice(0, 12)}.${ext}`;

  return new NextResponse(toWebStream(await storage.readStream(key)), {
    headers: {
      "Content-Type": mimeOf(ext),
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

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
  if (!(await allowed(session?.user?.email))) {
    return NextResponse.redirect(new URL("/login", req.url), { status: 302 });
  }
  // P3: resolve the caller's org and reject any key not in their namespace.
  const owner = await requireOwner();
  if ("error" in owner) {
    return NextResponse.redirect(new URL("/login", req.url), { status: 302 });
  }
  const { key } = await ctx.params; // Next 16: params are async
  const joined = key.join("/");
  // Cross-tenant guard: the key's owner namespace must match the resolved owner.
  if (!keyOwnerMatches(joined, owner.ownerId)) {
    return new NextResponse("Not found", { status: 404 });
  }
  try {
    const { contentHash, ext } = parseStorageKey(joined); // rejects traversal/malformed keys
    // 走查 P0-2:`?download=1` 走同源附件转发,不把 R2 地址交给浏览器。
    const query = new URL(req.url).searchParams;
    if (query.get(DOWNLOAD_FLAG) === "1") {
      return await attachmentResponse(joined, owner.ownerId, contentHash, ext, query.get(DOWNLOAD_NAME));
    }
    // r2 driver: hand the client a presigned GET — R2 serves Range/206 natively.
    // F41: 1h TTL (default is 300s) — a 5-min URL expired mid-playback/seek on longer videos.
    // The content is immutable (content-addressed), so a longer-lived signed GET is safe.
    const presigned = await storage.presignedGet(joined, 3600);
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
