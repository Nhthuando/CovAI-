# Build stage
FROM node:20-alpine AS build

WORKDIR /app

# Khai báo ARG để nhận biến môi trường từ docker-compose.prod.yml
ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_GITHUB_CLIENT_ID

# Gán vào ENV để câu lệnh 'npm run build' bên dưới nhúng được vào file dist
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
ENV VITE_GITHUB_CLIENT_ID=$VITE_GITHUB_CLIENT_ID

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the Vite app (Vite sẽ đóng gói các biến ENV ở trên vào code JS)
RUN npm run build

# Serve stage
FROM nginx:alpine

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]