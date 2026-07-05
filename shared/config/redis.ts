import { createClient, RedisClientType } from "redis";

let client: RedisClientType | null = null;

export function createRedisClient(
  redisUrl: string,
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (obj: unknown, msg: string) => void;
  },
): RedisClientType {
  if (client) return client;

  client = createClient({
    url: redisUrl,
    socket: {
      keepAlive: true,
      reconnectStrategy: (retries) => {
        if (retries > 10) {
          logger.error({}, "Redis max reconnection attempts reached");
          return new Error("Redis max reconnection attempts reached");
        }
        return Math.min(retries * 100, 3000);
      },
    },
  }) as RedisClientType;

  client.on("error", (err) => logger.error({ err }, "Redis client error"));
  client.on("reconnecting", () => logger.warn("Redis client reconnecting"));
  client.on("ready", () => logger.info("Redis client connected"));

  return client;
}
