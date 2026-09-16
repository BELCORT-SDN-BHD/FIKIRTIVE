/**
 * Journey 28 — the old bookmarks (R3-F10).
 *
 * The spec's promise is a NUMBER, not a source-code shape: 「每一条旧地址都 **307**，永不 404」
 * (`docs/specs/wave2-shell.md` §2.5). Every unit fence in this repo could only ever prove that a
 * route file CALLS `redirect()` — and that is a different claim. What a merchant's browser, a
 * crawler, a link checker or `curl` actually receives is decided by whether Next finished the
 * redirect BEFORE it flushed the shell, and a `loading.tsx` anywhere above the segment makes it
 * flush first: HTTP 200, a skeleton, and the jump demoted to a client-side navigation.
 *
 * That is exactly what three of the six rows were doing (measured on a built server, 2026-09-15,
 * before the fix):
 *
 *     /campaign            307 → /            /schedule            200 + skeleton
 *     /campaign/calendar   307 → /            /schedule/analytics  200 + skeleton
 *     /crm                 307 → /            /library/editor      200 + skeleton
 *
 * So this journey asks the running server the only question that matters, for EVERY row of the
 * authoritative table, with redirects switched OFF so the status line is readable. The table is
 * the enumeration source — nobody hand-copies the six addresses here, and a seventh row added
 * without a working route file turns this red on the next run.
 *
 * SIGNED IN, because the wall answers first: a signed-out GET of a parked address is the AUTH
 * redirect (307 → /login?from=…), which would pass a naive status check while proving nothing
 * about the parked route underneath. Journey 1 owns the walled-out half.
 */
import { test, expect } from "@playwright/test";
import { MERCHANT_NAV_REDIRECTS, SHELL_ROUTES } from "../../packages/core/dist/navigation.js";
import { seedWorkspace } from "../support/seed.js";
import { signIn } from "../support/auth.js";

test("R3-F10 — every parked address answers a real 307 to the destination its own table names", async ({
  page,
}) => {
  const ws = await seedWorkspace({
    slug: "parked",
    workspaceName: "Parked Cafe",
    personName: "Pari",
    openingGrant: 0,
  });
  await signIn(page, ws);

  expect(MERCHANT_NAV_REDIRECTS.length, "the table shrank or grew — check that on purpose").toBe(6);

  for (const row of MERCHANT_NAV_REDIRECTS) {
    // `page.request` carries this page's cookie jar, so these are the SAME merchant's requests.
    const res = await page.request.get(row.from, { maxRedirects: 0 });

    expect(res.status(), `${row.from} did not answer a redirect (${row.why})`).toBe(307);
    expect(res.headers()["location"], `${row.from} landed somewhere its own table does not name`).toBe(
      row.to,
    );
  }

  // The other half of the same defect, and the reason the three fixed rows are Route Handlers
  // rather than a rearranged `loading.tsx`: a parked address should not render the whole app
  // shell — root layout, session read and all — only to throw it away. An empty body is that,
  // witnessed. (The three rows that already answered 307 still render a page body first; fixing
  // that is not this ticket.)
  for (const from of [SHELL_ROUTES.schedule, SHELL_ROUTES.analytics, SHELL_ROUTES.edit]) {
    const res = await page.request.get(from, { maxRedirects: 0 });
    expect((await res.body()).byteLength, `${from} still rendered a page before redirecting`).toBe(0);
  }
});

test("R3-F10 — the public share page under /schedule is not swept up by the parked redirect", async ({
  request,
}) => {
  // `/schedule/share-preview` lives UNDER a parked prefix but is a live, wall-free surface a
  // client with no account must be able to open (apps/web/app/schedule/share-preview/page.tsx
  // spells out why no layout may gate it). This is the assertion that stops a future "just put
  // the redirect in app/schedule/layout.tsx" from silently closing that door.
  //
  // The `request` fixture is a FRESH context with no session — the state a mailed link arrives in.
  const res = await request.get(SHELL_ROUTES.publicSharePreview, { maxRedirects: 0 });

  expect(res.status(), "the share link got redirected instead of opening").toBe(200);
  // No token, so the page draws its one refusal — which is still the share page answering, rather
  // than a parked redirect or the auth wall.
  expect(await res.text()).toContain("The link may have expired");
});
