import { resolve } from "node:path";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const rootDir = resolve(__dirname);
const dashboardHost = process.env.LLMPROXY_DASHBOARD_DEV_HOST ?? "127.0.0.1";
const dashboardPort = Number.parseInt(process.env.LLMPROXY_DASHBOARD_DEV_PORT ?? "5173", 10) || 5173;

export default defineConfig(({ command }) => {
  const nodeEnv = command === "serve" ? "development" : "production";

  return {
    root: rootDir,
    plugins: [vue()],
    define: {
      "process.env.NODE_ENV": JSON.stringify(nodeEnv),
      "process.env": JSON.stringify({ NODE_ENV: nodeEnv }),
    },
    resolve: {
      alias: {
        "@": resolve(rootDir, "src"),
      },
    },
    server: {
      host: dashboardHost,
      port: dashboardPort,
      strictPort: true,
      cors: true,
      origin: `http://${dashboardHost}:${dashboardPort}`,
      hmr: {
        host: dashboardHost,
        port: dashboardPort,
      },
    },
    build: {
      outDir: resolve(rootDir, "../dist/dashboard-app/assets"),
      emptyOutDir: true,
      lib: {
        entry: resolve(rootDir, "src/main.ts"),
        formats: ["es"],
        fileName: () => "dashboard-app.js",
        cssFileName: "dashboard",
      },
      rollupOptions: {
        output: {
          intro: `const process = { env: { NODE_ENV: '${nodeEnv}' } };`,
          assetFileNames: "[name][extname]",
        },
      },
    },
  };
});
