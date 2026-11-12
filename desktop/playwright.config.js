import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "test",
  testMatch: "*.spec.js",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4318",
    viewport: { width: 1440, height: 940 },
  },
  webServer: {
    command: "node test/server.mjs",
    url: "http://127.0.0.1:4318",
    reuseExistingServer: false,
  },
});
