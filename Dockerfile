# syntax=docker/dockerfile:1.7
# Pinned by digest for reproducible, tamper-evident builds. Refresh with:
#   docker buildx imagetools inspect node:24.22.1-alpine   (use the top-level index "Digest")
ARG NODE_IMAGE=node:24.22.1-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53

# ---------- build: install all deps, typecheck, test, bundle ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/widget/package.json packages/widget/
COPY apps/server/package.json apps/server/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY packages/widget packages/widget
COPY apps/server apps/server
RUN npm run typecheck && npm test && npm run build

# ---------- deps: production dependencies of the server only ----------
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/widget/package.json packages/widget/
COPY apps/server/package.json apps/server/
RUN --mount=type=cache,target=/root/.npm \
    npm ci --omit=dev --workspace=@consent/server --include-workspace-root=false --no-audit --no-fund

# ---------- runtime: minimal, non-root, read-only friendly ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8080
# Patch OS packages and drop npm/yarn/corepack: nothing needs a package manager at runtime.
RUN apk upgrade --no-cache \
 && rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
           /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /opt/yarn* /usr/local/bin/yarn*
WORKDIR /app
# Files stay owned by root so the app user cannot modify its own code.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/apps/server/package.json apps/server/package.json
COPY --from=build /app/apps/server/dist apps/server/dist
COPY --from=build /app/apps/server/migrations apps/server/migrations
COPY --from=build /app/packages/widget/dist packages/widget/dist
COPY demo demo
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "apps/server/dist/healthcheck.js"]
CMD ["node", "apps/server/dist/index.js"]
