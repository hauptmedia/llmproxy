import { ConfigStore } from "./config-store";
import { LoadBalancer } from "./load-balancer";
import { FIXED_DASHBOARD_PATH } from "./server-dashboard-paths";
import { LlmProxyServer } from "./server";

async function main(): Promise<void> {
  const configStore = new ConfigStore();
  const config = await configStore.load();
  const loadBalancer = new LoadBalancer(config, {
    requestLogWriter: (line) => {
      process.stdout.write(`${line}\n`);
    },
  });
  await loadBalancer.start();

  const server = new LlmProxyServer(configStore, loadBalancer);
  await server.start();

  const { host, port } = loadBalancer.getServerConfig();
  process.stderr.write(`llmproxy listening on http://${host}:${port}\n`);
  process.stderr.write(`dashboard available on http://${host}:${port}${FIXED_DASHBOARD_PATH}\n`);

  const shutdown = async () => {
    await server.stop();
    await loadBalancer.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

void main().catch((error) => {
  console.error("Failed to start llmproxy:", error);
  process.exit(1);
});
