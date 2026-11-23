# Build stage
FROM node:24-alpine AS build

WORKDIR /app

ARG VITE_API_URL
ARG VITE_SOCKET_URL
ARG VITE_GITHUB_CLIENT_ID

ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SOCKET_URL=$VITE_SOCKET_URL
ENV VITE_GITHUB_CLIENT_ID=$VITE_GITHUB_CLIENT_ID

# Copy package.json của client vào trước để tận dụng cache
COPY client/package*.json ./
RUN npm install

# Copy toàn bộ code client vào /app
COPY client/ ./

# Copy thư mục shared ra ngoài cấp tương ứng để các import "../../../shared" tìm thấy
COPY shared/ /shared/
# Hoặc copy vào đúng vị trí tương đối nếu project tổ chức root:
COPY shared/ ../shared/

# Build Vite
RUN npm run build

# Serve stage với Nginx
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]