FROM --platform=linux/amd64 node:22.23.2-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=true && npm cache clean --force
COPY scripts ./scripts
COPY src ./src
COPY workers/mls-container/container ./workers/mls-container/container
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "workers/mls-container/container/server.mjs"]
