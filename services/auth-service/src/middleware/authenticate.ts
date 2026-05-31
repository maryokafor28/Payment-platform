import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { AppError } from "@shared/utils/errorHandler";
import asyncHandler from "@shared/utils/asyncHandler";
import { redisClient } from "../config/redis";
import { env } from "../config/env";
import { createLogger } from "@shared/utils/logger";

const logger = createLogger("auth-service");

interface JwtPayload {
  userId: string;
  role: string;
  iat: number;
  exp: number;
}

export const authenticate = asyncHandler(
  async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      return next(new AppError("No token provided", 401));
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return next(new AppError("No token provided", 401));
    }

    let decoded: JwtPayload;

    try {
      decoded = jwt.verify(
        token,
        env.JWT_SECRET,
      ) as jwt.JwtPayload as JwtPayload;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return next(new AppError("Token has expired", 401));
      }

      if (err instanceof jwt.JsonWebTokenError) {
        return next(new AppError("Invalid token", 401));
      }

      return next(new AppError("Token verification failed", 401));
    }

    const blacklisted = await redisClient.get(`blacklist:${token}`);

    if (blacklisted) {
      logger.warn(
        {
          requestId: req.id,
          userId: decoded.userId,
        },
        "Blacklisted token used",
      );

      return next(new AppError("Token has been invalidated", 401));
    }

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
    };

    next();
  },
);
