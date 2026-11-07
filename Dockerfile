# Single-service image (Render and similar): the Node server serves the API and the built site.
# ---- web ----
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# ---- server ----
FROM node:22-slim AS server
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

# ---- run ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production STATIC_DIR=/app/public
COPY --from=server /app/node_modules ./node_modules
COPY --from=server /app/dist ./dist
COPY server/package.json ./
COPY server/migrations ./migrations
COPY --from=web /web/dist ./public
USER node
EXPOSE 10000
CMD ["node", "dist/index.js"]
