import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Tenancy rail (closed-beta foundation P0 skeleton): owner-scoped models must go
  // through the tenant-scoped data layer (the P3 scoped client). Direct `prisma` use
  // in apps/web is being phased out. WARN in P0 (the codebase predates the repo);
  // becomes ERROR after the P3 repository extraction.
  {
    rules: {
      "no-restricted-imports": ["warn", {
        paths: [{
          name: "@artlio/db",
          importNames: ["prisma"],
          message: "Owner-scoped models should go through the tenant-scoped data layer (P3 scoped client). See docs/superpowers/specs/2026-06-19-closed-beta-saas-foundation-design.md §4.",
        }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
