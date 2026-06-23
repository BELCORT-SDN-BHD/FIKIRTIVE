import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pg + Prisma driver adapter must stay in Node, not be bundled
  serverExternalPackages: ["@prisma/adapter-pg", "pg", "@fikirtive/db"],
  experimental: {
    serverActions: {
      // Local-dev upload path only — T4 moves files to R2 presigned direct upload
      bodySizeLimit: "256mb",
    },
  },
};

export default nextConfig;
