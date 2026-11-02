FROM node:24-slim

# Orchestrator only: imported applications never receive this socket or CLI.
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:27-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx

WORKDIR /app

# Install openssl for Prisma, git for githubClone.service, procps (ps) for process tree management, and configure safe.directory for container volume mounts
RUN apt-get update -y && apt-get install -y openssl git procps && rm -rf /var/lib/apt/lists/* && git config --global --add safe.directory "*"

# Copy package files
COPY package*.json ./

# Install dependencies with retry and network resiliency
RUN npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 20000 && \
    npm config set fetch-retry-maxtimeout 120000 && \
    npm install --no-audit --no-fund

# Copy source code
COPY . .

# Ensure runtime directories exist
RUN mkdir -p storage uploads

# Generate Prisma client
RUN npx prisma generate

# Expose port
EXPOSE 5000

# Start the server
CMD ["npm", "run", "start"]
