FROM node:25-alpine
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ ./packages/
RUN npm install -g pnpm@latest-10
RUN npm install -g bun
RUN pnpm install
RUN pnpm run build-frontend
RUN pnpm run copy-frontend
EXPOSE 5000
CMD ["pnpm", "run", "prod:server"]
