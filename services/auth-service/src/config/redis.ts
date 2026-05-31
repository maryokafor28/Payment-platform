import { createClient } from "redis";
import { env } from "../config/env";
import { createLogger } from "@shared/utils/logger";

const logger = createLogger("auth-service");

export const redisClient = createClient({
  url: env.REDIS_URL,
  socket: {
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        logger.error("Redis max reconnection attempts reached");
        return new Error("Redis max reconnection attempts reached");
      }
      return Math.min(retries * 100, 3000);
    },
  },
});

redisClient.on("error", (err) => logger.error({ err }, "Redis client error"));

redisClient.on("reconnecting", () => logger.warn("Redis client reconnecting"));

redisClient.on("ready", () => logger.info("Redis client connected"));

export async function connectRedis(): Promise<void> {
  await redisClient.connect();
}

export async function disconnectRedis(): Promise<void> {
  await redisClient.quit();
  logger.info("Redis client disconnected");
}
