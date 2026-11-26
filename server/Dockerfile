FROM node:24-slim

WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/* && git config --global --add safe.directory "*"

# Copy đúng package.json của thư mục server để cài thư viện backend
COPY server/package*.json ./

RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm install --no-audit --no-fund && \
    npx playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*

# Copy code trong server và thư mục shared dùng chung
COPY server/ ./
COPY shared/ /shared/

RUN mkdir -p storage uploads
RUN npx prisma generate

EXPOSE 5000
CMD ["npm", "run", "start"]