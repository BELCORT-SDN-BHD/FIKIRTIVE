/**
 * product-extract — Layer 1 of P1-01 (deterministic product-page parsing, $0, pure).
 *
 * Reads a raw HTML string and pulls a product DRAFT from machine-readable markup,
 * in priority order: JSON-LD `Product` → Open Graph → `<title>`/first `<img>` fallback.
 * No IO, no LLM, no network — the caller fetches the HTML (SSRF-hardened) and, if this
 * draft is too thin, escalates to an LLM (Layer 2). `filled` lets the caller judge thinness.
 *
 * Field lengths are clamped to the productRecordData limits so a pathological page can't
 * produce a draft that later fails to save. Values are display text only (see brand-records).
 */

export interface ProductDraft {
  name?: string;
  /** Display text only ("MYR 49.00"). NEVER parsed into billing/credits. */
  price?: string;
  description?: string;
  /** Absolute URL, resolved against the page URL. Display/preview only in v1. */
  imageUrl?: string;
  /** The page the draft came from. Always present. */
  sourceUrl: string;
  /** Which of name/price/description/imageUrl were extracted — for thinness checks. */
  filled: string[];
}

type Partial4 = { name?: string; price?: string; description?: string; imageUrl?: string };

const LIMITS = { name: 120, price: 60, description: 500, imageUrl: 500 } as const;

export function extractProductDraft(html: string, baseUrl: string): ProductDraft {
  const src = typeof html === "string" ? html : "";

  const jsonld = fromJsonLd(src);
  const og = fromOpenGraph(src);

  const name = jsonld.name ?? og.name ?? titleTag(src);
  const price = jsonld.price ?? og.price;
  const description = jsonld.description ?? og.description;
  const rawImage = jsonld.imageUrl ?? og.imageUrl ?? firstImg(src);
  const imageUrl = resolveUrl(rawImage, baseUrl);

  const clamped: Partial4 = {
    name: clamp(name, LIMITS.name),
    price: clamp(price, LIMITS.price),
    description: clamp(description, LIMITS.description),
    imageUrl: clamp(imageUrl, LIMITS.imageUrl),
  };

  const filled = (["name", "price", "description", "imageUrl"] as const).filter(
    (k) => clamped[k] != null && clamped[k] !== "",
  );

  return { ...clamped, sourceUrl: baseUrl, filled: [...filled] };
}

// ---------------------------------------------------------------------------
// JSON-LD (highest fidelity — structured Product schema)
// ---------------------------------------------------------------------------

function fromJsonLd(html: string): Partial4 {
  const out: Partial4 = {};
  const re = /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(m[1]!.trim());
    } catch {
      continue; // malformed block — skip, don't throw
    }
    const product = findProduct(parsed);
    if (!product) continue;
    if (typeof product.name === "string") out.name ??= product.name.trim();
    if (typeof product.description === "string") out.description ??= product.description.trim();
    const img = normalizeImage(product.image);
    if (img) out.imageUrl ??= img;
    const price = normalizeOffer(product.offers);
    if (price) out.price ??= price;
    if (out.name && out.price && out.description && out.imageUrl) break;
  }
  return out;
}

type JsonObj = Record<string, unknown>;

/** Depth-first search for the first object whose @type is (or includes) "Product". */
function findProduct(node: unknown): JsonObj | null {
  if (Array.isArray(node)) {
    for (const el of node) {
      const found = findProduct(el);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== "object") return null;
  const obj = node as JsonObj;
  if (isProductType(obj["@type"])) return obj;
  if ("@graph" in obj) {
    const found = findProduct(obj["@graph"]);
    if (found) return found;
  }
  return null;
}

function isProductType(t: unknown): boolean {
  const one = (v: unknown) => typeof v === "string" && v.split("/").pop() === "Product";
  return Array.isArray(t) ? t.some(one) : one(t);
}

function normalizeImage(image: unknown): string | undefined {
  if (typeof image === "string") return image.trim() || undefined;
  if (Array.isArray(image)) {
    for (const el of image) {
      const s = normalizeImage(el);
      if (s) return s;
    }
    return undefined;
  }
  if (image && typeof image === "object") {
    const url = (image as JsonObj).url;
    return typeof url === "string" ? url.trim() || undefined : undefined;
  }
  return undefined;
}

function normalizeOffer(offers: unknown): string | undefined {
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (!first || typeof first !== "object") return undefined;
  const o = first as JsonObj;
  const spec = (o.priceSpecification && typeof o.priceSpecification === "object"
    ? (o.priceSpecification as JsonObj)
    : {}) as JsonObj;
  const amount = o.price ?? o.lowPrice ?? spec.price;
  const currency = o.priceCurrency ?? spec.priceCurrency;
  return formatPrice(amount, currency);
}

function formatPrice(amount: unknown, currency: unknown): string | undefined {
  if (amount == null || amount === "") return undefined;
  const a = typeof amount === "number" ? String(amount) : typeof amount === "string" ? amount.trim() : "";
  if (!a) return undefined;
  const c = typeof currency === "string" ? currency.trim() : "";
  return c ? `${c} ${a}` : a;
}

// ---------------------------------------------------------------------------
// Open Graph / product meta tags
// ---------------------------------------------------------------------------

function fromOpenGraph(html: string): Partial4 {
  const meta = new Map<string, string>();
  const re = /<meta\b[^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const tag = m[0];
    const key = attr(tag, "property") ?? attr(tag, "name");
    const content = attr(tag, "content");
    if (key && content != null) meta.set(key.toLowerCase(), content);
  }
  const out: Partial4 = {};
  const title = meta.get("og:title");
  if (title) out.name = decodeEntities(title).trim();
  const desc = meta.get("og:description");
  if (desc) out.description = decodeEntities(desc).trim();
  const image = meta.get("og:image");
  if (image) out.imageUrl = image.trim();
  const price = formatPrice(meta.get("product:price:amount"), meta.get("product:price:currency"));
  if (price) out.price = price;
  return out;
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : undefined;
}

// ---------------------------------------------------------------------------
// Plain-HTML fallback
// ---------------------------------------------------------------------------

function titleTag(html: string): string | undefined {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return undefined;
  const t = decodeEntities(m[1]!).replace(/\s+/g, " ").trim();
  return t || undefined;
}

function firstImg(html: string): string | undefined {
  const m = html.match(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/i);
  return m ? m[1]!.trim() : undefined;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function resolveUrl(u: string | undefined, base: string): string | undefined {
  if (!u) return undefined;
  try {
    return new URL(u, base).href;
  } catch {
    return undefined;
  }
}

function clamp(v: string | undefined, max: number): string | undefined {
  if (v == null) return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x27;/gi, "'");
}
