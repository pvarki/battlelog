FROM node:24-slim AS build
WORKDIR /usr/src/app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec varlock typegen
RUN pnpm run build

FROM node:24-slim AS production
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/drizzle ./drizzle
COPY --from=build /usr/src/app/.env.schema ./.env.schema

RUN mkdir -p uploads public && chown -R node:node /usr/src/app

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://localhost:3000/healthz || exit 1

CMD ["pnpm", "run", "start"]
