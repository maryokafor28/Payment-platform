import { UserRole } from "../utils/jwt";

export interface UserRow {
  user_id: string;
  email: string;
  password_hash: string;
  role: UserRole;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}
