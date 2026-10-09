# syntax=docker/dockerfile:1
#
# Caddy with the built frontend baked in. Build context: ./frontend,
# plus the named context `caddyconf` (./deploy/caddy) for the Caddyfile.
# See docker-compose.prod.yml.

FROM node:22.21.1-bookworm-slim AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# VITE_API_BASE_URL stays empty: the browser calls /api on the same origin.
RUN npm run build

FROM caddy:2.10.2-alpine
COPY --from=caddyconf Caddyfile /etc/caddy/Caddyfile
COPY --from=frontend /app/dist /srv
