# ---------------------------------------------------------------------------
# Stage 1: Build the React frontend
# ---------------------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app

# Install root-level (React app) dependencies
COPY package.json package-lock.json* ./
RUN npm install

# Copy source needed for the Vite build
COPY index.html tsconfig.json vite.config.ts ./
COPY src/ ./src/
COPY engine/ ./engine/

# VITE_ONLINE=true bakes online-mode into the React bundle.
# The client connects to the Socket.io server on the same origin;
# Caddy proxies both HTTP and WebSocket traffic to the Node.js server.
ENV VITE_ONLINE=true

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Production image -- Node.js server only
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

# Engine source is consumed directly by tsx at runtime (no separate build step).
COPY engine/ ./engine/

# Install server dependencies
COPY server/package.json ./server/
RUN cd server && npm install

# Server source and config
COPY server/src/ ./server/src/
COPY server/tsconfig.json ./server/

# Compiled React app from stage 1
COPY --from=builder /app/dist/ ./dist/

WORKDIR /app/server
EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
