# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

# Copy package files and install ALL deps (including devDependencies for build)
COPY package.json package-lock.json ./
RUN npm ci

# Copy source code
COPY . .

# Build frontend (Vite) + backend (esbuild)
RUN npm run build

# ── Production stage ─────────────────────────────────────────────────────────
FROM node:20-slim AS runner

WORKDIR /app

# Copy package files and install production deps only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built artifacts from builder
COPY --from=builder /app/dist ./dist

# Copy bridge file for download endpoint
COPY --from=builder /app/print-bridge.mjs ./print-bridge.mjs

# Copy scripts for printing
COPY --from=builder /app/scripts ./scripts

# Cloud Run sets PORT env var
ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["node", "dist/server.cjs"]
