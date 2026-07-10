# TestCovAI

> AI-powered Test Coverage Analysis & Jest Test Generation Platform

## Giới thiệu

TestCovAI là hệ thống hỗ trợ phân tích độ bao phủ kiểm thử (Test Coverage), Cyclomatic Complexity (CC), Control Flow Graph (CFG) và sử dụng AI để đề xuất cũng như sinh test case tự động cho các dự án JavaScript.

Người dùng có thể upload source code dưới dạng file ZIP hoặc import trực tiếp từ GitHub Repository để hệ thống thực hiện phân tích, đánh giá chất lượng kiểm thử và sinh test case bằng AI.

---

## Mục tiêu dự án

Các nhóm phát triển phần mềm thường gặp các vấn đề:

- Không biết phần nào của source code chưa được kiểm thử.
- Khó xác định function nào có độ phức tạp cao.
- Mất nhiều thời gian viết test case thủ công.
- Khó ưu tiên khu vực cần tăng coverage.

TestCovAI được xây dựng nhằm:

- Phân tích Jest Coverage tự động.
- Xây dựng Control Flow Graph (CFG).
- Tính Cyclomatic Complexity (CC).
- Đề xuất cải thiện coverage bằng AI.
- Sinh Jest Test Skeleton.
- Sinh Jest Test Runnable (best effort).
- Quản lý lịch sử phân tích theo từng snapshot source code.

---

# Tính năng chính

## Authentication

- Đăng ký tài khoản bằng Email/Password
- Đăng nhập bằng Email/Password
- Đăng nhập bằng GitHub OAuth
- Quên mật khẩu
- Đặt lại mật khẩu
- JWT Authentication

---

## Project Management

- Tạo Project
- Xem danh sách Project
- Xem chi tiết Project
- Xóa Project

---

## Repository Ingestion

### Upload ZIP

- Upload source code dạng ZIP
- Tạo Snapshot
- Tính checksum/hash
- Lưu lịch sử upload

### GitHub Import

- Kết nối GitHub
- Import Repository
- Tạo Snapshot từ Commit
- Đồng bộ metadata repository

---

## Analysis Pipeline

### Coverage Analysis

Chạy Jest Coverage:

```bash
jest --coverage
```

Thu thập:

- Line Coverage
- Branch Coverage
- Function Coverage
- Statement Coverage

---

### Control Flow Graph (CFG)

Phân tích AST bằng Babel Parser và xây dựng CFG cho từng function.

Hiển thị:

- Nodes
- Edges
- Luồng điều khiển

---

### Cyclomatic Complexity (CC)

Tính toán độ phức tạp của từng function.

Ví dụ:

```javascript
function checkAge(age) {
  if (age >= 18) {
    return true;
  }
  return false;
}
```

CC = 2

---

## AI Suggestions

AI phân tích:

- Source Code
- Coverage
- CFG
- Cyclomatic Complexity
- Existing Test Files

Sau đó đề xuất:

- Function cần ưu tiên test
- Edge case còn thiếu
- Coverage gap
- Refactor suggestion

---

## AI Test Generation

### Skeleton Mode

Sinh khung test:

```javascript
describe("calculatePrice", () => {
  test("should return correct result");
});
```

### Full Mode

Sinh test runnable:

```javascript
describe("calculatePrice", () => {
  test("should calculate discount correctly", () => {
    expect(calculatePrice(100, 10)).toBe(90);
  });
});
```

Khi AI không đủ ngữ cảnh:

```javascript
test.todo("Handle invalid input");
```

---

## Notification System

Thông báo:

- Analysis completed
- Coverage ready
- AI suggestion ready
- Test generation completed

---

## Admin Usage Monitoring

Theo dõi:

- AI requests
- Token usage
- Compute time
- Analysis jobs

---

# Công nghệ sử dụng

## Frontend

- React
- React Router DOM
- Axios
- Tailwind CSS

## Backend

- ExpressJS
- Prisma ORM
- PostgreSQL (Neon)

## Authentication

- JWT
- GitHub OAuth

## AI

- Gemini API

## Static Analysis

- Babel Parser

## Testing

- Jest

## Runtime

- Docker

---

# Kiến trúc hệ thống

```text
Frontend (React)
        │
        ▼
Backend API (ExpressJS)
        │
        ├── PostgreSQL (Neon)
        │
        ├── Prisma ORM
        │
        ├── Docker Runner
        │       │
        │       └── Jest Coverage
        │
        ├── Babel Parser
        │       │
        │       ├── CFG Builder
        │       └── CC Calculator
        │
        └── Gemini AI
```

---

# Database Models

## User

Lưu thông tin người dùng.

## Project

Thông tin dự án.

## ProjectSnapshot

Phiên bản source code tại thời điểm upload/import.

## Job

Theo dõi trạng thái các tác vụ phân tích.

## CoverageSummary

Tổng hợp coverage.

## CoverageFile

Coverage theo file.

## CoverageFunction

Coverage theo function.

## CFG

Lưu Control Flow Graph.

## Cyclomatic

Lưu Cyclomatic Complexity.

## AISuggestion

Lưu các đề xuất từ AI.

## AITest

Lưu test được AI sinh ra.

## Notification

Thông báo người dùng.

---

# API Overview

## Authentication

```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
POST /api/auth/forgotPassword
POST /api/auth/resetPassword/:token

GET  /api/auth/github/callback
POST /api/auth/github/access
GET  /api/auth/github/repositories
```

---

## User

```http
GET   /api/users/me
PATCH /api/users/me
```

---

## Projects

```http
POST   /api/projects
GET    /api/projects
GET    /api/projects/:id
DELETE /api/projects/:id
```

---

## Repository Ingestion

```http
POST /api/projects/:id/upload-zip

POST /api/projects/:id/import-github
```

---

## Snapshots

```http
GET /api/projects/:id/snapshots
```

---

## Jobs

```http
POST /api/projects/:id/run-analysis

GET /api/job/:projectId/jobs

GET /api/job/:jobId
```

---

## Coverage

```http
GET /api/coverage/:snapshotId/summary

GET /api/coverage/:snapshotId/files

GET /api/coverage/:snapshotId/functions
```

---

## CFG / CC

```http
GET /api/projects/:id/cfg

GET /api/projects/:id/cc
```

---

## AI Suggestions

```http
GET /api/ai-suggestions?projectId=:id

POST /api/ai-suggestions/refresh/:projectId
```

---

## AI Test Generation

```http
POST /api/projects/:id/ai-tests

GET  /api/projects/:id/ai/tests

POST /api/projects/:id/ai/generate-full-test
```

---

## Notifications

```http
GET /api/notifications

PATCH /api/notifications/:id/read
```

---

# Security

## Upload Restrictions

- Chỉ cho phép file ZIP và RAR
- Giới hạn kích thước file (200MB compressed, 1GB uncompressed)
- Chặn file nhạy cảm
- Kiểm tra archive bomb

Ví dụ:

```text
.env
.pem
.key
```

---

## Docker Sandbox

Mọi quá trình phân tích được thực hiện trong Docker container riêng biệt nhằm:

- Cách ly môi trường
- Giảm rủi ro thực thi mã độc
- Giới hạn tài nguyên

---

## API Protection

- JWT Authentication
- Rate Limiting (express-rate-limit)
- Input Validation (Zod)
- Token Encryption (AES-256-GCM)

---

# Development Roadmap

## Phase 1

Backend Foundation

- Authentication
- Project CRUD
- ZIP Upload
- GitHub Import

## Phase 2

Analysis Engine

- Docker Runner
- Coverage Parser
- CFG Builder
- Cyclomatic Complexity

## Phase 3

AI Features

- AI Suggestions
- Test Generation

## Phase 4

Frontend

- Dashboard
- Coverage Visualization
- CFG Viewer
- AI Suggestion UI

---

# Team

Graduation / Academic Project

Developed using:

- React
- ExpressJS
- Prisma
- PostgreSQL
- Jest
- Docker
- Gemini AI

---

# License

This project is developed for educational and research purposes.
