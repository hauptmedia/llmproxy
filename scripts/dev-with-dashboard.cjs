const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const defaultConfigPath = path.join(repoRoot, "llmproxy.config.json");
const viteHost = process.env.LLMPROXY_DASHBOARD_DEV_HOST ?? "127.0.0.1";
const vitePort = Number.parseInt(process.env.LLMPROXY_DASHBOARD_DEV_PORT ?? "5173", 10) || 5173;
const viteOrigin = `http://${viteHost}:${vitePort}`;
const childProcesses = [];
let shuttingDown = false;

function resolveConfigPath() {
  const configuredPath = process.env.LLMPROXY_CONFIG;
  if (!configuredPath) {
    return defaultConfigPath;
  }

  return path.isAbsolute(configuredPath)
    ? configuredPath
    : path.resolve(process.cwd(), configuredPath);
}

function loadServerConfig() {
  const configPath = resolveConfigPath();
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const server = config.server ?? {};

  return {
    host: server.host ?? "0.0.0.0",
    port: server.port ?? 4000,
    dashboardPath: server.dashboardPath ?? "/dashboard",
  };
}

function normalizeHostForUrl(host, fallbackHost) {
  if (!host || host === "0.0.0.0" || host === "::" || host === "::0") {
    return fallbackHost;
  }

  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function getChromePath() {
  const candidates = [
    process.env.LLMPROXY_CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")
      : null,
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function openChrome(dashboardUrl) {
  const chromePath = getChromePath();
  if (!chromePath) {
    console.warn(`Chrome was not found. Open the dashboard manually: ${dashboardUrl}`);
    return;
  }

  const chrome = spawn(chromePath, ["--new-tab", dashboardUrl], {
    cwd: repoRoot,
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });

  chrome.unref();
  console.log(`Opened dashboard in Chrome: ${dashboardUrl}`);
}

function wait(delayMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.ok) {
        return true;
      }
    } catch {}

    await wait(400);
  }

  return false;
}

function runInitialBackendBuild() {
  const tscPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  const build = spawnSync(process.execPath, [tscPath, "-p", "tsconfig.json"], {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: false,
  });

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

function killChildren(signal = "SIGTERM") {
  for (const child of childProcesses) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

function handleChildExit(name, code, signal) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  killChildren(signal ?? "SIGTERM");

  if (signal) {
    process.exit(1);
  }

  process.exit(code ?? 0);
}

function spawnChild(name, args, extraEnv = {}) {
  const child = spawn(process.execPath, args, {
    cwd: repoRoot,
    stdio: "inherit",
    windowsHide: false,
    env: {
      ...process.env,
      ...extraEnv,
    },
  });

  child.on("exit", (code, signal) => {
    handleChildExit(name, code, signal);
  });

  childProcesses.push(child);
  return child;
}

async function main() {
  runInitialBackendBuild();

  const tscPath = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
  const vitePath = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

  spawnChild("TypeScript watch", [tscPath, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"]);
  spawnChild("Vite dev server", [
    vitePath,
    "--config",
    path.join("frontend", "vite.config.ts"),
    "--host",
    viteHost,
    "--port",
    String(vitePort),
    "--strictPort",
  ]);

  const { host, port, dashboardPath } = loadServerConfig();
  const probeHost = normalizeHostForUrl(host, "127.0.0.1");
  const browserHost = normalizeHostForUrl(host, "localhost");
  const healthUrl = `http://${probeHost}:${port}/healthz`;
  const dashboardUrl = `http://${browserHost}:${port}${dashboardPath}`;
  const shouldOpenDashboard = `${process.env.LLMPROXY_OPEN_DASHBOARD ?? "true"}`.toLowerCase() !== "false";

  spawnChild("llmproxy dev server", ["--watch", "dist/index.js"], {
    LLMPROXY_DASHBOARD_DEV_SERVER: viteOrigin,
  });

  process.on("SIGINT", () => {
    shuttingDown = true;
    killChildren("SIGINT");
  });
  process.on("SIGTERM", () => {
    shuttingDown = true;
    killChildren("SIGTERM");
  });

  const [viteReady, backendReady] = await Promise.all([
    waitForHealth(`${viteOrigin}/@vite/client`, 15_000),
    waitForHealth(healthUrl, 15_000),
  ]);

  if (shouldOpenDashboard && viteReady && backendReady) {
    openChrome(dashboardUrl);
    return;
  }

  if (!viteReady) {
    console.warn(`The Vite dev server was not reachable in time: ${viteOrigin}`);
  }

  if (!backendReady) {
    console.warn(`The dashboard backend was not reachable in time: ${healthUrl}`);
  }
}

main().catch((error) => {
  console.error(error);
  shuttingDown = true;
  killChildren("SIGTERM");
  process.exit(1);
});
