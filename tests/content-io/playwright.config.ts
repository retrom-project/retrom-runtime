import {defineConfig} from "@playwright/test";
import {resolve} from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.browser.ts",
  workers: 1,
  retries: 0,
  timeout: 30000,
  outputDir: resolve(".artifacts/content-io/browser"),
  use: {headless: true},
  projects: [
    {name: "protocol", testIgnore: "**/*.product.browser.ts", use: {browserName: "chromium", channel: "chromium"}},
    {name: "product", testMatch: "**/*.product.browser.ts", use: {browserName: "chromium",
      launchOptions: {executablePath: process.env.RETROM_CHROME_EXECUTABLE}}},
  ],
});
