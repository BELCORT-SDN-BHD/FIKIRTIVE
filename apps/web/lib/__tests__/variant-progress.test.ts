/**
 * #781 r2 P1 — "Make it again" charges the merchant; these rules are what makes the result they
 * paid for appear.
 *
 * The regression these cover is a money-visibility one. The worker APPENDS a regenerated image to
 * the variant instead of replacing the old row, so:
 *   - a tile that shows refs[0] shows the picture the merchant paid to move on from, permanently,
 *     no matter how many times they pay;
 *   - a poller that only watches image-less variants never notices the new image arriving, so the
 *     screen never changes after a paid click — and the obvious next move is to pay again.
 *
 * Both are decided by the pure rules in lib/variant-progress, which is why they can be tested for
 * real here (apps/web's vitest include list covers lib/, not components/).
 */
import { describe, it, expect } from "vitest";
import {
  isVariantRunning,
  latestVariantRef,
  variantJustFinished,
  variantsToWatch,
  type VariantJobs,
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

describe("only a finish we watched happen is news", () => {
  it("running → DONE is a finish (this is what re-reads the element and shows the new image)", () => {
    expect(variantJustFinished({ status: "GENERATING", error: "" }, { status: "DONE", error: "" })).toBe(true);
    expect(variantJustFinished({ status: "QUEUED", error: "" }, { status: "DONE", error: "" })).toBe(true);
  });

  it("a DONE seen for the FIRST time is history, not news — no refresh on every dialog open", () => {
    expect(variantJustFinished(undefined, { status: "DONE", error: "" })).toBe(false);
  });

  it("nothing else is a finish: DONE→DONE, running→FAILED, running→still running", () => {
    expect(variantJustFinished({ status: "DONE", error: "" }, { status: "DONE", error: "" })).toBe(false);
    expect(variantJustFinished({ status: "GENERATING", error: "" }, { status: "FAILED", error: "x" })).toBe(false);
    expect(variantJustFinished({ status: "QUEUED", error: "" }, { status: "GENERATING", error: "" })).toBe(false);
  });
});
