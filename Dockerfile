# syntax=docker/dockerfile:1
FROM node:24.19.0-trixie-slim@sha256:ab3eebe934147fee049b5eb83c570f68c849a13c930bdfa482de99fcdfa3b3de AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 FORCE_COLOR=0
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS builder
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=1536
RUN pnpm build

FROM dependencies AS operator-dependencies
RUN pnpm prune --prod

FROM scratch AS context-audit
COPY . /context

FROM node:24.19.0-trixie-slim@sha256:ab3eebe934147fee049b5eb83c570f68c849a13c930bdfa482de99fcdfa3b3de AS base
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 FORCE_COLOR=0 NODE_OPTIONS=--max-old-space-size=384
RUN groupadd --gid 10001 gunita && useradd --uid 10001 --gid 10001 --no-create-home gunita

FROM base AS operator
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client-17 ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=operator-dependencies /app/node_modules ./node_modules
COPY package.json ./
COPY scripts ./scripts
COPY src/server/db ./src/server/db
COPY assets/geo ./assets/geo
USER 10001:10001
ENTRYPOINT ["node", "scripts/container-entry.mjs"]
CMD ["maintenance"]

FROM base AS web
COPY --from=builder --chown=10001:10001 /app/.next/standalone ./.next/standalone
COPY package.json ./
COPY scripts/start.mjs scripts/env.mjs scripts/load-env.mjs scripts/container-entry.mjs scripts/container-secrets.mjs ./scripts/
USER 10001:10001
EXPOSE 3000
ENTRYPOINT ["node", "scripts/container-entry.mjs"]
CMD ["web"]
