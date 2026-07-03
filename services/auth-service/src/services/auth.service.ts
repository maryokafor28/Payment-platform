import { randomBytes } from "crypto";
import { pool } from "../db/pool";
import { redisClient } from "../config/redis";
import logger from "../config/logger";
import { AppError } from "@shared/utils/errorHandler";
import { hashPassword, comparePassword } from "../utils/hash";
import { verifyRefreshToken, UserRole } from "../utils/jwt";
import { UserRow, AuthTokens, RequestMeta } from "../types/auth.types";
import { writeAuditLog } from "./audit.service";
import {
  issueTokenPair,
  findRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from "./token.service";

// Fixed, valid-format bcrypt hash with no real corresponding password.
// Keeps login response time constant when the email doesn't exist —
// bcrypt.compare still runs its full cost factor either way, so an
// attacker can't use response timing to enumerate registered emails.
const DUMMY_HASH =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

// ---------------------------------------------------------------
// Register
// ---------------------------------------------------------------
export async function registerUser(
  email: string,
  password: string,
  meta: RequestMeta = {},
): Promise<AuthTokens & { userId: string; role: UserRole }> {
  const existing = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM auth.users WHERE email = $1`,
    [email],
  );

  if (existing.rows.length > 0) {
    throw new AppError("An account with this email already exists", 409);
  }

  const passwordHash = await hashPassword(password);

  const { rows } = await pool.query<UserRow>(
    `INSERT INTO auth.users (email, password_hash, role)
     VALUES ($1, $2, 'customer')
     RETURNING user_id, email, role`,
    [email, passwordHash],
  );

  const user = rows[0];

  if (!user) {
    throw new AppError("Failed to create user account", 500);
  }

  const tokens = await issueTokenPair(user);
  await writeAuditLog(user.user_id, "user.registered", {}, meta);

  return { ...tokens, userId: user.user_id, role: user.role };
}
// ---------------------------------------------------------------
// Login
// ---------------------------------------------------------------

export async function loginUser(
  email: string,
  password: string,
  meta: RequestMeta = {},
): Promise<AuthTokens & { userId: string; role: UserRole }> {
  const { rows } = await pool.query<UserRow>(
    `SELECT user_id, email, password_hash, role FROM auth.users WHERE email = $1`,
    [email],
  );

  const user = rows[0];
  const passwordMatches = await comparePassword(
    password,
    user?.password_hash ?? DUMMY_HASH,
  );

  if (!user || !passwordMatches) {
    await writeAuditLog(
      user?.user_id ?? null,
      "auth.failed_login",
      { email },
      meta,
    );
    throw new AppError("Invalid email or password", 401);
  }

  const tokens = await issueTokenPair(user);
  await writeAuditLog(user.user_id, "user.login", {}, meta);

  return { ...tokens, userId: user.user_id, role: user.role };
}

// ---------------------------------------------------------------
// Refresh — rotates the refresh token on every use
// ---------------------------------------------------------------

export async function refreshAccessToken(
  refreshToken: string,
): Promise<AuthTokens> {
  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError("Invalid or expired refresh token", 401);
  }

  const storedToken = await findRefreshToken(refreshToken);

  if (
    !storedToken ||
    storedToken.revoked ||
    storedToken.expires_at < new Date()
  ) {
    throw new AppError("Refresh token is no longer valid", 401);
  }

  await revokeRefreshToken(refreshToken); // rotate — old token can never be replayed

  const userResult = await pool.query<{ user_id: string; role: UserRole }>(
    `SELECT user_id, role FROM auth.users WHERE user_id = $1`,
    [decoded.userId],
  );

  const user = userResult.rows[0];
  if (!user) {
    throw new AppError("Account no longer exists", 401);
  }

  const tokens = await issueTokenPair(user);
  await writeAuditLog(user.user_id, "user.token_refreshed");

  return tokens;
}

// ---------------------------------------------------------------
// Logout
// ---------------------------------------------------------------

export async function logoutUser(
  userId: string,
  accessToken: string,
  accessTokenExp: number,
  refreshToken?: string,
): Promise<void> {
  const remainingSeconds = Math.max(
    accessTokenExp - Math.floor(Date.now() / 1000),
    1,
  );

  const tasks: Promise<unknown>[] = [
    redisClient.set(`blacklist:${accessToken}`, userId, {
      EX: remainingSeconds,
    }),
  ];

  if (refreshToken) {
    tasks.push(revokeRefreshToken(refreshToken));
  }

  await Promise.all(tasks);
  await writeAuditLog(userId, "user.logout");
}

// ---------------------------------------------------------------
// Logout — all devices
// ---------------------------------------------------------------

export async function logoutAllDevices(
  userId: string,
  accessToken: string,
  accessTokenExp: number,
): Promise<void> {
  const remainingSeconds = Math.max(
    accessTokenExp - Math.floor(Date.now() / 1000),
    1,
  );

  await Promise.all([
    redisClient.set(`blacklist:${accessToken}`, userId, {
      EX: remainingSeconds,
    }),
    revokeAllUserTokens(userId),
  ]);

  await writeAuditLog(userId, "user.logout_all");
}

// ---------------------------------------------------------------
// Forgot password
// ---------------------------------------------------------------

export async function requestPasswordReset(email: string): Promise<void> {
  const { rows } = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM auth.users WHERE email = $1`,
    [email],
  );

  const user = rows[0];
  if (!user) return; // same response either way — prevents email enumeration

  const token = randomBytes(32).toString("hex");
  await redisClient.set(`password_reset:${token}`, user.user_id, { EX: 900 });

  // TODO: replace with real email delivery once notification service exists
  logger.info({ userId: user.user_id }, "Password reset token generated");

  await writeAuditLog(user.user_id, "user.password_reset_requested");
}

// ---------------------------------------------------------------
// Reset password
// ---------------------------------------------------------------

export async function resetPassword(
  token: string,
  newPassword: string,
): Promise<void> {
  const redisKey = `password_reset:${token}`;
  const userId = await redisClient.get(redisKey);

  if (!userId) {
    throw new AppError("Reset token is invalid or has expired", 400);
  }

  const passwordHash = await hashPassword(newPassword);

  await Promise.all([
    pool.query(`UPDATE auth.users SET password_hash = $1 WHERE user_id = $2`, [
      passwordHash,
      userId,
    ]),
    redisClient.del(redisKey), // single-use — delete immediately
    revokeAllUserTokens(userId),
  ]);

  await writeAuditLog(userId, "user.password_reset_completed");
}
