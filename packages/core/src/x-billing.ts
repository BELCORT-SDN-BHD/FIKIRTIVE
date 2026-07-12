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
 *   3. AMBIGUOUS (short links, bare domains on ANY tld, redirect wording with no domain at all)
 *      → charge the HIGHER tier, 4cr (就高, founder-ack rider, spec §八).
 */

/** A post with no detectable link. Displayed credits (× spend.ts INTERNAL_PER_DISPLAY at charge time). */
export const X_PUBLISH_CREDITS_NO_LINK = 1;
/** A post that contains (or ambiguously implies) a link. Displayed credits. */
export const X_PUBLISH_CREDITS_WITH_LINK = 4;

// Redirect-intent wording that implies an off-platform destination even with NO visible URL
// (就高 → 4cr; NODE-276 fix 4: "Link in bio"-class captions must not slip to 1cr). Lowercase; matched
// as substrings. Deliberately broad — over-detecting a redirect is the SAFE direction, under-
// detecting a real link is the FORBIDDEN one. CJK variants included (captions may be 华语).
const REDIRECT_PHRASES = [
  "link in bio", "link in my bio", "linkinbio", "link in profile", "bio link", "url in bio",
  "check my bio", "see my bio", "check the link", "click the link", "tap the link", "link below",
  "swipe up", "dm me", "dm us", "dm for", "message me for",
  "见简介", "简介链接", "主页链接", "链接见", "私信", "点击链接", "戳链接",
];

// A domain-shaped token: label(.label)*.tld with a 2+-letter tld — GENERIC (not a hand-maintained TLD
// whitelist) AND Unicode-aware (\p{L}/\p{N} under the /u flag), so IDN bare domains — 例子.公司,
// example.中国, .みんな, and punycode xn--… — are caught, not just ASCII (NODE-276-R2 fix 4: an
// ASCII-only regex leaked IDN domains to 1cr in MY/CJK markets; MUST NOT under-charge a real link).
// Not preceded by @ (a handle); no whitespace inside. Over-matches file-ext-like "photo.jpg" → 4cr,
// the acceptable 就高 direction. The dot is ASCII "." (fullwidth 。 in CJK prose won't false-match).
const DOMAIN_RE = /(?:^|[^\p{L}\p{N}@./])[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/u;

/**
 * DETERMINISTIC: does this caption contain (or ambiguously imply) a link? Returns true (→ 4cr) for
 * ANY of: an http/https scheme URL · a `www.` host · any domain-shaped token (any tld, incl. IDN) · any
 * redirect-intent phrase (link in bio / 见简介 / DM me / swipe up …) even with no URL. Ordinary prose
 * with a space after a period ("in town. Best…") does NOT match — the dot must sit inside a
 * contiguous domain-like token — so the 1cr tier stays usable for normal captions.
 */
export function captionHasLink(caption: string): boolean {
  if (typeof caption !== "string" || !caption) return false;
  const text = caption.toLowerCase();
  if (/https?:\/\/\S/.test(text)) return true; // scheme URL
  if (/(?:^|[^\w@])www\.[a-z0-9]/.test(text)) return true; // www. host
  if (DOMAIN_RE.test(text)) return true; // any domain-shaped token, any tld
  for (const p of REDIRECT_PHRASES) if (text.includes(p)) return true; // redirect wording, no domain needed
  return false;
}

/**
 * The FROZEN X publish tier in DISPLAYED credits: 1 (no link) or 4 (link/redirect/ambiguous). This is
 * the whole money DECISION for an X post; B12 multiplies by spend.ts INTERNAL_PER_DISPLAY at the
 * actual reserve→settle (never here). Mapping is one-directional: link ⇒ 4, so a link can never yield 1.
 */
export function xPublishTierDisplayCredits(caption: string): number {
  return captionHasLink(caption) ? X_PUBLISH_CREDITS_WITH_LINK : X_PUBLISH_CREDITS_NO_LINK;
}
