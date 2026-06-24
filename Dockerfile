# Stage 1: Build React frontend
FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ .
RUN npm run build

# Stage 2: Production server
FROM node:22-alpine AS server
WORKDIR /app
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=client-build /app/client/dist ./public
EXPOSE 3000
CMD ["node", "src/index.js"]
