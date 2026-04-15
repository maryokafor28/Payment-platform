import pino from "pino";

// ─────────────────────────────────────────
// Pino Logger — shared across all services
// In development: pretty printed, readable
// In production: raw JSON for log aggregators
// ─────────────────────────────────────────
const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  base: {
    service: "gbese-api",
  },

  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:standard",
        ignore: "pid,hostname",
      },
    },
  }),
});

export default logger;
