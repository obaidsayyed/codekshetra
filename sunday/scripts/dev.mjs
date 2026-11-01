// Development: Vite dev server + esbuild watch for the main process + Electron.
// Usage: npm run dev            (desktop pet)
//        npm run dev -- --studio (also open the Animation Studio)
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

const server = await createServer({ root, configFile: path.join(root, "vite.config.ts") });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? "http://localhost:5317/";
console.log(`[dev] renderer at ${url}`);

const builder = spawn(process.execPath, [path.join(root, "scripts/build-electron.mjs"), "--watch"], { stdio: "inherit", cwd: root });
await new Promise((r) => setTimeout(r, 1200));

const electronBin = require("electron");
const extra = process.argv.slice(2);
const app = spawn(electronBin, [root, ...extra], {
  stdio: "inherit",
  cwd: root,
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

const shutdown = () => {
  builder.kill();
  app.kill();
  void server.close().then(() => process.exit(0));
};
app.on("exit", shutdown);
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
