import { pool } from "../db/pool";
import logger from "../config/logger";
import { RequestMeta } from "../types/auth.types";

/**
 * Writes an entry to auth.audit_logs.
 * Audit logging must never break the calling flow — failures are
 * logged and swallowed rather than thrown.
 */
export async function writeAuditLog(
  userId: string | null,
  event: string,
  metadata: Record<string, unknown> = {},
  meta: RequestMeta = {},
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO auth.audit_logs (user_id, event, ip_address, user_agent, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, event, meta.ip ?? null, meta.userAgent ?? null, metadata],
    );
  } catch (err) {
    logger.error({ err, event }, "Failed to write audit log");
  }
}
