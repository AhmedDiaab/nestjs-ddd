# syntax=docker/dockerfile:1.7

# Debian (glibc) rather than Alpine: node-oracledb thick mode needs glibc + libaio if you enable it later.
ARG NODE_VERSION=22.18.0

# ---------- base: pnpm via corepack (version pinned by package.json "packageManager") ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# ---------- build: all dependencies + compile ----------
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json tsconfig.path.json nest-cli.json ./
COPY src ./src
RUN pnpm build

# ---------- prod-deps: runtime dependencies only ----------
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod --ignore-scripts

# ---------- runtime ----------
FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    LOGGING_TO_FILE=false

WORKDIR /app

COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./

# writable only if LOGGING_TO_FILE=true is set (mount a volume at /app/logs)
RUN mkdir -p /app/logs && chown node:node /app/logs

USER node

EXPOSE 3000

# liveness only; use GET /health/ready in orchestrators that should also wait for the database
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]

# exec form: node receives SIGTERM directly, Nest shutdown hooks drain DB pools
CMD ["node", "dist/main.js"]
