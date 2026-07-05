// auth-service/src/config/redis.ts
import { createRedisClient } from "@shared/config/redis";
import { env } from "./env";
import logger from "./logger";

export const redisClient = createRedisClient(env.REDIS_URL, logger);

export async function connectRedis(): Promise<void> {
  await redisClient.connect();
}

export async function disconnectRedis(): Promise<void> {
  await redisClient.quit();
  logger.info("Redis client disconnected");
}
