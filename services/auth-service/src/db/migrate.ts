import fs from "fs";
import path from "path";
import { pool } from "./pool";

const migrationsDir = path.join(__dirname, "../../migrations");

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS auth`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth.migrations (
      id         SERIAL      PRIMARY KEY,
      filename   TEXT        NOT NULL UNIQUE,
      ran_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getCompletedMigrations(): Promise<string[]> {
  const result = await pool.query<{ filename: string }>(
    `SELECT filename FROM auth.migrations ORDER BY id ASC`,
  );
  return result.rows.map((row) => row.filename);
}

export async function runMigrations(): Promise<void> {
  await ensureMigrationsTable();

  const completed = await getCompletedMigrations();

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (completed.includes(file)) {
      console.log(`Skipping migration (already ran): ${file}`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO auth.migrations (filename) VALUES ($1)`, [
        file,
      ]);
      await client.query("COMMIT");
      console.log(`Ran migration: ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`Migration failed: ${file}`, error);
      throw error;
    } finally {
      client.release();
    }
  }
}
