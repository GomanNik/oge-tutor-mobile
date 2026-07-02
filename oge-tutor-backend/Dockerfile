FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY oge-tutor-backend/package.json ./oge-tutor-backend/package.json
COPY oge-tutor-app/package.json ./oge-tutor-app/package.json
RUN pnpm install --frozen-lockfile --filter oge-tutor-backend...

COPY oge-tutor-backend ./oge-tutor-backend
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/oge_tutor?schema=public
RUN pnpm --dir oge-tutor-backend run prisma:generate
RUN pnpm --dir oge-tutor-backend run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/oge-tutor-backend ./oge-tutor-backend

WORKDIR /app/oge-tutor-backend
EXPOSE 3000

CMD ["node", "dist/src/main.js"]
