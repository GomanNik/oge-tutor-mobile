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
COPY oge-tutor-app/package.json ./oge-tutor-app/package.json
COPY oge-tutor-backend/package.json ./oge-tutor-backend/package.json
RUN --mount=type=cache,id=oge-tutor-frontend-pnpm-store,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter oge-tutor-app...

COPY oge-tutor-app ./oge-tutor-app
ARG VITE_API_BASE_URL=http://localhost:3000
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
ENV VITE_USE_MOCK=false
RUN pnpm --dir oge-tutor-app run build

FROM nginx:1.27-alpine

COPY oge-tutor-app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/oge-tutor-app/dist /usr/share/nginx/html

EXPOSE 80
