# syntax=docker/dockerfile:1.7
# Construir desde la raíz del monorepo: docker build -f apps/api/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/schedule-validator/package.json packages/schedule-validator/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @us/api --workspace @us/shared-types --workspace @us/schedule-validator --include-workspace-root=false
COPY packages/shared-types packages/shared-types
COPY packages/schedule-validator packages/schedule-validator
COPY apps/api apps/api
RUN npm run build -w @us/shared-types && npm run build -w @us/schedule-validator && npm run build -w @us/api \
 && npm prune --omit=dev --workspace @us/api --workspace @us/shared-types --workspace @us/schedule-validator

FROM node:22-alpine
RUN apk add --no-cache postgresql16-client bash tini
WORKDIR /repo
ENV NODE_ENV=production SCHEMAS_DIR=/repo/data/schemas
COPY --from=build /repo/node_modules node_modules
COPY --from=build /repo/packages/shared-types packages/shared-types
COPY --from=build /repo/packages/schedule-validator packages/schedule-validator
COPY --from=build /repo/apps/api/dist apps/api/dist
COPY --from=build /repo/apps/api/package.json apps/api/package.json
COPY apps/api/db apps/api/db
COPY data/schemas data/schemas
WORKDIR /repo/apps/api
USER node
EXPOSE 3000
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
