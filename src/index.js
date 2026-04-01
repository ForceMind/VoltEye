import process from "node:process";
import { loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { JsonStore } from "./storage.js";
import { TcnestClient } from "./tcnest-client.js";
import { BalancePoller } from "./poller.js";
import { createApp } from "./app.js";

async function main() {
  const logger = createLogger();
  const config = loadConfig();

  const store = new JsonStore(config.dataFile, config.maxRecords);
  await store.init();

  const client = new TcnestClient(config, logger);
  const poller = new BalancePoller({
    client,
    store,
    config,
    logger,
  });

  const app = createApp({
    store,
    poller,
    config,
    logger,
  });

  const server = app.listen(config.port, () => {
    logger.info(`VoltEye 已启动: http://0.0.0.0:${config.port}`);
    poller.start();
  });

  const shutdown = () => {
    logger.info("正在关闭服务...");
    poller.stop();
    server.close(() => {
      logger.info("服务已关闭");
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
