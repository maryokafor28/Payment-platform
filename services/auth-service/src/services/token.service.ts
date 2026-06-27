import { pool } from "../db/pool";
import { env } from "../config/env";
import { hashToken } from "../utils/hash";
import {
  signAccessToken,
  signRefreshToken,
  JwtPayload,
  UserRole,
} from "../utils/jwt";
import { AuthTokens } from "../types/auth.types";

/** Parses "15m" / "7d" / "3600" into seconds. O(1) — single regex match. */
export function parseExpiryToSeconds(expiresIn: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/.exec(expiresIn.trim());
  if (!match) return 900; // fallback: 15 minutes

  const value = Number(match[1]);
  const unit = (match[2] ?? "s") as "s" | "m" | "h" | "d";

  const multipliers: Record<"s" | "m" | "h" | "d", number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };

  return value * multipliers[unit];
}

async function persistRefreshToken(
  userId: string,
  refreshToken: string,
): Promise<void> {
  const tokenHash = hashToken(refreshToken);
  const expiresInSeconds = parseExpiryToSeconds(env.REFRESH_TOKEN_EXPIRES_IN);

  await pool.query(
    `INSERT INTO auth.refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, NOW() + INTERVAL '1 second' * $3)`,
    [userId, tokenHash, expiresInSeconds],
  );
}

/** Signs a new access + refresh pair and persists the refresh token. */
export async function issueTokenPair(user: {
  user_id: string;
  role: UserRole;
}): Promise<AuthTokens> {
  const payload: JwtPayload = { userId: user.user_id, role: user.role };
  const accessToken = signAccessToken(payload);
  const refreshToken = signRefreshToken(payload);
  await persistRefreshToken(user.user_id, refreshToken);
  return { accessToken, refreshToken };
}

/** Looks up a refresh token by its hash. O(log n) via the unique index. */
export async function findRefreshToken(
  refreshToken: string,
): Promise<{ revoked: boolean; expires_at: Date } | null> {
  const { rows } = await pool.query<{ revoked: boolean; expires_at: Date }>(
    `SELECT revoked, expires_at FROM auth.refresh_tokens WHERE token_hash = $1`,
    [hashToken(refreshToken)],
  );
  return rows[0] ?? null;
}

/** Revokes a single refresh token — used during rotation and single-device logout. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await pool.query(
    `UPDATE auth.refresh_tokens SET revoked = TRUE WHERE token_hash = $1`,
    [hashToken(refreshToken)],
  );
}

/** Revokes every active token for a user. Hits the partial index on (user_id) WHERE revoked = FALSE. */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await pool.query(
    `UPDATE auth.refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE`,
    [userId],
  );
}
