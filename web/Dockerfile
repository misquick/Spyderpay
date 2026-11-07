# ---- build the static site ----
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Public value, baked into the bundle. Get one free at https://dashboard.reown.com
ARG VITE_REOWN_PROJECT_ID=""
ENV VITE_REOWN_PROJECT_ID=$VITE_REOWN_PROJECT_ID
RUN npm run build

# ---- serve it with Caddy (automatic HTTPS) ----
FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
