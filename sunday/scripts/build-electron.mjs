// Bundles the Electron main process and the preload script with esbuild.
// Output: dist-electron/main.cjs and dist-electron/preload.cjs
import { build, context } from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const watch = process.argv.includes("--watch");

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: watch ? "inline" : false,
  logLevel: "info",
  absWorkingDir: root,
};

const targets = [
  { ...common, entryPoints: ["electron/main.ts"], outfile: "dist-electron/main.cjs" },
  // sandboxed preloads must be a single CommonJS file that only requires "electron"
  { ...common, entryPoints: ["electron/preload.ts"], outfile: "dist-electron/preload.cjs" },
];

if (watch) {
  for (const t of targets) {
    const ctx = await context(t);
    await ctx.watch();
  }
} else {
  await Promise.all(targets.map((t) => build(t)));
}
