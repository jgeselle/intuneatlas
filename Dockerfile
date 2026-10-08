# syntax=docker/dockerfile:1
#
# IntuneAtlas as a container: the shared web UI (`intuneatlas ui`), for hosting
# behind something that terminates TLS — Azure Container Apps (see infra/azure),
# or any reverse proxy.
#
#   docker run -p 7878:7878 -v intuneatlas-data:/data \
#     -e INTUNEATLAS_TENANT_ID=contoso.onmicrosoft.com \
#     -e INTUNEATLAS_CLIENT_ID=<application-id> \
#     ghcr.io/jgeselle/intuneatlas
#
# Everything it keeps — scans, notes, staged changes, baselines — lives under
# /data. Mount a volume there or it is gone with the container.

FROM node:22-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# HOME is where the app keeps its state (~/.intuneatlas); pointing it at the
# volume is all it takes. INTUNEATLAS_HOST makes it listen beyond loopback,
# which is the point of a container.
ENV NODE_ENV=production \
    HOME=/data \
    INTUNEATLAS_HOST=0.0.0.0
WORKDIR /app
COPY --from=build /src/package.json ./
COPY --from=build /src/node_modules ./node_modules
COPY --from=build /src/dist ./dist
COPY --from=build /src/web/dist ./web/dist
COPY baselines ./baselines
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 7878
ENTRYPOINT ["node", "dist/cli.js"]
CMD ["ui"]
