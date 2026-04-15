# syntax=docker/dockerfile:1
# Multi-stage build: Node.js build → nginx static serve
# Build context must be the monorepo root.

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate

# ------------------------------------------------------------------
# Install stage: resolve workspace deps for the docs package only
# ------------------------------------------------------------------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/docs/package.json ./apps/docs/package.json
RUN pnpm install --filter @infrawatch/docs --frozen-lockfile

# ------------------------------------------------------------------
# Build stage: run Docusaurus build
# ------------------------------------------------------------------
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/docs/node_modules ./apps/docs/node_modules
COPY apps/docs ./apps/docs
RUN pnpm --filter @infrawatch/docs build

# ------------------------------------------------------------------
# Runtime stage: nginx serving the static output
# ------------------------------------------------------------------
FROM nginx:alpine AS runner
COPY --from=builder /app/apps/docs/build /usr/share/nginx/html
COPY apps/docs/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost/ || exit 1
CMD ["nginx", "-g", "daemon off;"]
