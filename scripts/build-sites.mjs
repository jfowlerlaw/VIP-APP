import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const distDir = join(rootDir, "dist");
const clientDir = join(distDir, "client");
const serverDir = join(distDir, "server");

await rm(distDir, { force: true, recursive: true });
await mkdir(clientDir, { recursive: true });
await mkdir(serverDir, { recursive: true });

for (const file of ["index.html", "admin.html", "styles.css", "admin.css", "app.js", "admin.js"]) {
  await cp(join(rootDir, file), join(clientDir, file));
}

await cp(join(rootDir, "assets"), join(clientDir, "assets"), { recursive: true });
await cp(join(rootDir, "src/worker.mjs"), join(serverDir, "index.js"));
await mkdir(join(distDir, ".openai"), { recursive: true });
await cp(join(rootDir, ".openai/hosting.json"), join(distDir, ".openai/hosting.json"));

await writeFile(
  join(clientDir, "_headers"),
  [
    "/*",
    "  Cache-Control: no-store",
    "",
  ].join("\n")
);
