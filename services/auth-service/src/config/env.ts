import dotenv from "dotenv";
import path from "path";

// load the right .env file based on NODE_ENV
dotenv.config({
  path: path.resolve(
    __dirname,
    "../..",
    process.env.NODE_ENV === "production" ? ".env.production" : ".env",
  ),
});

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

export const env = {
  // service
  SERVICE_NAME: process.env.SERVICE_NAME ?? "auth-service",
  PORT: Number(process.env.PORT ?? 3001),
  NODE_ENV: process.env.NODE_ENV ?? "development",

  // database
  DB_HOST: requireEnv("DB_HOST"),
  DB_PORT: Number(requireEnv("DB_PORT")),
  DB_NAME: requireEnv("DB_NAME"),
  DB_USER: requireEnv("DB_USER"),
  DB_PASSWORD: requireEnv("DB_PASSWORD"),

  // jwt
  JWT_SECRET: requireEnv("JWT_SECRET") as string,
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "15m",
  REFRESH_TOKEN_SECRET: requireEnv("REFRESH_TOKEN_SECRET"),
  REFRESH_TOKEN_EXPIRES_IN: process.env.REFRESH_TOKEN_EXPIRES_IN ?? "7d",

  // redis
  REDIS_URL: requireEnv("REDIS_URL"),

  // helpers
  get isProduction() {
    return this.NODE_ENV === "production";
  },
  get isDevelopment() {
    return this.NODE_ENV === "development";
  },
};
