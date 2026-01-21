# Usamos Node 20 sobre base Alpine
FROM node:20-alpine

# Instalamos pnpm globalmente y dependencias de sistema
RUN corepack enable && corepack prepare pnpm@latest --activate
RUN apk add --no-cache libc6-compat git

WORKDIR /app

# Copiamos los archivos de definición de dependencias
COPY pnpm-lock.yaml package.json ./

# Instalamos las dependencias usando pnpm
# --frozen-lockfile asegura que usemos las versiones exactas del lock
RUN pnpm install --frozen-lockfile

# Copiamos el resto del código
COPY . .

# Construimos el proyecto NestJS
RUN NODE_OPTIONS="--max-old-space-size=2048" pnpm run build

# Exponemos el puerto
EXPOSE 3000

# Comando para arrancar la app
CMD ["pnpm", "run", "start:prod"]