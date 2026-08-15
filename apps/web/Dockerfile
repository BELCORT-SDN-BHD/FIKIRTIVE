# Fikirtive web — same base/pattern as apps/worker/Dockerfile (no ffmpeg needed).
FROM node:22-trixie-slim AS base
RUN corepack enable

FROM base AS build
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/token-crypto/package.json packages/token-crypto/
COPY packages/storage/package.json packages/storage/
COPY packages/db/package.json packages/db/
COPY packages/otto/package.json packages/otto/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @fikirtive/web...
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/token-crypto packages/token-crypto
COPY packages/storage packages/storage
COPY packages/db packages/db
COPY packages/otto packages/otto
COPY apps/web apps/web
# token-crypto (AES-256-GCM + signed media-proxy token) is a workspace dep of @fikirtive/web
# (app/api/media/pub/[token] verifies the signed URL). Build it before web or the skinny image
# can't resolve @fikirtive/token-crypto.
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
RUN pnpm --filter @fikirtive/core build \
  && pnpm --filter @fikirtive/token-crypto build \
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
#
# Apply pending DB migrations on every boot BEFORE serving (idempotent — `migrate deploy`
# only runs un-applied migrations), so a deploy can never serve against an un-migrated
# schema. The image carries the prisma CLI + the migrations folder.
#
# #796: this used to be `migrate:deploy && start`, where `&&` was the entire error policy —
# a failed migration exited the container, Railway restarted it, and the WHOLE SITE sat in a
# crash loop hammering the database with one migration per restart. boot.mjs bounds the
# retries and, if they are exhausted, still starts the server (an old-schema site beats no
# site) while shouting about it in the logs, in Sentry, and in /api/health. Read the file's
# header before changing this line — the tradeoff it accepts is spelled out there.
CMD ["node", "apps/web/scripts/boot.mjs"]
