import type { NextConfig } from "next";
import { securityHeaderRules } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // pg + Prisma driver adapter must stay in Node, not be bundled
  serverExternalPackages: ["@prisma/adapter-pg", "pg", "@fikirtive/db"],
  experimental: {
    serverActions: {
      // Local-dev upload path only — T4 moves files to R2 presigned direct upload
      bodySizeLimit: "256mb",
    },
  },
  // #795 — security response headers. The rules live in lib/security-headers.ts so they are a
  // plain value a test can read and assert on; this file only decides whether we are in
  // production (which is what HSTS is gated on).
  headers: async () => securityHeaderRules({ production: process.env.NODE_ENV === "production" }),
};

export default nextConfig;
