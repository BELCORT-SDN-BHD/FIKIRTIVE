/**
 * X (Twitter) publish tier pricing — E4-14 计费缝 (B4 block spec 契约8 / §四 X 锚 / §六.4).
 *
 * FROZEN mapping (GRILL-VERDICTS-2026-07-03:215, founder 方案 A): a post with NO link = 1 displayed
 * credit; a post WITH a link = 4 displayed credits. 1 USD = 10 displayed credits (see spend.ts
 * INTERNAL_PER_DISPLAY). The numbers live HERE in the config layer (宪法 5).
 *
 * SCOPE (B4 W-B4-4): this module is the deterministic tier MAPPING + JUDGEMENT only. It executes NO
 * charge — no reserve, no settle, no ledger, no genRequest. Wiring the X publish path through 缝3
 * reserve→settle is B12/later and MUST pass money-safety-review then. Keeping the money DECISION pure
 * and separate from EXECUTION is deliberate: the direction invariant below is unit-testable with a
 * ZERO spend surface, and nothing here can move real money.
 *
 * DIRECTION INVARIANT (映射不可倒置, frozen — §四 X 锚):
 *   1. 判档 is server-side DETERMINISTIC (regex/entity, never a model judgement — 宪法 10).
 *   2. a post WITH a link is NEVER charged 1cr (倒置 = 漏计费; asserted in tests).
 *   3. AMBIGUOUS (short links, bare domains, redirect wording) → charge the HIGHER tier, 4cr
 *      (就高; the broad-TLD operationalisation is a founder-ack rider, spec §八).
 */

/** A post with no detectable link. Displayed credits (× spend.ts INTERNAL_PER_DISPLAY at charge time). */
export const X_PUBLISH_CREDITS_NO_LINK = 1;
/** A post that contains (or ambiguously contains) a link. Displayed credits. */
export const X_PUBLISH_CREDITS_WITH_LINK = 4;

// A broad, deliberately GREEDY TLD set (就高): over-detecting a link (→ 4cr) is the SAFE direction;
// under-detecting (→ 1cr on a real link) is the FORBIDDEN one (invariant #2). Covers the common
// gTLDs, the money-relevant new gTLDs (.app/.dev/.shop/.store/.site/.link/.page/.zip/.mov), the
// URL-shortener ccTLDs (t.co, bit.ly, buff.ly, linktr.ee, …), and the major ccTLDs. File extensions
// (jpg/png/…) are deliberately absent — they are not TLDs, so a bare "photo.jpg" stays 1cr.
const LINK_TLDS = new Set<string>([
  "com", "net", "org", "io", "co", "app", "dev", "xyz", "info", "biz", "tv", "link", "page", "site",
  "shop", "store", "ai", "so", "sh", "ly", "me", "gg", "to", "ee", "zip", "mov", "online", "live",
  "my", "sg", "id", "ph", "th", "vn", "us", "uk", "ca", "au", "in", "hk", "tw", "jp", "kr", "cn",
  "de", "fr", "es", "it", "nl", "be", "at", "ch", "se", "no", "fi", "dk", "pl", "pt", "ie", "cz",
  "br", "mx", "ar", "cl", "ru", "tr", "ae", "sa", "za", "ng", "ke", "eu",
]);

/**
 * DETERMINISTIC: does this caption contain (or ambiguously contain) a link? Greedy by design (就高):
 *   - any http/https scheme URL
 *   - any `www.`-prefixed host
 *   - any CONTIGUOUS `label.tld` token whose tld is in the broad set (bare domains, short links)
 * A `@handle` mention is NOT a link. Ordinary prose with a space after a period ("in town. Best…")
 * does NOT match — the dot must sit inside a contiguous domain-like token — so the 1cr tier stays
 * usable for normal captions.
 */
export function captionHasLink(caption: string): boolean {
  if (typeof caption !== "string" || !caption) return false;
  const text = caption.toLowerCase();
  if (/https?:\/\/\S/.test(text)) return true; // scheme URL
  if (/(?:^|[^\w@])www\.[a-z0-9]/.test(text)) return true; // www. host
  // Contiguous domain-like token: label(.label)*.tld, no whitespace inside, not preceded by @ (a handle).
  const domain = /(?:^|[^\w@./])([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.([a-z]{2,}))/g;
  let m: RegExpExecArray | null;
  while ((m = domain.exec(text)) !== null) {
    if (LINK_TLDS.has(m[2]!)) return true;
  }
  return false;
}

/**
 * The FROZEN X publish tier in DISPLAYED credits: 1 (no link) or 4 (link/ambiguous). This is the
 * whole money DECISION for an X post; B12 multiplies by spend.ts INTERNAL_PER_DISPLAY at the actual
 * reserve→settle (never here). Mapping is one-directional: link ⇒ 4, so a link can never yield 1.
 */
export function xPublishTierDisplayCredits(caption: string): number {
  return captionHasLink(caption) ? X_PUBLISH_CREDITS_WITH_LINK : X_PUBLISH_CREDITS_NO_LINK;
}
