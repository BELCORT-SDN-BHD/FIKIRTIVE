# Artlio worker — Debian trixie for ffmpeg 7.x (eng review D10: apt ffmpeg,
# NOT ffmpeg-static which is stuck on 6.x; NOT fluent-ffmpeg which is archived).
FROM node:22-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/storage/package.json packages/storage/
COPY packages/generation/package.json packages/generation/
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @artlio/worker...
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/storage packages/storage
COPY packages/generation packages/generation
COPY packages/db packages/db
COPY apps/worker apps/worker
RUN pnpm --filter @artlio/core build \
  && pnpm --filter @artlio/storage build \
  && pnpm --filter @artlio/generation build \
  && pnpm --filter @artlio/db build \
  && pnpm --filter @artlio/worker build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
USER node
CMD ["node", "apps/worker/dist/index.js"]
