# syntax=docker/dockerfile:1.7
# Compila el panel con la configuración de Cognito del entorno y deja el sitio estático en /site.
#   docker build -f apps/web/Dockerfile --build-arg VITE_COGNITO_DOMAIN=... --build-arg VITE_COGNITO_CLIENT_ID=... \
#     --output type=local,dest=build/web .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json packages/shared-types/
COPY packages/schedule-validator/package.json packages/schedule-validator/
COPY packages/api-client/package.json packages/api-client/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @us/web --workspace @us/api-client --workspace @us/shared-types --include-workspace-root=false
COPY packages/shared-types packages/shared-types
COPY packages/api-client packages/api-client
COPY apps/web apps/web
ARG VITE_COGNITO_DOMAIN
ARG VITE_COGNITO_CLIENT_ID
ENV VITE_COGNITO_DOMAIN=$VITE_COGNITO_DOMAIN VITE_COGNITO_CLIENT_ID=$VITE_COGNITO_CLIENT_ID
RUN npm run build -w @us/web

FROM scratch
COPY --from=build /repo/apps/web/dist /
