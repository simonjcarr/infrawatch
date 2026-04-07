FROM node:22-alpine AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10 --activate

# --- Dependencies stage ---
FROM base AS deps
WORKDIR /app
# Copy workspace root files so pnpm understands the monorepo structure
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Copy only the web package.json to leverage Docker layer caching
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile
# Resolve pnpm virtual-store symlinks for drizzle-orm and postgres so they can be
# copied as real files into the runner stage (migrate.js needs the full package.json
# exports map, which the Next.js standalone trace does not include).
RUN node -e "\
const {execFileSync}=require('child_process');\
const path=require('path');\
const opts={paths:['/app/apps/web']};\
const dm=path.dirname(require.resolve('drizzle-orm',opts));\
const pg=path.dirname(require.resolve('postgres',opts));\
execFileSync('mkdir',['-p','/migrate-deps']);\
execFileSync('cp',['-rL',dm,'/migrate-deps/drizzle-orm']);\
execFileSync('cp',['-rL',pg,'/migrate-deps/postgres']);\
"

# --- Builder stage ---
FROM base AS builder
WORKDIR /app
# Copy workspace config so pnpm understands the monorepo structure
COPY package.json pnpm-workspace.yaml ./
# Copy source first, then node_modules so they are never overwritten
COPY apps/web/ ./apps/web/
# Manifest is read at runtime to determine the required agent version
COPY .release-please-manifest.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

ENV NEXT_TELEMETRY_DISABLED=1

# Build the app (DATABASE_URL not needed at build time — only for drizzle-kit)
ARG DATABASE_URL=postgresql://placeholder:placeholder@placeholder:5432/placeholder
ARG BETTER_AUTH_SECRET=build-time-placeholder
ARG BETTER_AUTH_URL=http://localhost:3000

WORKDIR /app/apps/web
RUN pnpm run build

# --- Runner stage ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# In a pnpm monorepo, Next.js standalone mirrors the full workspace structure.
# server.js lands at apps/web/server.js inside the standalone output, so we
# must copy public/static to match where server.js will look for them.
COPY --from=builder /app/apps/web/public ./apps/web/public

# Set up prerender cache ownership
RUN mkdir -p apps/web/.next && chown nextjs:nodejs apps/web/.next

COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

# Release-please manifest — read at runtime to determine the required agent version
COPY --from=builder --chown=nextjs:nodejs /app/.release-please-manifest.json /app/.release-please-manifest.json

# Migration script — from builder stage (same source, no caching concern)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/migrate.js ./apps/web/migrate.js
# Migration SQL files — copied DIRECTLY from the build context so this layer is always
# invalidated when any migration file changes, regardless of builder-stage cache hits.
COPY --chown=nextjs:nodejs apps/web/lib/db/migrations ./apps/web/lib/db/migrations

# Next.js standalone only traces the specific files it needs for server.js, not the full
# package structure required for CJS require() in migrate.js. Copy full packages explicitly.
# /migrate-deps was created in the deps stage with symlinks resolved (cp -rL).
COPY --from=deps --chown=nextjs:nodejs /migrate-deps/drizzle-orm ./node_modules/drizzle-orm
COPY --from=deps --chown=nextjs:nodejs /migrate-deps/postgres ./node_modules/postgres

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# server.js is at /app/apps/web/server.js after the standalone copy
WORKDIR /app/apps/web
CMD ["sh", "-c", "node migrate.js && node server.js"]
