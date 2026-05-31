import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { AppError } from "@shared/utils/errorHandler";

export function validate(schema: z.ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const errors = result.error.issues
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");

      return next(new AppError(errors, 422));
    }

    req.body = result.data;
    next();
  };
}
