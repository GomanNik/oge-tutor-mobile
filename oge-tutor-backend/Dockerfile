FROM node:22-alpine AS build

WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable \
  && corepack prepare pnpm@9.15.9 --activate \
  && pnpm config set store-dir /pnpm/store \
  && pnpm config set registry https://registry.npmjs.org/ \
  && pnpm config set fetch-retries 5 \
  && pnpm config set fetch-retry-mintimeout 10000 \
  && pnpm config set fetch-retry-maxtimeout 60000 \
  && pnpm config set network-timeout 300000

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY oge-tutor-backend/package.json ./oge-tutor-backend/package.json
COPY oge-tutor-app/package.json ./oge-tutor-app/package.json
RUN --mount=type=cache,id=oge-tutor-backend-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter oge-tutor-backend...

COPY oge-tutor-backend ./oge-tutor-backend
ENV DATABASE_URL=postgresql://postgres:postgres@localhost:5432/oge_tutor?schema=public
RUN pnpm --dir oge-tutor-backend run prisma:generate
RUN pnpm --dir oge-tutor-backend run build

FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable \
  && corepack prepare pnpm@9.15.9 --activate \
  && pnpm config set store-dir /pnpm/store \
  && pnpm config set registry https://registry.npmjs.org/ \
  && pnpm config set fetch-retries 5 \
  && pnpm config set fetch-retry-mintimeout 10000 \
  && pnpm config set fetch-retry-maxtimeout 60000 \
  && pnpm config set network-timeout 300000

COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/oge-tutor-backend ./oge-tutor-backend

WORKDIR /app/oge-tutor-backend
EXPOSE 3000

CMD ["node", "dist/src/main.js"]
