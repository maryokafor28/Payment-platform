import pino from "pino";

// ─────────────────────────────────────────
// Pino Logger — shared across all services
// Each service passes its own name so logs
// are identifiable in aggregation tools
// ─────────────────────────────────────────

export function createLogger(serviceName: string) {
  return pino({
    level: process.env.NODE_ENV === "production" ? "info" : "debug",

    base: {
      service: serviceName,
      env: process.env.NODE_ENV ?? "development",
    },

    timestamp: pino.stdTimeFunctions.isoTime,

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
}
