import { defineConfig } from "vitest/config";
import { ciTimeouts } from "../../vitest.config.base.js";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    ...ciTimeouts,
  },
});
