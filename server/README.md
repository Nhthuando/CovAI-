# CovAI Server — Backend API & Analysis Engine

Ứng dụng Backend API chính của nền tảng **CovAI**, chịu trách nhiệm điều phối toàn bộ quy trình: phân tích tĩnh AST, bóc tách dòng mã thực thi (CFG / Coverage), kích hoạt container kiểm thử cô lập (Docker Sandbox), chạy hàng đợi tác vụ ngầm (BullMQ / Redis), tích hợp mô hình Google Gemini để tự động sinh test và đánh giá độ tin cậy của AI Chatbot.

---

## 🛠️ Công Nghệ Cốt Lõi

- **Runtime & Framework**: [Node.js v20+ (ES Modules)](https://nodejs.org/) + [Express.js v5](https://expressjs.com/)
- **Database & ORM**: PostgreSQL ([Neon Database](https://neon.tech/)) + [Prisma ORM v7](https://www.prisma.io/)
- **Queue & Background Jobs**: [Redis 7](https://redis.io/) + [BullMQ](https://bullmq.io/)
- **Realtime Gateway**: [Socket.IO](https://socket.io/) (Phục vụ thông báo tiến độ & Yjs Collaborative IDE)
- **Code Parsing & AST**: [@babel/parser](https://babeljs.io/), `@babel/traverse`, [Esprima](https://esprima.org/)
- **Test Runners**: Jest, Vitest, Supertest, Playwright, Cypress
- **Generative AI**: [Google Gemini 2.5](https://ai.google.dev/) (`@google/generative-ai`)
- **Container Sandbox**: Docker Engine API

---

## 📁 Cấu Trúc Thư Mục (`server/src/`)

```text
server/
├── src/
│   ├── controllers/      # 26 HTTP Controllers xử lý request/response
│   ├── services/         # Nghiệp vụ cốt lõi:
│   │   ├── gemini.service.js               # Gọi Gemini LLM sinh test & đánh giá
│   │   ├── unitTestGenerator.service.js    # Phân tích độ phủ & sinh Unit Test
│   │   ├── supertestCoverageJob.service.js # Điều phối pipeline Integration Test
│   │   ├── systemTestRunner.service.js     # Điều phối runner Playwright/Cypress
│   │   ├── queue.service.js                # Quản lý hàng đợi BullMQ / Redis
│   │   └── aiEvaluation/                   # Đánh giá độ tin cậy AI Chatbot
│   ├── routes/           # Định tuyến API RESTful
│   ├── middlewares/      # Xác thực JWT, Rate limiting, Phân quyền RBAC, Multer upload
│   ├── realtime/         # Gateway Socket.IO kết nối Monaco Collaborative IDE
│   ├── config/           # Cấu hình Prisma, Redis, Firebase
│   ├── utils/            # Detectors framework (Jest, Vitest, Playwright, Cypress), Logger...
│   ├── validators/       # Zod schemas kiểm tra dữ liệu đầu vào
│   └── tests/            # Bộ Unit Test Jest nội bộ của server
├── prisma/               # Schema cơ sở dữ liệu (`schema.prisma`) & migrations
├── storage/              # Lưu trữ mã nguồn dự án được tải lên
├── uploads/              # Lưu trữ file ZIP tạm thời
├── scripts/              # Script hỗ trợ vận hành & kiểm thử nội bộ
├── index.js              # Entry point chính của Node.js Express server
└── package.json          # Cấu hình dependencies & scripts của server
```

---

## 🚀 Khởi Chạy Local

### 1. Cài Đặt Dependencies:
```bash
npm install
```

### 2. Cấu Hình Biến Môi Trường:
Tạo file `.env` trong thư mục `server/`:
```env
PORT=5000
CLIENT_URL=http://localhost:5173
DATABASE_URL="postgresql://user:password@host/covai?sslmode=require"
REDIS_URL="redis://127.0.0.1:6379"
JWT_SECRET="your-jwt-secret-key"
GEMINI_API_KEY="your-google-gemini-api-key"
PROJECT_STORAGE_ROOT="./storage/projects"
```

### 3. Đồng Bộ Cơ Sở Dữ Liệu Prisma:
```bash
npx prisma generate
npx prisma db push
```

### 4. Khởi Động Server Dev (Tự Động Reload):
```bash
npm run dev
```
Backend API sẽ hoạt động tại: `http://localhost:5000/api`.

---

## 🧪 Chạy Kiểm Thử (Tests):
```bash
# Chạy Jest unit tests
npm test

# Chạy test đánh giá AI Chatbot
npm run test:evaluation
```

---

## 📜 Quy Chuẩn Lập Trình Cho AI & Dev
Vui lòng tham khảo tài liệu hướng dẫn bắt buộc:
- [`server/AGENTS.md`](./AGENTS.md): Quy tắc lập trình & tiêu chuẩn mã nguồn Backend.
- [`AGENTS.md`](../AGENTS.md): Quy tắc làm việc Monorepo toàn dự án.
