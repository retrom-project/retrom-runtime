import {defineConfig} from "@playwright/test";
import {resolve} from "node:path";

// Public synthetic fixtures only: no PFB, downloaded core or product environment.
export default defineConfig({
  testDir: ".",
  testMatch: ["fixture.browser.ts", "preload.browser.ts", "fallback.browser.ts", "session.browser.ts",
    "storage.browser.ts", "window-budget.browser.ts", "window-cancel.browser.ts", "window-reuse.browser.ts"],
  workers: 1,
  retries: 0,
  forbidOnly: true,
  timeout: 30000,
  outputDir: resolve(".artifacts/content-io/ci"),
  reporter: [["list"], ["json", {outputFile: resolve(".artifacts/content-io/ci/results.json")}]],
  use: {
    headless: true,
    browserName: "chromium",
    trace: "retain-on-failure",
    launchOptions: {executablePath: process.env.RETROM_CHROME_EXECUTABLE},
  },
});
