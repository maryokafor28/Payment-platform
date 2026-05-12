import express from "express";
import cookieParser from "cookie-parser";
import { errorHandler } from "@shared/utils/errorHandler";
import { createLogger } from "@shared/utils/logger";
const logger = createLogger("auth-service");

const app = express();

// middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// request logging
app.use((req, _res, next) => {
  logger.info({ method: req.method, url: req.url }, "Incoming request");
  next();
});

// routes — added here later
// app.use("/v1/auth", authRoutes);

// error handler — must be last
app.use(errorHandler);

export default app;
