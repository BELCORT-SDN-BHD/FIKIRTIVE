# Fikirtive Creation staging E2E audit

**Audit date:** 2026-09-04 (MYT)  
**Environment:** `https://web-staging-7901.up.railway.app`  
**Journey:** login -> Create -> product image -> Library reference -> character reference -> starting image -> 5-second video  
**Canvas:** `canvas_b343d43e-e3c0-481a-80ee-3b42f526da59`  
**Thread:** `thread_b343d43e-e3c0-481a-80ee-3b42f526da59`  
**Method:** authenticated, full-desktop Chrome, real generation provider, no application source changes  
**Verdict:** **NO-GO for the official-avatar-to-product-video beta journey**

## Executive decision

The product-image half of the Creation journey works end to end. A user can enter Create, ask Otto for a product image, review an exact-cost confirmation, generate the image, and find the result in Library.

The official-avatar-to-video half does not work on this staging deployment. Three independent gaps block release:

1. The canonical `@` reference picker does not appear in the Canvas composer.
2. The Official avatars Library route is not implemented on staging; the requested route falls back to the general Library and reports `Cast 0`.
3. A fallback two-image-reference request reaches a valid-looking starting-image confirmation, but the generation job fails to start twice with `Couldn't start that - please try again.`

The video step is therefore **not reached**, not passed.

## Version and evidence boundary

| Item | Observed value |
|---|---|
| Staging URL | `https://web-staging-7901.up.railway.app` |
| Audit window | 2026-09-04, approximately 11:55-12:32 MYT |
| Health endpoint | `{"ok":true,"db":"up","worker":"up","workers":{"worker":"up"},"backup":"missing","migrations":"applied"}` |
| Railway edge | `sin1` |
| Server header | `railway-hikari` |
| Deploy fingerprint | Next static assets observed, including `0-u0eab4jg31_.js` and `03jyt9xj3qrzq.js` |
| Commit SHA | **Not exposed by the staging response or health endpoint** |
| Browser | Google Chrome, full desktop viewport |
| Account | Authenticated staging test account |

This report is scoped to the deployment observed above. The engineering team should add a readable release SHA/build identifier to `/api/health` so future E2E reports can bind findings to an exact deployment.

## Journey scorecard

| Step | Result | Evidence |
|---|---|---|
| Email login and post-login landing | PASS | Figure 2 |
| Google OAuth | FAIL | Redirect URI mismatch, Figure 1 |
| Create entry surface | PASS | Minimal composer and Canvas history, Figure 3 |
| Product request and cost confirmation | PASS | 3:4, 1 image, 1 credit, Figure 4 |
| Product generation | PASS | Queued, then completed, Figures 5-6 |
| Generated product available as a Library reference | PASS | Product reference chip, Figures 7 and 10 |
| Canonical `@Xinyi` picker | FAIL | Typing `@` produced no menu; literal mention was not resolved, Figures 7-8 |
| Official avatars Library | FAIL | Route falls back to general Library; `Cast 0`, Figure 9 |
| Fallback two-image reference attachment | PASS | Character and product chips both visible, Figure 10 |
| Starting-image confirmation integrity | PARTIAL | Otto claims both references, but the card exposes only the character reference, Figure 11 |
| Starting-image job creation | FAIL | Two consecutive start attempts failed, Figures 12-13 |
| 5-second 9:16 video generation | NOT REACHED | Blocked by starting-image failure |

## Credit trace

| Event | Balance after event | Credits used |
|---|---:|---:|
| Audit start | 9,999,957.8 | - |
| Product prompt planning | 9,999,955.5 | 2.3 |
| Product image completion | 9,999,954.5 | 1.0 |
| Literal `@Xinyi` resolution attempt | 9,999,953.8 | 0.7 |
| Two-reference planning and confirmation | 9,999,949.9 | 3.9 |
| Starting-image start attempt 1 | 9,999,949.9 | 0.0 |
| Starting-image start attempt 2 | 9,999,949.9 | 0.0 |
| **Total** |  | **7.9 credits** |

The UI correctly did not charge the 1-credit image generation fee when the job failed to start. Provider USD cost is not observable from the staging UI and is therefore not asserted here.

## Release blockers

### CRE-STG-P0-001 - Starting-image job cannot start

**Observed:** The confirmation card is enabled and shows `Generate - 1 credit`. Clicking it twice results in `Couldn't start that - please try again.` No job enters the queue and no output node is created.

**User impact:** The product-plus-character journey stops before the first frame, so the dependent video can never be created.

**Recommended engineering approach:**

1. Trace the confirmation's generation request by correlation ID from web -> action layer -> queue/worker.
2. Log and surface the rejected contract field or provider error instead of reducing every failure to the same string.
3. Add an integration test using two image references and a 9:16 image spec.
4. Add an E2E acceptance test that asserts `confirmation -> queued -> completed` before enabling the dependent video step.

**Acceptance:** One click creates exactly one queued job; a retry cannot duplicate it; the completed starting image appears in the same Canvas and is eligible as the source for a 5-second video.

### CRE-STG-P0-002 - Official avatar reference source is absent

**Observed:** `/library?view=elements&element=official-avatars` renders the general Library, not the approved read-only Official avatars collection. It reports `Cast 0`. Typing `@` in the Canvas composer does not open the approved reference menu.

**User impact:** A founder cannot choose an official avatar or create a canonical entity reference. Literal `@Xinyi` text is correctly rejected by Otto, but the UI provides no recovery path.

**Recommended engineering approach:**

1. Wire Official avatars as a read-only Library source with stable entity IDs.
2. Back the Canvas `@` menu and Library detail action with the same reference contract.
3. Render the selected avatar as a chip carrying entity ID, display name, thumbnail and reference kind.
4. Include a `Use in Canvas` action that returns to the same Canvas without losing existing product references.

**Acceptance:** Selecting `@Xinyi` produces a canonical chip; Otto receives the entity ID; the confirmation shows `Xinyi` and the product reference separately; Official avatars cannot be edited.

### CRE-STG-P1-003 - Confirmation card loses reference transparency

**Observed:** Two reference chips are visible before sending. Otto says it received both. The starting-image confirmation says `Uses your attached image` and lists only `a women From My Videos`.

**User impact:** The user cannot verify whether the exact product is part of the paid action. Approving becomes a guess.

**Recommended engineering approach:** Show every identity-critical reference in the confirmation card, grouped by role: `Character`, `Product`, `Starting frame`.

**Acceptance:** The card lists both attached images, their roles and removable/change actions before charge approval.

### AUTH-STG-P1-001 - Google OAuth redirect URI mismatch

**Observed:** `Continue with Google` returns Google error 400 because the staging callback is not registered.

**Recommended engineering approach:** Add the exact staging callback `https://web-staging-7901.up.railway.app/api/better-auth/callback/google` to the OAuth client, or hide the Google option on environments where it is not configured.

### CRE-STG-P2-004 - Errors are not diagnosable

**Observed:** The only visible failure copy is `Couldn't start that - please try again.` It gives no reason, incident ID, or safe recovery action. The message is also not reliably persistent in the screenshot state.

**Recommended engineering approach:** Use a durable inline error state on the confirmation card with a short error code, correlation ID, retry guidance and a copyable diagnostic reference. Never expose provider secrets.

### LIB-STG-P2-005 - Library accessible names are excessively verbose

**Observed:** Generated assets use the full generation prompt, sometimes duplicated, as the button's accessible name.

**User impact:** Screen-reader navigation becomes exhausting and voice-control targeting becomes unreliable.

**Recommended engineering approach:** Give every asset a concise title and expose prompt detail separately through description/help text.

## What is already strong

- Create is visually minimal and consistent with the approved Canvas shell.
- Confirmation separates planning cost from generation cost and shows exact credits before generation.
- The product generation queue says it bills only on completion.
- Failed starting-image attempts did not charge the 1-credit generation fee.
- Generated products automatically appear in Library and can be attached as references.
- Otto does not pretend that literal `@Xinyi` text is a canonical avatar; it asks for a real saved reference.
- Canvas preserves the completed product node while later conversational work continues.

## Recommended repair order

1. **P0 - Fix starting-image job creation** for multi-reference requests.
2. **P0 - Ship the canonical reference contract** across Official avatars, `@` picker and Canvas chips.
3. **P1 - Make confirmation cards reference-complete** before any paid approval.
4. **P1 - Fix or hide staging Google OAuth.**
5. **P2 - Add diagnosable inline errors and concise accessible names.**
6. Re-run the same Canvas journey: generated product -> official avatar -> 9:16 starting image -> 5-second 9:16 sound-off video -> playback -> Library persistence -> reload persistence.

## Evidence figures

1. `01-google-oauth-redirect-mismatch.png` - staging Google OAuth configuration failure.
2. `02-home-after-login.png` - authenticated landing state.
3. `03-create.png` - Create entry surface.
4. `04-product-confirmation.png` - product cost confirmation.
5. `05-product-queued.png` - queued state and billing copy.
6. `06-product-done.png` - completed product image.
7. `07-avatar-product-request.png` - product reference request with unresolved literal mention.
8. `08-xinyi-reference-blocker.png` - Otto requests a canonical avatar reference.
9. `09-official-avatar-route-missing.png` - official-avatar route falls back to general Library.
10. `10-dual-reference-ready.png` - fallback character and product references attached.
11. `11-starting-image-confirmation-one-reference.png` - confirmation exposes only one of two references.
12. `12-starting-image-could-not-start.png` - first start failure state.
13. `13-starting-image-retry-failed.png` - second start failure state.

## Exit criteria for the next audit

- Exact staging build SHA is visible.
- Google OAuth either works or is intentionally absent.
- Official avatars appear as a read-only Library source.
- Typing `@` opens the canonical reference menu.
- Product and avatar references remain visible through confirmation.
- Starting-image generation queues and completes exactly once.
- A 5-second 9:16 sound-off video queues, completes, plays, downloads and persists after reload.
- Both outputs appear in general generation history and retain their Canvas/thread provenance.

