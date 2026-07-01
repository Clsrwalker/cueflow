import { rm } from "node:fs/promises";

await rm("dist/lambda", { recursive: true, force: true });
