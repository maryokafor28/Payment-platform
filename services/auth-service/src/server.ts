import { env } from "./config/env";
import { connectDB, disconnectDB } from "./db/pool";
import { runMigrations } from "./db/migrate";
import { createLogger } from "@shared/utils/logger";
import { connectRedis, disconnectRedis } from "./config/redis";

import app from "./app";

const logger = createLogger("auth-service");

async function bootstrap(): Promise<void> {
  await connectDB();
  await connectRedis();
  await runMigrations();

  app.listen(env.PORT, () => {
    logger.info(`Auth service running on port ${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  logger.error(error, "Failed to start auth service");
  process.exit(1);
});

// graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, shutting down");
  await disconnectDB();
  await disconnectRedis();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("SIGINT received, shutting down");
  await disconnectDB();
  await disconnectRedis();
  process.exit(0);
});
