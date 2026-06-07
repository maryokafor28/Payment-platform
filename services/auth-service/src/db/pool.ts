import { env } from "../config/env";
import { Pool } from "pg";
export const pool = new Pool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  database: env.DB_NAME,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  options: `-c search_path=auth`,
  application_name: "auth-service",

  ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,

  // pool configuration
  max: 10, // max connections in pool
  idleTimeoutMillis: 30_000, // close idle connections after 30s
  connectionTimeoutMillis: 5_000, // fail fast if DB unreachable
});

// verify connection on startup
export async function connectDB(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
    console.log("Database connection established");
  } finally {
    client.release();
  }
}

// graceful shutdown
export async function disconnectDB(): Promise<void> {
  await pool.end();
  console.log("Database pool closed");
}
