FROM node:20-slim

WORKDIR /app

# Install openssl for Prisma
RUN apt-get update -y && apt-get install -y openssl

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
