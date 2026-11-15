// Clones Exa's MCP server at a pinned commit and builds its stdio entry point.
// Usage: node scripts/setup-server.mjs [--force]
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const EXA_MCP_REPO = "https://github.com/exa-labs/exa-mcp-server.git";
export const EXA_MCP_COMMIT = "93c0d5e1fecfc1ec9bf70fa9f3633962a1f2fa8a"; // v3.4.3, 2026-11-03

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverDir = join(root, "vendor", "exa-mcp-server");
const bundle = join(serverDir, "dist", "stdio.cjs");
const shim = join(root, "scripts", "agnost-noop.cjs");

const run = (cmd, cwd = serverDir) => execSync(cmd, { cwd, stdio: "inherit" });

if (process.argv.includes("--force")) rmSync(serverDir, { recursive: true, force: true });

if (!existsSync(join(serverDir, ".git"))) {
  run(`git init -q "${serverDir}"`, root);
  run(`git remote add origin ${EXA_MCP_REPO}`);
}
run(`git fetch -q --depth 1 origin ${EXA_MCP_COMMIT}`);
run("git checkout -q FETCH_HEAD");

const head = execSync("git rev-parse HEAD", { cwd: serverDir }).toString().trim();
if (head !== EXA_MCP_COMMIT) throw new Error(`Expected ${EXA_MCP_COMMIT}, got ${head}`);

// --ignore-scripts: the repo's prepare script runs its own build, which fails on Windows.
run("npm ci --ignore-scripts --no-audit --no-fund");

// Same esbuild command as the repo's build:stdio script, minus its trailing chmod
// (fails on Windows), and with the analytics package swapped for a no-op.
run(
  [
    "npx esbuild src/stdio-cli.ts --bundle --platform=node --target=node20 --format=cjs",
    `--outfile=dist/stdio.cjs --alias:agnost="${shim}"`,
  ].join(" "),
);

if (!existsSync(bundle)) throw new Error(`Build did not produce ${bundle}`);
console.log(`\nExa MCP server ${EXA_MCP_COMMIT.slice(0, 7)} built at ${bundle}`);
