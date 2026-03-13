import { existsSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
export interface DashboardRoute {
  page: "overview" | "chat" | "logs" | "config";
}

export function normalizeDashboardPath(pathname: string): string {
  if (!pathname || pathname === "/") {
    return "/dashboard";
  }

  return pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
}

export function normalizeDashboardSubPath(pathname: string): string {
  return pathname !== "/" && pathname.endsWith("/")
    ? pathname.slice(0, -1)
    : pathname;
}

export function matchDashboardRoute(pathname: string, dashboardPath: string): DashboardRoute | undefined {
  const normalizedPathname = normalizeDashboardSubPath(pathname);

  if (normalizedPathname === dashboardPath) {
    return { page: "overview" };
  }

  if (normalizedPathname === `${dashboardPath}/chat`) {
    return { page: "chat" };
  }

  if (normalizedPathname === `${dashboardPath}/logs`) {
    return { page: "logs" };
  }

  if (normalizedPathname === `${dashboardPath}/config`) {
    return { page: "config" };
  }

  return undefined;
}

export function resolveDashboardAssetPath(pathname: string, dashboardPath: string): string | undefined {
  const assetPrefix = `${dashboardPath}/assets/`;
  if (!pathname.startsWith(assetPrefix)) {
    return undefined;
  }

  const rawAssetPath = pathname.slice(assetPrefix.length);
  if (!rawAssetPath) {
    return undefined;
  }

  const segments = rawAssetPath
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (
    segments.length === 0 ||
    segments.some((segment) => segment === "." || segment === ".." || segment.includes("\\"))
  ) {
    return undefined;
  }

  const assetRoots = [
    resolve(__dirname, "dashboard-app", "assets"),
    resolve(__dirname, "..", "frontend", "src", "assets"),
  ];

  for (const assetRoot of assetRoots) {
    const candidate = resolveDashboardAssetCandidate(assetRoot, segments);
    if (candidate && existsSync(candidate)) {
      return candidate;
    }
  }

  return resolveDashboardAssetCandidate(assetRoots[0], segments);
}

export function assetContentType(pathname: string): string {
  const extension = extname(pathname).toLowerCase();

  if (extension === ".css") {
    return "text/css; charset=utf-8";
  }

  if (extension === ".js") {
    return "text/javascript; charset=utf-8";
  }

  if (extension === ".json" || extension === ".map") {
    return "application/json; charset=utf-8";
  }

  return "application/octet-stream";
}

function resolveDashboardAssetCandidate(assetRoot: string, segments: string[]): string | undefined {
  const candidate = resolve(assetRoot, ...segments);
  const allowedPrefix = assetRoot.endsWith(sep) ? assetRoot : `${assetRoot}${sep}`;

  if (candidate !== assetRoot && !candidate.startsWith(allowedPrefix)) {
    return undefined;
  }

  return candidate;
}
