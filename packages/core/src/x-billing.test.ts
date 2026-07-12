import { describe, it, expect } from "vitest";
import {
  captionHasLink,
  xPublishTierDisplayCredits,
  X_PUBLISH_CREDITS_NO_LINK,
  X_PUBLISH_CREDITS_WITH_LINK,
} from "./x-billing.js";

// Captions that DO contain (or ambiguously imply) a link → 就高 4cr. The direction invariant is that
// NONE of these may EVER be priced at the 1cr no-link tier (倒置 = 漏计费). Includes NODE-276 fix-4
// counterexamples: redirect wording WITH NO domain, and a real domain on an UNLISTED tld.
const WITH_LINK = [
  "Check it out https://rotibulan.my/menu",
  "New drop http://example.com",
  "HTTPS://EXAMPLE.COM works too",
  "Order at www.rotibulan.my",
  "Grab yours at rotibulan.my today",
  "shop.rotibulan.store now open",
  "download roti.app for offers",
  "fresh at rotibulan.bakery",           // real domain, tld NOT in any hand-maintained list
  "Link in bio: linktr.ee/rotibulan",
  "Short link t.co/abc123",
  "bit.ly/roti-promo is live",
  "New collection! Link in bio",         // redirect wording, NO detectable domain
  "见简介购买",                            // CJK redirect wording, no domain
  "DM me for the link",                  // redirect wording
  "Swipe up to shop",                    // redirect wording, no domain
  "Swipe up on my photo.jpg",            // redirect wording (also a domain-shaped token)
];

// Plain captions with NO link and NO redirect intent — must stay at the 1cr tier. Includes tricky
// non-links: handles, prices, abbreviations, prose with period+space, plain years.
const NO_LINK = [
  "Fresh roti every morning at our KL store!",
  "Follow @rotibulanKL for daily specials",
  "Only RM3.50 this week",
  "Open Mon-Fri, 8am-5pm",
  "Best nasi lemak in town. Come hungry.",
  "e.g. try our new sambal",
  "No links here, just vibes",
  "Handmade with love since 2020",
];

describe("x-billing · captionHasLink (deterministic link detection)", () => {
  it("detects links / redirect wording / ambiguous domains (就高)", () => {
    for (const c of WITH_LINK) expect(captionHasLink(c), c).toBe(true);
  });
  it("does not flag ordinary link-free captions", () => {
    for (const c of NO_LINK) expect(captionHasLink(c), c).toBe(false);
  });
  it("handles empty / non-string safely", () => {
    expect(captionHasLink("")).toBe(false);
    expect(captionHasLink(undefined as unknown as string)).toBe(false);
  });
});

describe("x-billing · tier mapping direction invariant (映射不可倒置)", () => {
  it("frozen values: no link = 1cr, link = 4cr", () => {
    expect(X_PUBLISH_CREDITS_NO_LINK).toBe(1);
    expect(X_PUBLISH_CREDITS_WITH_LINK).toBe(4);
    expect(xPublishTierDisplayCredits("just a caption")).toBe(X_PUBLISH_CREDITS_NO_LINK);
    expect(xPublishTierDisplayCredits("see https://x.com")).toBe(X_PUBLISH_CREDITS_WITH_LINK);
  });
  it("a post WITH a link / redirect wording is NEVER priced at the 1cr tier", () => {
    for (const c of WITH_LINK) {
      expect(xPublishTierDisplayCredits(c), c).toBe(X_PUBLISH_CREDITS_WITH_LINK);
      expect(xPublishTierDisplayCredits(c), c).not.toBe(X_PUBLISH_CREDITS_NO_LINK);
    }
  });
});
