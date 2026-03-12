import { ConfigStore } from "./config-store";
import { LoadBalancer } from "./load-balancer";
import { LlmProxyServer } from "./server";

async function main(): Promise<void> {
  const configStore = new ConfigStore();
  const config = await configStore.load();
  const loadBalancer = new LoadBalancer(config);
  await loadBalancer.start();

  const server = new LlmProxyServer(configStore, loadBalancer);
  await server.start();

  const { host, port, dashboardPath } = loadBalancer.getServerConfig();
  console.log(`llmproxy listening on http://${host}:${port}`);
  console.log(`dashboard available on http://${host}:${port}${dashboardPath}`);

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
