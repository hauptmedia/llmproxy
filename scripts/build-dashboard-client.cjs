const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const outputDir = path.join(repoRoot, "dist", "dashboard-app", "assets");

function runVueTypeCheck() {
  const vueTscPath = path.join(repoRoot, "node_modules", "vue-tsc", "bin", "vue-tsc.js");
  const result = spawnSync(process.execPath, [vueTscPath, "--project", path.join("frontend", "tsconfig.json"), "--noEmit"], {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function buildJavascript() {
  const vitePath = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
  const result = spawnSync(process.execPath, [vitePath, "build", "--config", path.join("frontend", "vite.config.ts")], {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function buildCss() {
  const tailwindCliPath = path.join(repoRoot, "node_modules", "@tailwindcss", "cli", "dist", "index.mjs");
  const inputPath = path.join(repoRoot, "frontend", "dashboard.css");
  const outputPath = path.join(outputDir, "dashboard.css");
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  const result = spawnSync(process.execPath, [tailwindCliPath, "-i", inputPath, "-o", outputPath, "--minify"], {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: false,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main() {
  runVueTypeCheck();
  buildJavascript();
  buildCss();
}

main();
