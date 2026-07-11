/**
 * readBoundedPrefix (工单 F2, P3) — reads at most `maxBytes` from the START of an object then stops.
 * It must (a) respect the cap even when one giant chunk carries the whole object, (b) assemble
 * multiple chunks in order, and (c) close the underlying stream (async iterator `.return()`) the
 * moment the cap is reached rather than draining a multi-GB object. Storage lives in @fikirtive/
 * storage which has no test runner of its own — per its package.json it is "covered by app-level
 * smokes", so this unit test rides the web app's vitest against the built artifact web actually calls.
 */
import { describe, it, expect } from "vitest";
import { readBoundedPrefix } from "@fikirtive/storage";

/** A store whose readStream yields `chunks`; `closed()` reports whether the iterator was finalized
 *  (its generator `finally` runs on natural exhaustion OR on an early-break `.return()`). */
function storeOf(chunks: Uint8Array[]) {
  let closed = false;
  const store = {
    async readStream(_key: string): Promise<AsyncIterable<Uint8Array>> {
      return (async function* () {
        try {
          for (const c of chunks) yield c;
        } finally {
          closed = true;
        }
      })();
    },
  };
  return { store, closed: () => closed };
}

const bytes = (...n: number[]) => new Uint8Array(n);

describe("readBoundedPrefix", () => {
  it("returns the whole object when it is smaller than the cap", async () => {
    const { store } = storeOf([bytes(1, 2, 3)]);
    const out = await readBoundedPrefix(store, "k", 4096);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });

  it("concatenates multiple chunks in order up to the cap", async () => {
    const { store } = storeOf([bytes(1, 2, 3), bytes(4, 5, 6), bytes(7, 8, 9)]);
    const out = await readBoundedPrefix(store, "k", 100);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("caps at maxBytes across a chunk boundary (partial last chunk kept)", async () => {
    const { store } = storeOf([bytes(1, 2, 3, 4, 5), bytes(6, 7, 8, 9, 10)]);
    const out = await readBoundedPrefix(store, "k", 7);
    expect(out.length).toBe(7);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("bounds a single OVERSIZED chunk to the cap (a whole-object chunk can't blow past maxBytes)", async () => {
    const huge = new Uint8Array(1_000_000).fill(7); // driver returns the entire object in one chunk
    const { store } = storeOf([huge]);
    const out = await readBoundedPrefix(store, "k", 16);
    expect(out.length).toBe(16);
    expect(Array.from(out)).toEqual(new Array(16).fill(7));
  });

  it("closes the underlying stream once the cap is reached (iterator .return())", async () => {
    const { store, closed } = storeOf([bytes(1, 2, 3, 4), bytes(5, 6, 7, 8), bytes(9, 10)]);
    const out = await readBoundedPrefix(store, "k", 4);
    expect(Array.from(out)).toEqual([1, 2, 3, 4]);
    expect(closed()).toBe(true); // broke out mid-stream → generator finally ran, later chunks never drained
  });
});
