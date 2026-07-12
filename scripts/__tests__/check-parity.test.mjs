// Permanent red-case tests for scripts/check-parity.mjs (SOL 复审 D-018⑤).
// Feeds fixture STRINGS to the exported matching functions and asserts every
// shape the scanner claims to catch is actually caught — no real violating
// files ever land in the repo. Importing check-parity.mjs does NOT run the
// checker (main is guarded). Run: node scripts/__tests__/check-parity.test.mjs
import assert from "node:assert/strict";
import { actionExportNames, apiRouteExportMethods } from "../check-parity.mjs";

// ── actionExportNames: dual action shapes ──
assert.deepEqual(
  actionExportNames("export async function createThing() {}"),
  ["createThing"],
  "export async function shape",
);
assert.deepEqual(
  actionExportNames("export const createThing = async () => {};"),
  ["createThing"],
  "export const = async shape (P0-5 原盲区)",
);
assert.deepEqual(
  actionExportNames("export const createThing: ThingFn = async () => {};"),
  ["createThing"],
  "export const with single-line type annotation",
);
assert.deepEqual(actionExportNames("export const MAX = 25;"), [], "non-async const is not an action");
assert.deepEqual(actionExportNames("export function sync() {}"), [], "sync function is not an action");
// Known boundary (documented, NOT a regression): a type annotation whose arrow type
// crosses onto another line before `= async` is not recognized — `[^=]+` stops at
// the `=` inside `=>`. Asserting current behavior so a silent change is visible.
assert.deepEqual(
  actionExportNames("export const crossLine: (a: string) => Promise<string>\n= async (a) => a;"),
  [],
  "cross-line arrow-type annotation is a known boundary",
);

// ── apiRouteExportMethods: all three route.ts shapes ──
assert.deepEqual(
  apiRouteExportMethods("export async function GET(req) {}"),
  ["GET"],
  "export async function GET shape",
);
assert.deepEqual(
  apiRouteExportMethods("export const { GET, POST } = handlers;"),
  ["GET", "POST"],
  "destructured export const { GET, POST } shape",
);
assert.deepEqual(
  apiRouteExportMethods("export const GET = async (req) => new Response();"),
  ["GET"],
  "export const GET = async shape (SOL 复审 D-018⑤ 盲区)",
);
assert.deepEqual(
  apiRouteExportMethods("export const POST: RouteHandler = async (req) => new Response();"),
  ["POST"],
  "export const POST = async with type annotation",
);
assert.deepEqual(
  apiRouteExportMethods(
    'export async function GET(req) {}\nexport const PUT = async () => {};\nexport const { DELETE } = handlers;',
  ).sort(),
  ["DELETE", "GET", "PUT"],
  "all three shapes in one file",
);
assert.deepEqual(apiRouteExportMethods("export const get = async () => {};"), [], "lowercase name is not a method");
assert.deepEqual(apiRouteExportMethods("export const FOO = async () => {};"), [], "non-HTTP-method name ignored");
assert.deepEqual(apiRouteExportMethods("const GET = async () => {};"), [], "non-exported handler ignored");

console.log("✓ check-parity red-case tests passed");
