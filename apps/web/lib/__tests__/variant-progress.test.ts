/**
 * #781 r2 P1 — "Make it again" charges the merchant; these rules are what makes the result they
 * paid for appear.
 *
 * The regression these cover is a money-visibility one. The worker APPENDS a regenerated image to
 * the variant instead of replacing the old row, so:
 *   - a tile that shows refs[0] shows the picture the merchant paid to move on from, permanently,
 *     no matter how many times they pay;
 *   - a poller that only watches image-less variants never notices the new image arriving, so the
 *     screen never changes after a paid click — and the obvious next move is to pay again;
 *   - and (#781 r3) a poller that calls a finish "news" only when it watched the job go from
 *     running to done is blind to the one window it can never watch: the page snapshot is ALWAYS
 *     older than the poll, so a job that finishes in between reports DONE on the very first tick,
 *     with nothing before it to compare against. The tile then keeps the old image until a full
 *     page reload — the same money-visibility bug by a different route.
 *
 * All three are decided by the pure rules in lib/variant-progress, which is why they can be tested
 * for real here (apps/web's vitest include list covers lib/, not components/).
 */
import { describe, it, expect } from "vitest";
import {
  isVariantRunning,
  latestVariantRef,
  variantNeedsReread,
  variantShowsJobResult,
  variantsToWatch,
  type VariantJobs,
  type VariantJobView,
} from "../variant-progress";

const ref = (id: string) => ({ id, url: `https://example.test/${id}.png` });

describe("the tile shows what the merchant last paid for, not the first thing they ever got", () => {
  it("picks the NEWEST image (refs arrive position-ascending; the worker appends)", () => {
    const variant = { id: "var-1", refs: [ref("first"), ref("second"), ref("newest")] };
    expect(latestVariantRef(variant)).toEqual(ref("newest"));
    // the old bug, stated as the thing that must NOT come back
    expect(latestVariantRef(variant)).not.toEqual(variant.refs[0]);
  });

  it("a variant with one image shows it; a variant with none shows nothing", () => {
    expect(latestVariantRef({ refs: [ref("only")] })).toEqual(ref("only"));
    expect(latestVariantRef({ refs: [] })).toBeUndefined();
  });
});

describe("a paid generation is watched until the server says it finished", () => {
  const withImage = { id: "var-image", refs: [ref("old")] };
  const noImage = { id: "var-empty", refs: [] };

  it("a re-run of a variant that ALREADY has an image is still running (the old image is not proof)", () => {
    const jobs: VariantJobs = { "var-image": { status: "GENERATING", error: "" } };
    expect(isVariantRunning(withImage, jobs)).toBe(true);
    expect(variantsToWatch([withImage], jobs)).toEqual(["var-image"]);
  });

  it("a queued re-run counts as running too (the job exists the moment the action returns)", () => {
    expect(isVariantRunning(withImage, { "var-image": { status: "QUEUED", error: "" } })).toBe(true);
  });

  it("before the server has been asked, an image-less variant is running and one with an image is not", () => {
    expect(isVariantRunning(noImage, {})).toBe(true);
    expect(isVariantRunning(withImage, {})).toBe(false);
  });

  it("everything unasked is swept once when the dialog opens — that is how a re-run started elsewhere is found", () => {
    expect(variantsToWatch([withImage, noImage], {})).toEqual(["var-image", "var-empty"]);
  });

  it("a finished, failed or never-started variant drops out, so an idle dialog polls nothing", () => {
    const jobs: VariantJobs = {
      "var-image": { status: "DONE", error: "" },
      "var-empty": { status: "FAILED", error: "the provider refused" },
      "var-never": { status: "NONE", error: "" },
    };
    const never = { id: "var-never", refs: [] };
    expect(variantsToWatch([withImage, noImage, never], jobs)).toEqual([]);
    // an image-less variant with no job at all is NOT left spinning forever
    expect(isVariantRunning(never, jobs)).toBe(false);
  });
});

describe("a paid result is news until it is on the merchant's screen (#781 r3)", () => {
  // what the page snapshot is showing, and what the worker attached — the two things the old rule
  // never compared. RefImageDTO already carries the asset id; the job now reports the same ids.
  const oldImage = { assetId: "ast-old" };
  const newImage = { assetId: "ast-new" };
  const done = (outputAssetIds: string[]): VariantJobView => ({ status: "DONE", error: "", outputAssetIds });

  it("THE WINDOW THAT WAS OPEN: a first-seen DONE whose image the page never had must re-read", () => {
    // The page rendered [old]; the worker then finished and attached [new]; the FIRST poll of this
    // dialog already says DONE, with no running state in front of it. Under the old rule this was
    // filed as history and the merchant kept looking at the image they had just paid to replace.
    expect(variantNeedsReread({ refs: [oldImage] }, done(["ast-new"]))).toBe(true);
  });

  it("a DONE whose image IS already on the tile is history — opening the dialog stays free", () => {
    expect(variantNeedsReread({ refs: [oldImage, newImage] }, done(["ast-new"]))).toBe(false);
  });

  it("a finish the dialog watched happen still re-reads (the new image is never in the old data)", () => {
    expect(variantNeedsReread({ refs: [oldImage] }, done(["ast-new"]))).toBe(true);
  });

  it("nothing unfinished asks for a re-read: queued, generating, failed, no job at all", () => {
    const snapshot = { refs: [oldImage] };
    expect(variantNeedsReread(snapshot, { status: "QUEUED", error: "" })).toBe(false);
    expect(variantNeedsReread(snapshot, { status: "GENERATING", error: "" })).toBe(false);
    expect(variantNeedsReread(snapshot, { status: "FAILED", error: "the provider refused" })).toBe(false);
    expect(variantNeedsReread(snapshot, { status: "NONE", error: "" })).toBe(false);
  });

  it("a DONE the server told us nothing about re-reads: unproven is not the same as fine", () => {
    // fail-safe direction — a wasted re-read costs a round trip, a missed one costs a paid image
    expect(variantNeedsReread({ refs: [oldImage] }, { status: "DONE", error: "" })).toBe(true);
    expect(variantNeedsReread({ refs: [oldImage] }, done([]))).toBe(true);
  });
});

describe("'the paid result is on screen' is answered by the assets, not the status", () => {
  it("every produced asset must be present — a partial arrival is not an arrival", () => {
    const job: VariantJobView = { status: "DONE", error: "", outputAssetIds: ["a1", "a2"] };
    expect(variantShowsJobResult({ refs: [{ assetId: "a1" }, { assetId: "a2" }] }, job)).toBe(true);
    expect(variantShowsJobResult({ refs: [{ assetId: "a1" }] }, job)).toBe(false);
    expect(variantShowsJobResult({ refs: [] }, job)).toBe(false);
  });

  it("an empty or unreported output list proves nothing", () => {
    expect(variantShowsJobResult({ refs: [{ assetId: "a1" }] }, { status: "DONE", error: "", outputAssetIds: [] })).toBe(false);
    expect(variantShowsJobResult({ refs: [{ assetId: "a1" }] }, { status: "DONE", error: "" })).toBe(false);
  });
});
