FROM platformatic/node-caged:26-slim@sha256:7e05b71d1249f733b465bc3abc6b3e5854f183d2837bdd264f40b94947b9e6fc
RUN node -e 'if (process.version !== "v26.12.1") process.exit(1)'
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ ./packages/
RUN npm install -g pnpm@latest-10
RUN npm install -g bun@1.4.0
RUN pnpm install
RUN pnpm run build-frontend
RUN pnpm run copy-frontend
RUN mkdir -p /app/data
EXPOSE 5000
CMD ["pnpm", "run", "prod:server"]
