import type { Request, Response, NextFunction } from "express";

// ─────────────────────────────────────────
// Custom Error Class
// Use this to throw errors with a status code
// Example: throw new AppError('User not found', 404)
// ─────────────────────────────────────────
export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

// ─────────────────────────────────────────
// Central Error Handler Middleware
// Plug this into express ONCE in index.ts
// It catches all errors thrown anywhere in the app
// ─────────────────────────────────────────
export const errorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal server error";

  res.status(statusCode).json({
    status: "error",
    message,
  });
};
