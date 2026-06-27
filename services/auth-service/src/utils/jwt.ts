import jwt, { SignOptions } from "jsonwebtoken";
import { env } from "../config/env";

export interface JwtPayload {
  userId: string;
  role: "customer" | "agent" | "admin";
}

export interface DecodedToken extends JwtPayload {
  iat: number;
  exp: number;
}
/**
 * Sign a short-lived access token.
 * Returned in the response body, used for authenticated requests.
 */

export function signAccessToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN,
  } as SignOptions);
}

/**
 * Sign a long-lived refresh token.
 * Stored in an HttpOnly cookie, used to generate new access tokens.
 */

export function signRefreshToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.REFRESH_TOKEN_SECRET, {
    expiresIn: env.REFRESH_TOKEN_EXPIRES_IN,
  } as SignOptions);
}

/**
 * Verify an access token. Throws if invalid or expired.
 */

export function verifyAccessToken(token: string): DecodedToken {
  return jwt.verify(token, env.JWT_SECRET) as unknown as DecodedToken;
}
/**
 * Verify a refresh token. Throws if invalid or expired.
 */

export function verifyRefreshToken(token: string): DecodedToken {
  return jwt.verify(token, env.REFRESH_TOKEN_SECRET) as unknown as DecodedToken;
}
