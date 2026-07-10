# ─── Stage 1: Builder ───────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# copy root tsconfig and package files
COPY tsconfig*.json ./
COPY package*.json ./

# copy shared utilities
COPY shared/ ./shared/

# copy auth service files
COPY services/auth-service/package*.json ./services/auth-service/
COPY services/auth-service/tsconfig*.json ./services/auth-service/
COPY services/auth-service/src/ ./services/auth-service/src/

# install root dependencies first (covers shared/ modules)
RUN npm install

# install auth service dependencies
WORKDIR /app/services/auth-service
RUN npm install

# build TypeScript
RUN npm run build

# ─── Stage 2: Production ────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

# copy compiled output from builder
COPY --from=builder /app/services/auth-service/dist ./dist
COPY --from=builder /app/services/auth-service/package*.json ./

# copy shared utilities
COPY --from=builder /app/shared/ ./shared/

# copy root node_modules for shared dependencies
COPY --from=builder /app/node_modules ./node_modules

# install production dependencies only
RUN npm install --omit=dev

# non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001

CMD ["node", "dist/server.js"]