// auth-service/src/middleware/rateLimiter.ts
import { rateLimiter } from "@shared/middleware/rateLimiter";
import { redisClient } from "../config/redis";
import logger from "../config/logger";

// Public endpoints — no userId available yet, limit by IP
export const registerLimiter = rateLimiter(redisClient, logger, {
  keyPrefix: "register",
  identifyBy: "ip",
  windows: [
    { maxRequests: 5, windowSeconds: 60, label: "per-minute" },
    { maxRequests: 10, windowSeconds: 3600, label: "per-hour" },
  ],
});

// Login — 10 per minute burst + 50 per hour sustained
export const loginLimiter = rateLimiter(redisClient, logger, {
  keyPrefix: "login",
  identifyBy: "ip",
  windows: [
    { maxRequests: 10, windowSeconds: 60, label: "per-minute" },
    { maxRequests: 50, windowSeconds: 3600, label: "per-hour" },
  ],
});

// Forgot password — 5 per hour per IP — strict
export const forgotPasswordLimiter = rateLimiter(redisClient, logger, {
  keyPrefix: "forgot-password",
  identifyBy: "ip",
  windows: [{ maxRequests: 5, windowSeconds: 3600, label: "per-hour" }],
});

// Token refresh — per user once authenticated
export const refreshLimiter = rateLimiter(redisClient, logger, {
  keyPrefix: "refresh",
  identifyBy: "user",
  windows: [{ maxRequests: 20, windowSeconds: 60, label: "per-minute" }],
});
// Protected endpoints — user is authenticated, limit by userId
export const logoutLimiter = rateLimiter(redisClient, logger, {
  keyPrefix: "logout",
  identifyBy: "user",
  windows: [{ maxRequests: 10, windowSeconds: 60, label: "per-minute" }],
});

export const logoutAllLimiter = rateLimiter(redisClient, logger, {
  keyPrefix: "logout-all",
  identifyBy: "user",
  windows: [{ maxRequests: 5, windowSeconds: 60, label: "per-minute" }],
});
