// Proves the fal adapter's post-charge commit boundary ($0, network stubbed).
//   - POST !ok (model never ran)            → plain error, retryable (no .charged)
//   - POST ok then download fails (billed)  → chargedError (.charged === true)
// This is the core of money-safety P1: a transient failure AFTER fal has billed
// must NOT look retryable, or the worker would re-POST and double-charge.
const { FalProvider } = await import("../packages/generation/dist/index.js");
const step = (m) => console.log(`✓ ${m}`);
const realFetch = globalThis.fetch;

async function run(label, fetchStub, expectCharged) {
  globalThis.fetch = fetchStub;
  const p = new FalProvider("test-key");
  let threw = null;
  try {
    await p.generateVideo({ prompt: "x", imageUrl: "http://src/i.png", durationSeconds: 5, model: "kling" });
  } catch (e) { threw = e; }
  globalThis.fetch = realFetch;
  if (!threw) throw new Error(`${label}: expected a throw, got success`);
  const charged = threw.charged === true;
  if (charged !== expectCharged) throw new Error(`${label}: charged=${charged}, expected ${expectCharged} (msg: ${threw.message})`);
  step(`${label}: ${charged ? "chargedError (terminal — won't retry/re-charge)" : "plain error (retryable — no charge)"}`);
}

// pre-charge: the POST itself fails → retryable, unmarked
await run("POST 429 (rate-limited, never ran)", async () => ({ ok: false, status: 429, text: async () => "rate limited" }), false);

// post-charge: POST ok (billed), then the result download 503s → terminal
let n = 0;
await run("POST ok then download 503 (billed)", async () => {
  n++;
  if (n === 1) return { ok: true, json: async () => ({ video: { url: "http://cdn/out.mp4" } }) };
  return { ok: false, status: 503 };
}, true);

// post-charge: POST ok but body has no video url → terminal
await run("POST ok but no video url (billed)", async () => ({ ok: true, json: async () => ({}) }), true);

console.log("\nFAL CHARGE-BOUNDARY TEST PASSED ($0, stubbed)");
process.exit(0);
