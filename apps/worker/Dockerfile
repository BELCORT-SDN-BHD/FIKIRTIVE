# Fikirtive worker — Debian trixie for ffmpeg 7.x (eng review D10: apt ffmpeg,
# NOT ffmpeg-static which is stuck on 6.x; NOT fluent-ffmpeg which is archived).
FROM node:22-trixie-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates fonts-dejavu-core fontconfig libgomp1 \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
# --- nightly DB backup (P0-1②): pg_dump from pgdg, pinned to major 17 ---
# pg_dump's major must be >= the server major (Neon runs the current major;
# 17-dumps-16 is fine, 16-dumps-17 is not). pgdg (not the Debian archive) so
# the pin holds regardless of what trixie ships. Additive block — nothing
# above or below this may change (see REVIEWER-PLAYBOOK Dockerfile invariants).
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc -o /usr/share/keyrings/pgdg.asc \
  && echo "deb [signed-by=/usr/share/keyrings/pgdg.asc] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build
# --- whisper.cpp: self-hosted $0 transcription (no apt package on trixie) ---
# -DGGML_NATIVE=OFF is REQUIRED: without it ggml bakes the build host's
# -march=native SIMD into the binary, which SIGILLs at runtime if the build
# host has wider SIMD than the runtime host. OFF builds a portable baseline.
ARG WHISPER_REF=v1.7.4
ARG WHISPER_MODEL=base.en
RUN apt-get update \
  && apt-get install -y --no-install-recommends git build-essential cmake curl \
  && rm -rf /var/lib/apt/lists/* \
  && git clone --depth 1 --branch "${WHISPER_REF}" https://github.com/ggml-org/whisper.cpp /tmp/whisper.cpp \
  && cmake -S /tmp/whisper.cpp -B /tmp/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  && cmake --build /tmp/whisper.cpp/build -j --config Release --target whisper-cli \
  && install -Dm755 /tmp/whisper.cpp/build/bin/whisper-cli /opt/whisper/bin/whisper-cli \
  && mkdir -p /opt/whisper/models \
  && bash /tmp/whisper.cpp/models/download-ggml-model.sh "${WHISPER_MODEL}" /opt/whisper/models \
  && rm -rf /tmp/whisper.cpp
WORKDIR /repo
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/storage/package.json packages/storage/
COPY packages/generation/package.json packages/generation/
COPY packages/db/package.json packages/db/
COPY packages/otto/package.json packages/otto/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @fikirtive/worker...
COPY tsconfig.base.json ./
COPY packages/core packages/core
COPY packages/storage packages/storage
COPY packages/generation packages/generation
COPY packages/db packages/db
COPY packages/otto packages/otto
COPY apps/worker apps/worker
RUN pnpm --filter @fikirtive/core build \
  && pnpm --filter @fikirtive/storage build \
  && pnpm --filter @fikirtive/generation build \
  && pnpm --filter @fikirtive/db build \
  && pnpm --filter @fikirtive/otto build \
  && pnpm --filter @fikirtive/worker build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=build /repo ./
COPY --from=build /opt/whisper/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=build /opt/whisper/models /opt/whisper/models
ENV WHISPER_MODEL_PATH=/opt/whisper/models/ggml-base.en.bin
USER node
CMD ["node", "apps/worker/dist/index.js"]
