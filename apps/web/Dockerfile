# Artlio web — same base/pattern as apps/worker/Dockerfile (no ffmpeg needed).
FROM node:22-trixie-slim AS base
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/storage/package.json packages/storage/
COPY packages/db/package.json packages/db/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @artlio/web...
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/storage packages/storage
COPY packages/db packages/db
COPY apps/web apps/web
RUN pnpm --filter @artlio/core build \
  && pnpm --filter @artlio/storage build \
  && pnpm --filter @artlio/db build \
  && pnpm --filter @artlio/web build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
# Runs as root (not USER node): the Railway volume at /repo/.data is mounted
# root-owned, and LocalDiskStorage must write there until T4 moves files to R2.
CMD ["pnpm", "--filter", "@artlio/web", "start"]
