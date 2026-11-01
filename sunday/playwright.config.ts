import { defineConfig } from "@playwright/test";

// `npm run test:e2e` builds first, then runs:
//   tests/e2e/studio.spec.ts   — the Animation Studio in a browser (vite preview)
//   tests/e2e/electron.spec.ts — the real Electron app (windows, transparency, IPC, movement)
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 90_000,
  workers: 1,
  reporter: [["list"]],
  use: {
    viewport: { width: 1440, height: 900 },
    launchOptions: { args: ["--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command: "npx vite preview --port 5318 --strictPort",
    port: 5318,
    reuseExistingServer: true,
  },
});
