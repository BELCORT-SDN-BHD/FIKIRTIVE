// Stub for `server-only` in vitest/node integration tests.
// The real package throws to prevent client-side import; in the test runner
// (pure Node, no Next.js boundaries) we just let the import succeed silently.
export {};
