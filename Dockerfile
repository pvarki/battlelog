FROM node:24-slim AS build
WORKDIR /usr/src/app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm -C server exec varlock typegen
RUN pnpm -r build

FROM node:24-slim AS production
# ca-certificates is not optional here even though nothing in the app fetches a
# public URL. kw_product_init enrols us by POSTing the CSR to RASENMAEHER's
# PUBLIC endpoint — it has no client certificate yet, so that call cannot use
# mTLS — and it verifies against x509.SystemCertPool() plus whatever is in
# /ca_public. node:24-slim ships no CA bundle at all, so in a deployment whose
# public endpoint has a Let's Encrypt certificate the pool contained nothing
# that could vouch for it and enrolment died with "certificate signed by
# unknown authority". It passed locally only because the local public endpoint
# is signed by miniwerk's CA, which /ca_public does carry.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/*

# Enrols us with RASENMAEHER on first run: turns the CSR JWT in the kraftwerk
# manifest into the client certificate we authenticate to TAK and to sibling
# products with. Same helper every other product image in the composition uses.
COPY --from=ghcr.io/pvarki/kraftwerk-helper-tool:1.3.0-260513 /kw_product_init /kw_product_init

WORKDIR /usr/src/app

# Somewhere the unprivileged user can also read: the entrypoint drops to `node`
# before starting the server, and corepack's default cache lives in root's HOME.
ENV COREPACK_HOME=/usr/local/share/corepack

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY server/package.json server/
COPY web/package.json web/
RUN pnpm install --prod --frozen-lockfile --filter server

COPY --from=build /usr/src/app/server/dist ./server/dist
COPY --from=build /usr/src/app/server/drizzle ./server/drizzle
COPY --from=build /usr/src/app/server/.env.schema ./server/.env.schema
COPY --from=build /usr/src/app/server/templates ./server/templates
COPY --from=build /usr/src/app/web/dist ./web/dist

COPY docker/container-init.sh /container-init.sh
COPY docker/entrypoint.sh /docker-entrypoint.sh

RUN mkdir -p server/uploads /data/persistent \
    && chown -R node:node /usr/src/app /data/persistent "$COREPACK_HOME" \
    && chmod a+x /container-init.sh /docker-entrypoint.sh

# Drives the env schema's forEnv() defaults: mTLS user enforcement on, Swagger off.
ENV NODE_ENV=production

# Deliberately root: container-init writes /etc/hosts and runs the certificate
# enrolment. The entrypoint drops to the node user before starting the server.
WORKDIR /usr/src/app/server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:3000/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/docker-entrypoint.sh"]
