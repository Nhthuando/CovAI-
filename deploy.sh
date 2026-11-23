#!/bin/bash
set -e

echo "🚀 BẮT ĐẦU TRIỂN KHAI DỰ ÁN COVAI (PROD)"

if [ -d ".git" ]; then
    echo "📦 Đang kéo code mới từ Git..."
    git pull origin main
fi

echo "🛑 Dừng các container phiên bản trước..."
docker compose -f docker-compose.prod.yml down --remove-orphans

echo "🔨 Đang build image và khởi động services..."
docker compose -f docker-compose.prod.yml up -d --build

echo "⏳ Đang đợi server khởi động hoàn tất..."
sleep 5

echo "🗄️ Đang đồng bộ Prisma Schema vào Database..."
docker compose -f docker-compose.prod.yml exec -T server npx prisma generate

echo "📊 TRẠNG THÁI HỆ THỐNG:"
docker compose -f docker-compose.prod.yml ps

echo "✅ TRIỂN KHAI THÀNH CÔNG!"
echo "🌐 Truy cập giao diện tại: http://covai-capstone.eastasia.cloudapp.azure.com"
echo "📜 Để xem log server: docker compose -f docker-compose.prod.yml logs -f server"
echo "💾 Để xem tình trạng server: docker stats --no-stream"
echo "❌ Để tắt server: docker compose -f docker-compose.prod.yml down"
