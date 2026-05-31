import { Request, Response, NextFunction } from "express";
import { redisClient } from "../config/redis";
import { AppError } from "@shared/utils/errorHandler";
import { createLogger } from "@shared/utils/logger";

const logger = createLogger("auth-service");

interface RateLimiterOptions {
  keyPrefix: string; // e.g. "rl:login" or "rl:forgot-password"
  maxRequests: number; // max attempts allowed
  windowSeconds: number; // time window in seconds
}

export function rateLimiter(options: RateLimiterOptions) {
  return async (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // use IP in production, fallback for local Docker
    const forwardedFor = req.headers["x-forwarded-for"];

    let ip = req.socket.remoteAddress ?? "unknown";

    if (typeof forwardedFor === "string") {
      const firstIp = forwardedFor.split(",")[0];

      if (firstIp) {
        ip = firstIp.trim();
      }
    }
    const key = `${options.keyPrefix}:${ip}`;

    try {
      const current = await redisClient.incr(key);

      // set expiry only on first request in window
      if (current === 1) {
        await redisClient.expire(key, options.windowSeconds);
      }

      if (current > options.maxRequests) {
        const ttl = await redisClient.ttl(key);

        logger.warn(
          { requestId: req.id, ip, key, current },
          "Rate limit exceeded",
        );

        return next(
          new AppError(`Too many requests. Try again in ${ttl} seconds.`, 429),
        );
      }

      next();
    } catch (err) {
      // if Redis is down, fail open — do not block the request
      logger.error({ requestId: req.id, err }, "Rate limiter Redis error");
      next();
    }
  };
}
