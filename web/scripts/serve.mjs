#!/usr/bin/env node
/**
 * Serve the Vite build output for production (e.g. DigitalOcean App Platform).
 * Listens on PORT (default 8080) for compatibility with App Platform health checks.
 */
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");
const port = process.env.PORT || "8080";

const child = spawn("npx", ["serve", "-s", distDir, "-l", port], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, PORT: port },
});

child.on("exit", (code) => process.exit(code ?? 0));
