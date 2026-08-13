# syntax=docker/dockerfile:1.7

# Build stage: full toolchain, thrown away. Base images are pinned by digest
# so a rebuild can't silently pick up a different upstream.
# Pinned to the *build* platform on purpose: everything this stage emits is
# JavaScript and static files, so there is nothing arch-specific to produce.
# Building it natively keeps multi-arch builds off QEMU emulation entirely.
FROM --platform=$BUILDPLATFORM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build

WORKDIR /build
ENV NODE_ENV=development

# Dependencies first: this layer only rebuilds when the lockfile changes.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# The SPA (dist/) plus the single-file server bundle (dist-server/index.mjs).
# Bundling the server means the runtime image ships no node_modules at all.
# Precompression happens here so the runtime never compresses per request.
RUN npm run build && npm run build:server && npm run precompress

# Runtime stage: distroless — no shell, no package manager, no npm, and a
# non-root user (uid 65532) baked in. The attack surface is node plus two
# directories of static output.
#
# Debian 13 (trixie), not 12: the bookworm variant ships libssl3 3.0.18 and
# glibc u13, which trivy flags with 1 CRITICAL and 5 HIGH that have fixes
# upstream but no rebuilt base image. Trixie carries none of them — its only
# findings are unfixed MEDIUMs shared by every glibc.
FROM gcr.io/distroless/nodejs22-debian13:nonroot@sha256:939d6f1671529d230f50b563578e9b5d206af58f038b10ebd7e1233023d4e167

WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
    HOST=0.0.0.0 \
    STATIC_ROOT=/app/dist

# Read-only at runtime: nothing here is written to, and the container can be
# run with --read-only.
COPY --from=build --chown=nonroot:nonroot /build/dist ./dist
COPY --from=build --chown=nonroot:nonroot /build/dist-server ./dist-server

USER nonroot
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["/nodejs/bin/node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

CMD ["dist-server/index.mjs"]

LABEL org.opencontainers.image.title="AS3 Builder" \
      org.opencontainers.image.description="Schema-aware editor for F5 AS3 per-app declarations, with NetBox and BIG-IP integration" \
      org.opencontainers.image.source="https://github.com/dewab-org/as3_builder"
