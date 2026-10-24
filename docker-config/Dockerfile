# syntax=docker/dockerfile:1
ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim AS dependencies
ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"
ENV HUSKY=0 CI=true
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=secret,id=node_auth_token,required=true \
    set -eu; \
    printf '@commodo-sas:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=%s\n' "$(cat /run/secrets/node_auth_token)" > /tmp/npmrc; \
    NPM_CONFIG_USERCONFIG=/tmp/npmrc pnpm install --frozen-lockfile; \
    rm /tmp/npmrc

FROM dependencies AS build
COPY . .
RUN pnpm build

FROM dependencies AS production-dependencies
RUN pnpm prune --prod --ignore-scripts

FROM node:${NODE_VERSION}-bookworm-slim AS runner
ENV NODE_ENV=production ENV=PROD PLATFORM=LINUX
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates dumb-init \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --chown=node:node package.json ./
COPY --chown=node:node --from=production-dependencies /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
USER node
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://127.0.0.1:8000/microbalances/api/v1/health-check',(res)=>process.exit(res.statusCode===200?0:1)).on('error',()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/apps/microbalances-worker/main.js"]
