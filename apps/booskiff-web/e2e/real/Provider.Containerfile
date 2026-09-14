FROM oven/bun:1.3.13-slim@sha256:7e8ed3961db1cdedf17d516dda87948cfedbd294f53bf16462e5b57ed3fff0f1
WORKDIR /provider
COPY package.json bun.lock ./
COPY apps/booskiff-web/package.json apps/booskiff-web/package.json
COPY apps/emumet-web/package.json apps/emumet-web/package.json
COPY apps/ui-catalog/package.json apps/ui-catalog/package.json
COPY packages ./packages
RUN bun install --frozen-lockfile --ignore-scripts
COPY apps/booskiff-web/e2e/real/provider.ts apps/booskiff-web/e2e/real/provider.ts
WORKDIR /provider/apps/booskiff-web
CMD ["bun", "e2e/real/provider.ts"]
