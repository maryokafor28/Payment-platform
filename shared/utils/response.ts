import { Response } from "express";

// ─────────────────────────────────────────
// Standard API Response Format
// Use these instead of res.json() directly
// Keeps all responses consistent across services
// ─────────────────────────────────────────

export const sendSuccess = (
  res: Response,
  data: any,
  message = "Success",
  statusCode = 200,
) => {
  return res.status(statusCode).json({
    status: "success",
    message,
    data,
  });
};

export const sendError = (
  res: Response,
  message = "Something went wrong",
  statusCode = 500,
) => {
  return res.status(statusCode).json({
    status: "error",
    message,
  });
};
