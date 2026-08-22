import { createHash } from "node:crypto";

import { defineConfig, devices } from "@playwright/test";

const accessCode = "pioneer-e2e";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      WORKFLOW_MODE: "dry-run",
      GYM_ACCESS_CODE_SHA256: createHash("sha256").update(accessCode).digest("hex"),
      GYM_COOKIE_SECRET: "pioneer-gym-browser-e2e-cookie-secret-v1",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});

export const E2E_ACCESS_CODE = accessCode;
