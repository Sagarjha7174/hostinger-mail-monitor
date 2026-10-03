# syntax=docker/dockerfile:1.7
# Multi-stage build for both the Next.js app and the sync worker (same image, different command).

FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# ---- deps: full install for building
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

# ---- build: prisma client, next standalone
FROM deps AS build
COPY . .
RUN npx prisma generate \
 && npm run build

# ---- prod-deps: full node_modules so we can use tsx in production for worker/proxy
FROM base AS prod-deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate && npm cache clean --force

# ---- runner
FROM base AS runner
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/worker ./worker
COPY --from=build --chown=app:app /app/proxy ./proxy
COPY --from=build --chown=app:app /app/src ./src
COPY --from=build --chown=app:app /app/tsconfig.json ./tsconfig.json
USER app
EXPOSE 3000
CMD ["node", "server.js"]
