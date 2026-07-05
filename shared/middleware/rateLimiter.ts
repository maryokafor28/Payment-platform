import { Request, Response, NextFunction } from "express";
import { RedisClientType } from "redis";
import { AppError } from "@shared/utils/errorHandler";

export interface WindowConfig {
  maxRequests: number;
  windowSeconds: number;
  label: string; // e.g. "per minute", "per hour" — used in error message
}

export interface RateLimiterOptions {
  keyPrefix: string;
  windows: WindowConfig[]; // multiple windows checked in order
  identifyBy?: "ip" | "user" | "both"; // default: "ip"
}

// Lua script — atomic increment and conditional expiry in a single round trip.
// Redis executes Lua scripts atomically — no other command can interleave
// between the INCR, and EXPIRE operations, eliminating the race condition.
const INCREMENT_SCRIPT = `
  local current = redis.call('INCR', KEYS[1])
  if current == 1 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
  end
  return current
`;

function resolveIdentifier(
  req: Request,
  identifyBy: "ip" | "user" | "both",
): string {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    typeof forwarded === "string"
      ? (forwarded.split(",")[0]?.trim() ??
        req.socket.remoteAddress ??
        "unknown")
      : (req.socket.remoteAddress ?? "unknown");

  const userId = req.user?.userId;

  if (identifyBy === "user" && userId) return `user:${userId}`;
  if (identifyBy === "both" && userId) return `user:${userId}:ip:${ip}`;
  return `ip:${ip}`;
}

export function rateLimiter(
  redisClient: RedisClientType,
  logger: {
    warn: (obj: unknown, msg: string) => void;
    error: (obj: unknown, msg: string) => void;
  },
  options: RateLimiterOptions,
) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    const identifier = resolveIdentifier(req, options.identifyBy ?? "ip");

    try {
      // Check every window — all must pass
      for (const window of options.windows) {
        const key = `rl:${options.keyPrefix}:${window.label}:${identifier}`;

        const current = await (
          redisClient as unknown as {
            eval: (
              script: string,
              options: { keys: string[]; arguments: string[] },
            ) => Promise<number>;
          }
        ).eval(INCREMENT_SCRIPT, {
          keys: [key],
          arguments: [String(window.windowSeconds)],
        });

        if (current > window.maxRequests) {
          const ttl = await redisClient.ttl(key);

          logger.warn(
            {
              requestId: req.id,
              identifier,
              key,
              current,
              limit: window.maxRequests,
            },
            "Rate limit exceeded",
          );

          return next(
            new AppError(
              `Too many requests (${window.label}). Try again in ${ttl} seconds.`,
              429,
            ),
          );
        }
      }

      next();
    } catch (err) {
      // Fail open — Redis being down must never block legitimate requests
      logger.error(
        { requestId: req.id, err },
        "Rate limiter error — failing open",
      );
      next();
    }
  };
}
