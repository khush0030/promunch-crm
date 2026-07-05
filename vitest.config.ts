import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    // The format helpers render in the machine's local timezone; pin it so
    // msgTime/timeAgo assertions pass identically on dev machines (IST) and CI (UTC).
    env: { TZ: "Asia/Kolkata" },
  },
});
