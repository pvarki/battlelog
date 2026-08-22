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
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

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

RUN mkdir -p server/uploads && chown -R node:node /usr/src/app

USER node

WORKDIR /usr/src/app/server

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:3000/healthz || exit 1

CMD ["pnpm", "run", "start"]
