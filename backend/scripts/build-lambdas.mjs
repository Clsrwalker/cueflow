import { build } from "esbuild";
import { rm } from "node:fs/promises";

const entryPoints = [
  "src/lambda/rest-handler.ts",
  "src/lambda/websocket-handler.ts",
  "src/lambda/cue-worker-handler.ts",
  "src/lambda/summary-worker-handler.ts",
];

await rm("dist/lambda", { recursive: true, force: true });

await build({
  entryPoints,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outdir: "dist/lambda",
  sourcemap: true,
  external: [
    "@aws-sdk/*",
  ],
});
