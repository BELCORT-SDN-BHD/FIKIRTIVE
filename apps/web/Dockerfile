# Fikirtive web — same base/pattern as apps/worker/Dockerfile (no ffmpeg needed).
FROM node:22-trixie-slim AS base
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/storage/package.json packages/storage/
COPY packages/db/package.json packages/db/
COPY packages/otto/package.json packages/otto/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @fikirtive/web...
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/storage packages/storage
COPY packages/db packages/db
COPY packages/otto packages/otto
COPY apps/web apps/web
RUN pnpm --filter @fikirtive/core build \
  && pnpm --filter @fikirtive/storage build \
  && pnpm --filter @fikirtive/db build \
  && pnpm --filter @fikirtive/otto build \
  && pnpm --filter @fikirtive/web build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
# Runs as root (not USER node): the Railway volume at /repo/.data is mounted
# root-owned, and LocalDiskStorage must write there until T4 moves files to R2.
# Apply pending DB migrations on every boot BEFORE serving (idempotent — `migrate
# deploy` only runs un-applied migrations), so a deploy can never serve against an
# un-migrated schema. The image carries the prisma CLI + the migrations folder.
CMD ["sh", "-c", "pnpm --filter @fikirtive/db migrate:deploy && pnpm --filter @fikirtive/web start"]
