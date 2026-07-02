import "server-only";
import { createHash } from "node:crypto";
import { prisma as defaultPrisma, type PrismaClient } from "@fikirtive/db";
import { newId } from "@fikirtive/core";
import { fetchAndExtract } from "./fetch-extract";

// Block S1 (Otto research) — Nous-style page cache read.
//
// fetchAndExtract already gives us SSRF-guarded, HTML-stripped clean page text. This layer
// caches that text once per URL (keyed by a hash of the normalized URL) and hands it back
// page-by-page on demand, so a long research loop pays the network+extract cost once and
// then walks the page cheaply — the Nous "cache clean page text once, read it page-by-page"
// trick that drives most of their 49× token saving.
//
// $0: no GenJob, no spend, no metering. The table caches PUBLIC pages, so it is not owner
// scoped — a URL fetched by one org may be served from cache to another (same public bytes).

/** Chars per page when slicing cached text. A page-2 read returns chars [4000, 8000). */
export const PAGE_CHARS = 4000;

/** Cache entries older than this are treated as expired and refetched. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Conservative URL normalization for the cache key: lowercase the host and drop the
 * #fragment. Path, query (including param order + case), and trailing slash are preserved
 * as-is — we do NOT canonicalize aggressively, because two URLs that differ only in query
 * order can legitimately return different pages.
 */
export function normalizeUrl(raw: string): string {
  const u = new URL(raw);
  u.hostname = u.hostname.toLowerCase();
  u.hash = "";
  return u.href;
}

function urlHashOf(raw: string): string {
  return createHash("sha256").update(normalizeUrl(raw)).digest("hex");
}

type FetchAndExtract = (url: string) => Promise<{ url: string; title?: string; text: string }>;

export type ReadPageResult = {
  url: string;
  title: string;
  page: number;
  totalPages: number;
  text: string;
  stale: boolean;
};

type Deps = { prisma: PrismaClient; fetch: FetchAndExtract };

/**
 * readPageCached — read one page of a web page's clean text, using the DB cache.
 *
 * - Cache lookup by hash of the normalized URL.
 * - Fresh (fetchedAt within 7 days) → serve cached {title,text}.
 * - Otherwise fetch via fetchAndExtract, upsert the row, serve the fresh text.
 * - Degradation: if the fetch throws AND a cache row exists (even expired), serve that
 *   stale row with stale:true. If the fetch throws and there is NO cache row, rethrow so
 *   the caller can surface an error.
 * - Paging: text is sliced into PAGE_CHARS chunks. `page` outside [1..totalPages] returns
 *   the requested page number with empty text and the correct totalPages (no throw, no
 *   silent clamp — the caller sees empty text and knows the real page count).
 */
export async function readPageCached(
  url: string,
  page = 1,
  deps: Deps = { prisma: defaultPrisma, fetch: fetchAndExtract },
): Promise<ReadPageResult> {
  const urlHash = urlHashOf(url);
  const existing = await deps.prisma.webPageCache.findUnique({ where: { urlHash } });

  const fresh = existing && Date.now() - existing.fetchedAt.getTime() < MAX_AGE_MS;

  let title: string;
  let text: string;
  let stale = false;

  if (fresh) {
    title = existing.title;
    text = existing.text;
  } else {
    try {
      const fetched = await deps.fetch(url);
      title = fetched.title ?? "";
      text = fetched.text;
      await deps.prisma.webPageCache.upsert({
        where: { urlHash },
        create: { id: newId(), urlHash, url, title, text, fetchedAt: new Date() },
        update: { url, title, text, fetchedAt: new Date() },
      });
    } catch (err) {
      // Degrade to an expired cache row if we have one; otherwise surface the failure.
      if (existing) {
        title = existing.title;
        text = existing.text;
        stale = true;
      } else {
        throw err;
      }
    }
  }

  const totalPages = Math.max(1, Math.ceil(text.length / PAGE_CHARS));
  const start = (page - 1) * PAGE_CHARS;
  const slice = page >= 1 && page <= totalPages ? text.slice(start, start + PAGE_CHARS) : "";

  return { url, title, page, totalPages, text: slice, stale };
}
