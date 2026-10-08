FROM node:20-slim

WORKDIR /app

# Install openssl for Prisma and git for githubClone.service
RUN apt-get update -y && apt-get install -y openssl git && rm -rf /var/lib/apt/lists/*

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