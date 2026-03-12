const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const defaultConfigPath = path.join(repoRoot, 'llmproxy.config.json');

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
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const server = config.server ?? {};

  return {
    host: server.host ?? '0.0.0.0',
    port: server.port ?? 4000,
    dashboardPath: server.dashboardPath ?? '/dashboard',
  };
}

function normalizeHostForUrl(host, fallbackHost) {
  if (!host || host === '0.0.0.0' || host === '::' || host === '::0') {
    return fallbackHost;
  }

  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function getChromePath() {
  const candidates = [
    process.env.LLMPROXY_CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : null,
  ].filter(Boolean);

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function buildProject() {
  const tscPath = path.join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const backendBuild = spawnSync(process.execPath, [tscPath, '-p', 'tsconfig.json'], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: false,
  });

  if (backendBuild.status !== 0) {
    process.exit(backendBuild.status ?? 1);
  }

  const dashboardBuild = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', 'build-dashboard-client.cjs')], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: false,
  });

  if (dashboardBuild.status !== 0) {
    process.exit(dashboardBuild.status ?? 1);
  }
}

async function waitForHealth(url, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        return true;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

function openChrome(dashboardUrl) {
  const chromePath = getChromePath();
  if (!chromePath) {
    console.warn(`Chrome was not found. Open the dashboard manually: ${dashboardUrl}`);
    return;
  }

  const chrome = spawn(chromePath, ['--new-tab', dashboardUrl], {
    cwd: repoRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: false,
  });

  chrome.unref();
  console.log(`Opened dashboard in Chrome: ${dashboardUrl}`);
}

async function main() {
  buildProject();

  const { host, port, dashboardPath } = loadServerConfig();
  const probeHost = normalizeHostForUrl(host, '127.0.0.1');
  const browserHost = normalizeHostForUrl(host, 'localhost');
  const healthUrl = `http://${probeHost}:${port}/healthz`;
  const dashboardUrl = `http://${browserHost}:${port}${dashboardPath}`;
  const shouldOpenDashboard = `${process.env.LLMPROXY_OPEN_DASHBOARD ?? 'true'}`.toLowerCase() !== 'false';

  const server = spawn(process.execPath, ['dist/index.js'], {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: false,
  });

  let serverExited = false;
  server.on('exit', (code, signal) => {
    serverExited = true;
    if (signal) {
      process.exit(1);
    }

    process.exit(code ?? 0);
  });

  const forwardSignal = (signal) => {
    if (!server.killed) {
      server.kill(signal);
    }
  };

  process.on('SIGINT', forwardSignal);
  process.on('SIGTERM', forwardSignal);

  const healthy = await waitForHealth(healthUrl, 15000);
  if (healthy && shouldOpenDashboard) {
    openChrome(dashboardUrl);
  } else if (!healthy && !serverExited) {
    console.warn(`The dashboard was not opened automatically because ${healthUrl} was not reachable in time.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
