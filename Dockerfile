# Taptana en un contenedor. Uso:
#   docker compose up -d        (o: docker build -t taptana . && docker run -p 4321:4321 -v taptana-data:/data taptana)
#   docker compose logs taptana  → ahí sale el link del panel con su llave (?key=…)
#
# Dentro de Docker ninguna conexión cuenta como "esta computadora", así que el panel siempre se
# abre con el link con llave que imprimen los registros. El link de participante no la necesita.

# ── Etapa 1: compilar ────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
# Primero solo los manifiestos: así la instalación queda en caché mientras no cambien.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/recorder/package.json packages/recorder/
COPY packages/web/package.json packages/web/
COPY packages/server/package.json packages/server/
# Solo los paquetes del producto: sin Playwright ni otras herramientas de la raíz.
RUN pnpm install --frozen-lockfile --filter "./packages/*"
COPY packages packages
COPY examples examples
RUN pnpm build
# El servidor con sus dependencias de producción, listo para copiar (sin node_modules de desarrollo).
RUN pnpm --filter @taptana/server deploy --prod --legacy /out

# ── Etapa 2: ejecutar ────────────────────────────────────────────────
FROM node:22-alpine
ENV NODE_ENV=production \
    TAPTANA_DATA_DIR=/data \
    TAPTANA_HOST=0.0.0.0 \
    TAPTANA_PORT=4321
WORKDIR /app
COPY --from=build --chown=node:node /out ./
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4321
# /api/v1/info es pública (no pide la llave del panel): sirve para saber si el servidor responde.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${TAPTANA_PORT}/api/v1/info" || exit 1
CMD ["node", "--no-warnings=ExperimentalWarning", "dist/cli.js", "dev", "--no-open", "--no-qr"]
