# 1. Etapa de Construcción (Build)
FROM node:20-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY pnpm-lock.yaml package.json ./
RUN pnpm install --frozen-lockfile

COPY . .
# Aumentamos memoria para el build (vital para tu t3.micro)
RUN NODE_OPTIONS="--max-old-space-size=2048" pnpm run build

# 2. Etapa de Producción (Mucho más ligera)
FROM node:20-alpine
WORKDIR /app

# Solo copiamos lo necesario para ejecutar
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Exponemos puerto
EXPOSE 3000

# Ejecutamos directamente con Node (ahorra RAM y evita problemas de procesos)
CMD ["node", "dist/main.js"]