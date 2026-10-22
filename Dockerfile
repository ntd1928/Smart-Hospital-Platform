FROM node:22.22.0-bookworm-slim AS dependencies
WORKDIR /app
RUN npm install --global npm@11.21.1
COPY package.json package-lock.json .npmrc ./
COPY packages/app/package.json ./packages/app/package.json
COPY packages/server/package.json ./packages/server/package.json
RUN npm ci

FROM dependencies AS source
COPY . .
RUN mkdir -p /app/.runtime /app/packages/server/binary && chown -R node:node /app/.runtime /app/packages/server/binary

FROM source AS seed
USER node
CMD ["node", "--import", "tsx", "scripts/seed.ts"]

FROM source AS server-build
RUN npm run build -w @smart-hospital/server

FROM dependencies AS production-dependencies
RUN npm prune --omit=dev

FROM node:22.22.0-bookworm-slim AS server
ENV NODE_ENV=production
WORKDIR /app
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/packages/server ./packages/server
COPY --from=server-build /app/packages/server/dist ./packages/server/dist
COPY packages/server/medplum.config.json ./packages/server/medplum.config.json
COPY LICENSE.txt NOTICE ./
RUN mkdir -p /app/packages/server/binary && chown node:node /app/packages/server/binary
WORKDIR /app/packages/server
USER node
EXPOSE 8103
CMD ["node", "dist/index.js"]

FROM source AS web-build
RUN npm run build -w @smart-hospital/app

FROM nginx:1.28-alpine AS web
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/packages/app/dist /usr/share/nginx/html
COPY LICENSE.txt NOTICE /usr/share/licenses/smart-hospital/
EXPOSE 8080
