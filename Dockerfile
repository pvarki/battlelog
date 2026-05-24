FROM node:22-slim AS build
WORKDIR /usr/src/app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec varlock typegen
RUN pnpm run build

FROM node:22-slim AS production
RUN apt-get update && apt-get install -y curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=build /usr/src/app/dist ./dist
COPY --from=build /usr/src/app/drizzle ./drizzle
COPY --from=build /usr/src/app/.env.schema ./.env.schema

EXPOSE 3000

CMD ["pnpm", "run", "start"]
