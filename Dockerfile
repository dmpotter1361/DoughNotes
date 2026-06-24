# syntax=docker/dockerfile:1

# --- Stage 1: build the React client ---
FROM node:22-slim AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ .
RUN npm run build

# --- Stage 2: production server ---
# Debian-slim (glibc) so better-sqlite3 installs a prebuilt binary — no compiler needed.
FROM node:22-slim AS server
ENV NODE_ENV=production
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
# Serve the built client from /app/public (see server/src/index.js)
COPY --from=client-build /app/client/dist ./public

# SQLite DB + uploaded images live here; mount a volume to persist them.
ENV DATA_DIR=/data
ENV PORT=3500
RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3500
CMD ["node", "src/index.js"]
