const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");

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

function copyStaticAssets(outputDir) {
  const sourceDir = path.join(repoRoot, "frontend", "src", "assets");
  if (!fs.existsSync(sourceDir)) {
    return;
  }

  fs.cpSync(sourceDir, outputDir, {
    recursive: true,
    force: true,
  });
}

function main() {
  const outputDir = path.join(repoRoot, "dist", "dashboard-app", "assets");
  fs.mkdirSync(outputDir, { recursive: true });
  runVueTypeCheck();
  buildJavascript();
  copyStaticAssets(outputDir);
}

main();
