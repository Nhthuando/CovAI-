FROM node:20-slim

WORKDIR /app

# Install openssl for Prisma and git for githubClone.service
RUN apt-get update -y && apt-get install -y openssl git

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Expose port
EXPOSE 5000

# Start the server
CMD ["npm", "run", "start"]
