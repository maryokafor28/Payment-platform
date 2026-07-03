import bcrypt from "bcrypt";
import { createHash } from "crypto";


const SALT_ROUNDS = 12;

/**
 * Hash a plain text password before storing it.
 * Never store raw passwords — ever.
 */
export async function hashPassword(plainPassword: string): Promise<string> {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

/**
 * Compare a plain text password against a stored hash.
 * Used during login to verify credentials.
 */
export async function comparePassword(
  plainPassword: string,
  hashedPassword: string,
): Promise<boolean> {
  return bcrypt.compare(plainPassword, hashedPassword);
}
/**
 * Deterministic SHA-256 hash — used for refresh tokens, never for passwords.
 * Lets us look a token up directly by its hash via the unique index in
 * O(log n) instead of fetching every row and comparing in memory.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

