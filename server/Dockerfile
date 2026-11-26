FROM node:24-slim

WORKDIR /app

RUN apt-get update -y && \
    apt-get install -y --no-install-recommends openssl git ca-certificates && \
    update-ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    git config --global --add safe.directory "*"

ENV GIT_TERMINAL_PROMPT=0 \
    GIT_CONFIG_COUNT=1 \
    GIT_CONFIG_KEY_0=safe.directory \
    GIT_CONFIG_VALUE_0=*

COPY package*.json ./

# Install dependencies with retry and network resiliency (includes Playwright Chromium for in-process System Tests without Docker-in-Docker)
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm install --no-audit --no-fund && \
    npx playwright install --with-deps chromium && \
    rm -rf /var/lib/apt/lists/*

COPY . .

RUN mkdir -p storage/projects uploads .covai-temp
RUN npx prisma generate

VOLUME ["/app/storage"]

EXPOSE 5000
CMD ["npm", "run", "start"]